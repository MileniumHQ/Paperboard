import * as fs from "fs";
import * as path from "path";
import type * as http from "http";
import type { PaperCraneEngine } from "./engine";
import type { PaperCraneAuth } from "./auth";
import { lookupMime } from "./mime";
import { logger } from "./logger";
import { checkDavAuth, davUnauthorized, type DavSessionStore, DEFAULT_IDLE_MS, mainTokenOf } from "./davAuth";
import { receiveFileAtomic, UploadTooLargeError } from "./atomicUpload";
import { hasOnlyRealEntriesBelow } from "./storage";

// WebDAV rooted at the app-data dir, for the main token or an ephemeral
// session (davAuth.ts)
export const DAV_PREFIX = "/dav";
// top-level dirs WebDAV never serves. sockets/: non-regular entries break
// PROPFIND/GET. local/: this computer's own credentials and server state
// (vault, paired tokens, TLS identity, paired computers, crane.json). The
// whole directory is refused rather than a list of names inside it: a
// name list missed tls_identity.json, the daemon's TLS private key.
const BLOCKED_TOP_LEVEL = new Set(["sockets", "local"]);

// credential/server-local files are never visible through WebDAV,
// for any method (resolveDavPath is the single enforcement point)
const BLOCKED_FILE_NAMES = new Set([
    "secrets.json",
    "crane.json",
    "authorized_tokens.json",
    "paired_computers.json",
    "machine-id.json",
    "vault-recovery",
    "tls_identity.json",
]);

const KEY_MATERIAL_RE = /\.(key|pem|crt)$/i;

// upload cap, overridable via env for tests/dev
export const DEFAULT_DAV_MAX_UPLOAD = 512 * 1024 * 1024;

export function davMaxUploadBytes(): number {
    const raw = Number(process.env.PAPERCRANE_DAV_MAX_UPLOAD);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAV_MAX_UPLOAD;
}

function isBlockedFileName(name: string): boolean {
    const lower = name.toLowerCase();
    return BLOCKED_FILE_NAMES.has(lower) || lower.startsWith("secrets.json.") || lower.startsWith("tls_identity.json.") || KEY_MATERIAL_RE.test(name);
}

function escXml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** Resolve a /dav-relative path inside root, null when blocked */
export function resolveDavPath(root: string, rel: string): string | null {
    let decoded = rel;
    try {
        decoded = decodeURIComponent(rel);
    } catch (err) {
        logger.debug("[dav] path decode failed, blocking:", err);
        return null;
    }
    const target = path.resolve(root, "." + (decoded.startsWith("/") ? decoded : "/" + decoded));
    const relToRoot = path.relative(root, target);
    if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) return null;
    // case-folded: macOS and Windows filesystems resolve /LOCAL/ to local/
    const top = relToRoot.split(path.sep)[0].toLowerCase();
    if (BLOCKED_TOP_LEVEL.has(top)) return null;
    // refuse credential/local files and key material at ANY depth,
    // including dot-segment tricks after decodeURIComponent.
    // polarity: only "." and ".." are navigation segments; a dotfile NAME
    // is still a name and still gets checked
    for (const seg of relToRoot.split(path.sep)) {
        if (seg === "." || seg === "..") continue;
        if (isBlockedFileName(seg)) return null;
    }
    // a linked folder above the target would lead outside the root; the
    // leaf itself is checked by each method (a link is never served)
    return target === root || hasOnlyRealEntriesBelow(root, path.dirname(target)) ? target : null;
}

interface PropRow {
    name: string;
    value: string;
}

function statProps(
    davPath: string,
    st: fs.Stats,
    isDir: boolean,
    displayName: string,
): PropRow[] {
    const mtime = st.mtimeMs ? new Date(st.mtimeMs) : new Date();
    const props: PropRow[] = [
        {
            name: "resourcetype",
            value: isDir ? "<D:collection/>" : "",
        },
        { name: "displayname", value: escXml(displayName) },
        { name: "getlastmodified", value: escXml(mtime.toUTCString()) },
        {
            name: "creationdate",
            value: escXml(
                (st.birthtimeMs ? new Date(st.birthtimeMs) : mtime).toISOString(),
            ),
        },
        { name: "getetag", value: escXml(`"${st.size}-${Math.round(st.mtimeMs)}"`) },
    ];
    if (!isDir) {
        props.push({ name: "getcontentlength", value: String(st.size) });
        props.push({
            name: "getcontenttype",
            value: escXml(lookupMime(path.extname(davPath))),
        });
    }
    return props;
}

const KNOWN_PROPS = new Set([
    "resourcetype",
    "displayname",
    "getlastmodified",
    "creationdate",
    "getetag",
    "getcontentlength",
    "getcontenttype",
]);

function propResponse(href: string, rows: PropRow[], missing: string[]): string {
    const ok = rows.map((r) => `<D:${r.name}>${r.value}</D:${r.name}>`).join("");
    let out = `<D:response><D:href>${escXml(href)}</D:href><D:propstat><D:prop>${ok}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>`;
    if (missing.length > 0) {
        out += `<D:propstat><D:prop>${missing.map((m) => `<D:${escXml(m)}/>`).join("")}</D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>`;
    }
    return out + `</D:response>`;
}

function multiStatus(responses: string): string {
    return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${responses}</D:multistatus>`;
}

function readBody(req: http.IncomingMessage, maxBytes = 4 * 1024 * 1024): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
                reject(new Error("body too large"));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function parsePropfind(body: string): { mode: "allprop" | "propname" | "prop"; names: string[] } {
    const lower = body.toLowerCase();
    if (lower.includes("<propname")) return { mode: "propname", names: [] };
    if (!lower.includes("<prop") || lower.includes("<allprop")) {
        return { mode: "allprop", names: [] };
    }
    const inner = /<prop[\s>]([\s\S]*?)<\/\w*:?prop\s*>/i.exec(body)?.[1] ?? "";
    const names: string[] = [];
    const re = /<(\w+):(\w+)[\s/>]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
        names.push(m[2].toLowerCase());
    }
    return { mode: "prop", names };
}

function listDir(root: string, dir: string): string[] {
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => {
            if (dir === root && BLOCKED_TOP_LEVEL.has(e.name.toLowerCase())) return false;
            if (isBlockedFileName(e.name)) return false;
            return true;
        })
        .map((e) => e.name)
        .sort();
}

function hrefFor(davPath: string, isDir: boolean): string {
    const enc = davPath
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/");
    const base = `${DAV_PREFIX}${enc === "/" ? "" : enc}`;
    return isDir && !base.endsWith("/") ? base + "/" : base || `${DAV_PREFIX}/`;
}

async function handlePropfind(
    root: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    rel: string,
): Promise<void> {
    const target = resolveDavPath(root, rel);
    if (!target || !fs.existsSync(target)) return replyText(res, 404, "Not Found");
    const body = (await readBody(req)).toString("utf-8");
    const { mode, names } = parsePropfind(body);
    const depth = (req.headers.depth as string | undefined ?? "infinity").toLowerCase();

    const st = fs.lstatSync(target);
    // never follow symlinks out for listings. lstat (not stat) is
    // load-bearing here: stat follows links, so isSymbolicLink() on a
    // stat result is always false and the guard below would be theater.
    const isDir = st.isDirectory() && !st.isSymbolicLink();
    // hrefs are built from the decoded path and encoded once (hrefFor):
    // building them from the request's still-encoded path encodes twice,
    // and a mounted drive then cannot open "My Folder"
    const decoded = decodeURIComponent(rel);
    const davPath = decoded.replace(/\/+$/, "") || "/";

    const build = (p: string, abs: string, name: string): string => {
        const s = fs.lstatSync(abs);
        const dir = s.isDirectory() && !s.isSymbolicLink();
        const rows = statProps(p, s, dir, name);
        if (mode === "propname") {
            const tags = rows.map((r) => `<D:${r.name}/>`).join("");
            return `<D:response><D:href>${escXml(hrefFor(p, dir))}</D:href><D:propstat><D:prop>${tags}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
        }
        if (mode === "prop") {
            const want = names.length > 0 ? names : rows.map((r) => r.name);
            const ok = rows.filter((r) => want.includes(r.name));
            const missing = want.filter((w) => !KNOWN_PROPS.has(w));
            return propResponse(hrefFor(p, dir), ok, missing);
        }
        return propResponse(hrefFor(p, dir), rows, []);
    };

    let out = build(davPath, target, davPath === "/" ? "paperboard" : path.basename(davPath));
    // listing hygiene: a depth-infinity walk is bounded — no client
    // request converts a whole-data-tree walk into unbounded memory
    const MAX_WALKED_ENTRIES = 5000;
    let walked = 0;
    if (isDir && (depth === "1" || depth === "infinity")) {
        const walk = (dirAbs: string, dirDav: string, level: number): void => {
            if (depth === "1" && level > 1) return;
            if (walked >= MAX_WALKED_ENTRIES) return;
            for (const name of listDir(root, dirAbs)) {
                if (walked >= MAX_WALKED_ENTRIES) return;
                const abs = path.join(dirAbs, name);
                const p = dirDav === "/" ? `/${name}` : `${dirDav}/${name}`;
                let s: fs.Stats;
                try {
                    s = fs.lstatSync(abs);
                } catch {
                    continue;
                }
                if (s.isSymbolicLink()) continue;
                out += build(p, abs, name);
                walked++;
                if (depth === "infinity" && s.isDirectory()) {
                    walk(abs, p, level + 1);
                }
            }
        };
        walk(target, davPath, 1);
    }
    const xml = multiStatus(out);
    res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' });
    res.end(xml);
}

function fileHeaders(abs: string, st: fs.Stats): Record<string, string> {
    return {
        "Content-Type": lookupMime(path.extname(abs)),
        "Content-Length": String(st.size),
        "Accept-Ranges": "bytes",
        ETag: `"${st.size}-${Math.round(st.mtimeMs)}"`,
        "Last-Modified": st.mtime.toUTCString(),
    };
}

export function sendFile(
    res: http.ServerResponse,
    abs: string,
    range?: string,
): void {
    const st = fs.statSync(abs);
    const headers = fileHeaders(abs, st);
    let start = 0;
    let end = st.size - 1;
    let status = 200;
    if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (m) {
            const a = m[1] === "" ? null : Number(m[1]);
            const b = m[2] === "" ? null : Number(m[2]);
            if (a !== null && !Number.isNaN(a)) {
                start = Math.min(a, st.size);
                end = b !== null && !Number.isNaN(b) ? Math.min(b, st.size - 1) : st.size - 1;
            } else if (b !== null && !Number.isNaN(b)) {
                start = Math.max(0, st.size - b);
            }
            if (start > end || start >= st.size) {
                res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
                res.end();
                return;
            }
            status = 206;
            headers["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
            headers["Content-Length"] = String(end - start + 1);
        }
    }
    res.writeHead(status, headers);
    // a file removed after the stat, or a client that hangs up, ends the
    // response and frees the file instead of raising an unhandled error
    const body = fs.createReadStream(abs, { start, end });
    body.on("error", (error) => res.destroy(error));
    res.once("close", () => body.destroy());
    body.pipe(res);
}

function davRooted(pathname: string): string | null {
    if (pathname === DAV_PREFIX || pathname === `${DAV_PREFIX}/`) return "/";
    if (!pathname.startsWith(`${DAV_PREFIX}/`)) return null;
    return pathname.slice(DAV_PREFIX.length) || "/";
}

export function replyText(res: http.ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
    res.writeHead(status, { "Content-Type": "text/plain", ...extra });
    res.end(text);
}

function entryId(p: string): string | null {
    try {
        const st = fs.statSync(p, { bigint: true });
        return `${st.dev}:${st.ino}`;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
    }
}

/** ids of a path and each ancestor, compared by identity so case variants and links cannot disguise a match */
function ancestryIds(p: string): Set<string> {
    const ids = new Set<string>();
    for (let cur = p; ; cur = path.dirname(cur)) {
        const id = entryId(cur);
        if (id) ids.add(id);
        if (path.dirname(cur) === cur) return ids;
    }
}

/**
 * How a COPY/MOVE destination relates to its source, by file identity:
 * "same-entry" is the source itself under the same or a case-variant name,
 * "contained" is the source's ancestor or a path inside it. A different name
 * for the same inode (a hard link) is an ordinary destination.
 */
export function davOverlap(source: string, dest: string, destExists: boolean): "same-entry" | "contained" | "none" {
    const sourceId = entryId(source);
    if (!sourceId) return "none";
    const destId = destExists ? entryId(dest) : null;
    if (destId === sourceId) {
        const sameParent = entryId(path.dirname(source)) === entryId(path.dirname(dest));
        if (sameParent && path.basename(source).toLowerCase() === path.basename(dest).toLowerCase()) return "same-entry";
    }
    if (destId && destId !== sourceId && ancestryIds(path.dirname(source)).has(destId)) return "contained";
    if (ancestryIds(path.dirname(dest)).has(sourceId)) return "contained";
    return "none";
}

function destRel(req: http.IncomingMessage, res: http.ServerResponse): string | null {
    const raw = req.headers.destination;
    if (typeof raw !== "string" || !raw) {
        replyText(res, 400, "Missing Destination");
        return null;
    }
    let destPath: string;
    try {
        destPath = new URL(raw).pathname;
    } catch {
        replyText(res, 400, "Bad Destination");
        return null;
    }
    const rel = davRooted(destPath);
    if (rel === null) {
        replyText(res, 502, "Destination must stay under /dav/ on this server");
        return null;
    }
    return rel;
}

// one authenticated request, its path resolved inside the root
interface DavCall {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    method: string;
    root: string;
    target: string;
}

function davOptions(res: http.ServerResponse): void {
    res.writeHead(200, { Allow: DAV_ALLOW, DAV: "1", "MS-Author-Via": "DAV", "Content-Length": "0" });
    res.end();
}

function davGet({ req, res, method, target }: DavCall): void {
    if (!fs.existsSync(target)) return replyText(res, 404, "Not Found");
    // lstat, not stat: a symlink is never served, even one pointing
    // inside the tree (resolveDavPath refuses linked folders above it)
    const st = fs.lstatSync(target);
    if (!st.isFile() || st.isSymbolicLink()) return replyText(res, 403, "Not a file");
    if (method === "GET") return sendFile(res, target, req.headers.range);
    res.writeHead(200, fileHeaders(target, st));
    res.end();
}

async function davPut({ req, res, root, target }: DavCall): Promise<void> {
    if (target === root) return replyText(res, 403, "Forbidden");
    if (!fs.existsSync(path.dirname(target))) return replyText(res, 409, "Parent collection missing");
    const existed = fs.existsSync(target);
    if (existed && fs.statSync(target).isDirectory()) return replyText(res, 403, "Target is a collection");
    try {
        await receiveFileAtomic(req, target, davMaxUploadBytes());
    } catch (err) {
        if (err instanceof UploadTooLargeError) return replyText(res, 413, "Upload too large");
        throw err;
    }
    res.writeHead(existed ? 204 : 201);
    res.end();
}

function davDelete({ res, root, target }: DavCall): void {
    if (target === root) return replyText(res, 403, "Forbidden");
    if (!fs.existsSync(target)) return replyText(res, 404, "Not Found");
    fs.rmSync(target, { recursive: true, force: true });
    res.writeHead(204);
    res.end();
}

function davMkcol({ res, target }: DavCall): void {
    if (fs.existsSync(target)) return replyText(res, 405, "Already exists");
    if (!fs.existsSync(path.dirname(target))) return replyText(res, 409, "Parent collection missing");
    fs.mkdirSync(target);
    res.writeHead(201);
    res.end();
}

function davCopyOrMove({ req, res, method, root, target }: DavCall): void {
    if (target === root) return replyText(res, 403, "Forbidden");
    const dRel = destRel(req, res);
    if (dRel === null) return;
    const dest = resolveDavPath(root, dRel);
    if (!dest || dest === root) return replyText(res, 403, "Forbidden");
    if (!fs.existsSync(target)) return replyText(res, 404, "Not Found");
    const overwrite = ((req.headers.overwrite as string) || "T").toUpperCase() !== "F";
    const destExists = fs.existsSync(dest);
    if (destExists && !overwrite) return replyText(res, 412, "Destination exists");
    if (!fs.existsSync(path.dirname(dest))) return replyText(res, 409, "Destination parent missing");
    // the overwrite below deletes dest first: when dest is the source
    // (same path, or a case variant on a case-insensitive filesystem),
    // contains it, or lies inside it, that would delete the source
    const overlap = davOverlap(target, dest, destExists);
    if (overlap === "contained") return replyText(res, 403, "Destination overlaps the source");
    // a case-only MOVE is a real rename, not an overwrite: it deletes nothing
    const caseOnlyRename = overlap === "same-entry" && method === "MOVE" && path.basename(dest) !== path.basename(target);
    if (overlap === "same-entry" && !caseOnlyRename) return replyText(res, 403, "Destination is the source");
    if (destExists && !caseOnlyRename) fs.rmSync(dest, { recursive: true, force: true });
    if (method === "COPY") fs.cpSync(target, dest, { recursive: true });
    else fs.renameSync(target, dest);
    res.writeHead(destExists ? 204 : 201);
    res.end();
}

// locks are genuinely not stored anywhere: minting receipts we never honor
// teaches clients to overwrite each other, and an honest refusal lets WebDAV
// clients use their own safe save path
function davLock({ res }: DavCall): void {
    replyText(res, 501, "Locking is not implemented");
}

const DAV_METHODS: Record<string, (call: DavCall) => void | Promise<void>> = {
    GET: davGet,
    HEAD: davGet,
    PUT: davPut,
    DELETE: davDelete,
    MKCOL: davMkcol,
    COPY: davCopyOrMove,
    MOVE: davCopyOrMove,
    LOCK: davLock,
    UNLOCK: davLock,
};

const DAV_ALLOW = "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE";

// Any failure past the checks (a filesystem call that throws, a body that
// can't be read) is logged and answered: a mounted drive is never left
// waiting on a request nobody will answer.
export async function handleDavRequest(
    engine: PaperCraneEngine,
    sessions: DavSessionStore,
    auth: PaperCraneAuth | undefined,
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    const method = (req.method || "GET").toUpperCase();
    try {
        await serveDav(engine, sessions, auth, method, req, res);
    } catch (err) {
        logger.warn(`[WebDAV] ${method} failed:`, (err as Error)?.message ?? err);
        if (res.headersSent) res.destroy();
        else replyText(res, 500, `${method} failed`);
    }
}

async function serveDav(
    engine: PaperCraneEngine,
    sessions: DavSessionStore,
    auth: PaperCraneAuth | undefined,
    method: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    let rel: string | null;
    try {
        rel = davRooted(new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname);
    } catch {
        return replyText(res, 400, "Bad Request");
    }
    if (rel === null) return replyText(res, 404, "Not Found");
    if (!checkDavAuth(auth, sessions, req)) return davUnauthorized(res);
    const root = engine.getAppDataDir();
    if (method === "OPTIONS") return davOptions(res);
    if (method === "PROPFIND") return handlePropfind(root, req, res, rel);
    const target = resolveDavPath(root, rel);
    if (!target) return replyText(res, rel === "/" ? 404 : 403, "Forbidden");
    const handler = DAV_METHODS[method];
    // PROPPATCH and anything else: properties are not stored, and a client
    // that tries is told so
    if (!handler) return replyText(res, 501, "Not Implemented");
    await handler({ req, res, method, root, target });
}

/** POST /dav/session, main token only */
export async function handleDavSessionIssue(
    sessions: DavSessionStore,
    auth: PaperCraneAuth | undefined,
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    const token = mainTokenOf(auth, sessions, req);
    if (token === null) return davUnauthorized(res);
    let idleMs = DEFAULT_IDLE_MS;
    try {
        const raw = (await readBody(req, 4096)).toString("utf-8");
        const parsed = raw ? JSON.parse(raw) : {};
        if (typeof parsed?.idleMs === "number") idleMs = parsed.idleMs;
    } catch (err) {
        // fall through with defaults
        logger.debug("[dav] session body unreadable, using defaults:", err);
    }
    const s = (() => {
        try {
            return sessions.issue(idleMs, token);
        } catch (err) {
            // capped store: loud refusal, never a hung connection
            logger.warn("[dav] session issue refused:", (err as Error)?.message ?? err);
            replyText(res, 503, "Session store is full");
            return null;
        }
    })();
    if (!s) return;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ user: s.user, pass: s.pass, path: `${DAV_PREFIX}/` }));
}

/** DELETE /dav/session, main token only */
export async function handleDavSessionRevoke(
    sessions: DavSessionStore,
    auth: PaperCraneAuth | undefined,
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    const token = mainTokenOf(auth, sessions, req);
    if (token === null) return davUnauthorized(res);
    let user = "";
    try {
        const raw = (await readBody(req, 4096)).toString("utf-8");
        user = (raw ? JSON.parse(raw) : {})?.user ?? "";
    } catch (err) {
        // reported below as unknown user
        logger.debug("[dav] session revoke body unreadable:", err);
    }
    if (typeof user !== "string" || !sessions.revoke(user)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unknown session" }));
        return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ revoked: true }));
}
