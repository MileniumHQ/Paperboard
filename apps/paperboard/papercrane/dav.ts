import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as http from "http";
import type { PaperCraneEngine } from "./engine";
import type { PaperCraneAuth } from "./auth";
import { lookupMime } from "./mime";
import { logger } from "./logger";

// WebDAV rooted at the app-data dir, main token or ephemeral session auth
export const DAV_PREFIX = "/dav";
export const DAV_REALM = "PaperCrane";
const DEFAULT_IDLE_MS = 5 * 60_000;
const MIN_IDLE_MS = 30_000;
const MAX_IDLE_MS = 30 * 60_000;
// non-regular entries break PROPFIND/GET
const BLOCKED_TOP_LEVEL = new Set(["sockets"]);

export interface DavSession {
    user: string;
    pass: string;
    createdAt: number;
    lastActiveAt: number;
    idleMs: number;
}

export class DavSessionStore {
    private byUser = new Map<string, DavSession>();
    private secrets = new Set<string>();

    issue(idleMs = DEFAULT_IDLE_MS): DavSession {
        const clamped = Math.min(MAX_IDLE_MS, Math.max(MIN_IDLE_MS, idleMs));
        const now = Date.now();
        const s: DavSession = {
            user: `dav-${crypto.randomBytes(6).toString("hex")}`,
            pass: crypto.randomBytes(24).toString("hex"),
            createdAt: now,
            lastActiveAt: now,
            idleMs: clamped,
        };
        this.byUser.set(s.user, s);
        this.secrets.add(s.pass);
        this.sweep();
        return s;
    }

    revoke(user: string): boolean {
        const s = this.byUser.get(user);
        if (!s) return false;
        this.byUser.delete(user);
        this.secrets.delete(s.pass);
        return true;
    }

    revokeAll(): void {
        this.byUser.clear();
        this.secrets.clear();
    }

    isSessionSecret(secret: string): boolean {
        return this.secrets.has(secret);
    }

    /** Session for Basic user+pass, or null */
    useBasic(user: string, pass: string): DavSession | null {
        const s = this.byUser.get(user);
        if (!s) return null;
        if (Date.now() - s.lastActiveAt > s.idleMs) {
            this.revoke(user);
            return null;
        }
        if (s.pass !== pass) return null;
        s.lastActiveAt = Date.now();
        return s;
    }

    sweep(): void {
        const now = Date.now();
        for (const [user, s] of this.byUser) {
            if (now - s.lastActiveAt > s.idleMs) {
                this.byUser.delete(user);
                this.secrets.delete(s.pass);
            }
        }
    }
}

export interface DavCredential {
    kind: "main" | "session";
}

function parseBasic(header: string): { user: string; pass: string } | null {
    const m = /^Basic\s+(.+)$/i.exec(header.trim());
    if (!m) return null;
    let decoded: string;
    try {
        decoded = Buffer.from(m[1], "base64").toString("utf-8");
    } catch {
        return null;
    }
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

/** Main-token check without the lastSeen write */
function isMainToken(auth: PaperCraneAuth | undefined, secret: string): boolean {
    if (!auth || !secret) return false;
    if (auth.noAuth) return true;
    try {
        return auth.getAuthorizedClients().some((c) => c.token === secret);
    } catch {
        return false;
    }
}

export function checkDavAuth(
    auth: PaperCraneAuth | undefined,
    sessions: DavSessionStore,
    req: http.IncomingMessage,
): DavCredential | null {
    const header = req.headers.authorization;
    if (!header) return null;
    if (/^Bearer\s+/i.test(header)) {
        const token = header.replace(/^Bearer\s+/i, "").trim();
        if (sessions.isSessionSecret(token)) return null; // sessions can't mint
        return isMainToken(auth, token) ? { kind: "main" } : null;
    }
    const basic = parseBasic(header);
    if (!basic) return null;
    if (sessions.useBasic(basic.user, basic.pass)) return { kind: "session" };
    if (sessions.isSessionSecret(basic.pass)) return null;
    return isMainToken(auth, basic.pass) ? { kind: "main" } : null;
}

export function davUnauthorized(res: http.ServerResponse): void {
    res.writeHead(401, {
        "Content-Type": "text/plain",
        "WWW-Authenticate": `Basic realm="${DAV_REALM}"`,
    });
    res.end("Unauthorized");
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
    } catch {
        return null;
    }
    const target = path.resolve(root, "." + (decoded.startsWith("/") ? decoded : "/" + decoded));
    const relToRoot = path.relative(root, target);
    if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) return null;
    const top = relToRoot.split(path.sep)[0];
    if (BLOCKED_TOP_LEVEL.has(top)) return null;
    return target;
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
            if (dir === root && BLOCKED_TOP_LEVEL.has(e.name)) return false;
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
    engine: PaperCraneEngine,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    rel: string,
): Promise<void> {
    const root = engine.getAppDataDir();
    const target = resolveDavPath(root, rel);
    if (!target || !fs.existsSync(target)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
    }
    const body = (await readBody(req)).toString("utf-8");
    const { mode, names } = parsePropfind(body);
    const depth = (req.headers.depth as string | undefined ?? "infinity").toLowerCase();

    const st = fs.statSync(target);
    // never follow symlinks out for listings
    const isDir = st.isDirectory() && !st.isSymbolicLink();
    const davPath = rel === "" || rel === "/" ? "/" : rel.replace(/\/+$/, "") || "/";

    const build = (p: string, abs: string, name: string): string => {
        const s = fs.statSync(abs);
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
    if (isDir && depth !== "0") {
        const entries = depth === "1" || depth === "infinity" ? listDir(root, target) : [];
        const walk = (dirAbs: string, dirDav: string, level: number): void => {
            if (depth === "1" && level > 1) return;
            for (const name of listDir(root, dirAbs)) {
                const abs = path.join(dirAbs, name);
                const p = dirDav === "/" ? `/${name}` : `${dirDav}/${name}`;
                let s: fs.Stats;
                try {
                    s = fs.statSync(abs);
                } catch {
                    continue;
                }
                if (s.isSymbolicLink()) continue;
                out += build(p, abs, name);
                if (depth === "infinity" && s.isDirectory()) {
                    walk(abs, p, level + 1);
                }
            }
        };
        if (entries.length > 0) walk(target, davPath, 1);
    }
    const xml = multiStatus(out);
    res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' });
    res.end(xml);
}

function sendFile(
    res: http.ServerResponse,
    abs: string,
    range?: string,
): void {
    const st = fs.statSync(abs);
    const headers: Record<string, string> = {
        "Content-Type": lookupMime(path.extname(abs)),
        "Content-Length": String(st.size),
        "Accept-Ranges": "bytes",
        ETag: `"${st.size}-${Math.round(st.mtimeMs)}"`,
        "Last-Modified": st.mtime.toUTCString(),
    };
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
    fs.createReadStream(abs, { start, end }).pipe(res);
}

const DAV_ALLOW =
    "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, PROPPATCH, LOCK, UNLOCK";

function davRooted(pathname: string): string | null {
    if (pathname === DAV_PREFIX || pathname === `${DAV_PREFIX}/`) return "/";
    if (!pathname.startsWith(`${DAV_PREFIX}/`)) return null;
    return pathname.slice(DAV_PREFIX.length) || "/";
}

function badGateway(res: http.ServerResponse): void {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Destination must stay under /dav/ on this server");
}

function destRel(req: http.IncomingMessage, res: http.ServerResponse): string | null {
    const raw = req.headers.destination;
    if (typeof raw !== "string" || !raw) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing Destination");
        return null;
    }
    let destPath: string;
    try {
        destPath = new URL(raw).pathname;
    } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Destination");
        return null;
    }
    const rel = davRooted(destPath);
    if (rel === null) {
        badGateway(res);
        return null;
    }
    return rel;
}

export async function handleDavRequest(
    engine: PaperCraneEngine,
    sessions: DavSessionStore,
    auth: PaperCraneAuth | undefined,
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const rel = davRooted(url.pathname);
    if (rel === null) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
    }
    const cred = checkDavAuth(auth, sessions, req);
    if (!cred) {
        davUnauthorized(res);
        return;
    }
    const root = engine.getAppDataDir();
    const method = (req.method || "GET").toUpperCase();

    if (method === "OPTIONS") {
        res.writeHead(200, {
            Allow: DAV_ALLOW,
            DAV: "1, 2",
            "MS-Author-Via": "DAV",
            "Content-Length": "0",
        });
        res.end();
        return;
    }
    if (method === "PROPFIND") {
        await handlePropfind(engine, req, res, rel);
        return;
    }

    const target = resolveDavPath(root, rel);
    if (!target) {
        res.writeHead(rel === "/" ? 404 : 403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
    }
    const isRoot = rel === "/";

    if (method === "GET" || method === "HEAD") {
        if (!fs.existsSync(target)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
        }
        const st = fs.statSync(target);
        if (!st.isFile() || st.isSymbolicLink()) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Not a file");
            return;
        }
        if (method === "HEAD") {
            res.writeHead(200, {
                "Content-Type": lookupMime(path.extname(target)),
                "Content-Length": String(st.size),
                "Accept-Ranges": "bytes",
                ETag: `"${st.size}-${Math.round(st.mtimeMs)}"`,
                "Last-Modified": st.mtime.toUTCString(),
            });
            res.end();
            return;
        }
        sendFile(res, target, req.headers.range);
        return;
    }

    if (method === "PUT") {
        if (isRoot) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Forbidden");
            return;
        }
        const parent = path.dirname(target);
        if (!fs.existsSync(parent)) {
            res.writeHead(409, { "Content-Type": "text/plain" });
            res.end("Parent collection missing");
            return;
        }
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Target is a collection");
            return;
        }
        const existed = fs.existsSync(target);
        const tmp = `${target}.davpart-${process.pid}-${Date.now()}`;
        try {
            await new Promise<void>((resolve, reject) => {
                const out = fs.createWriteStream(tmp);
                req.pipe(out);
                req.on("aborted", () => reject(new Error("aborted")));
                out.on("finish", () => resolve());
                out.on("error", reject);
                req.on("error", reject);
            });
            fs.renameSync(tmp, target);
        } catch (err) {
            try {
                fs.unlinkSync(tmp);
            } catch {}
            logger.warn("[WebDAV] PUT failed:", (err as Error)?.message ?? err);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Write failed");
            return;
        }
        res.writeHead(existed ? 204 : 201);
        res.end();
        return;
    }

    if (method === "DELETE") {
        if (isRoot) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Forbidden");
            return;
        }
        if (!fs.existsSync(target)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
        }
        try {
            fs.rmSync(target, { recursive: true, force: true });
        } catch (err) {
            logger.warn("[WebDAV] DELETE failed:", (err as Error)?.message ?? err);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Delete failed");
            return;
        }
        res.writeHead(204);
        res.end();
        return;
    }

    if (method === "MKCOL") {
        if (fs.existsSync(target)) {
            res.writeHead(405, { "Content-Type": "text/plain" });
            res.end("Already exists");
            return;
        }
        const parent = path.dirname(target);
        if (!fs.existsSync(parent)) {
            res.writeHead(409, { "Content-Type": "text/plain" });
            res.end("Parent collection missing");
            return;
        }
        try {
            fs.mkdirSync(target);
        } catch {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Mkcol failed");
            return;
        }
        res.writeHead(201);
        res.end();
        return;
    }

    if (method === "COPY" || method === "MOVE") {
        if (isRoot) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Forbidden");
            return;
        }
        const dRel = destRel(req, res);
        if (dRel === null) return;
        const dest = resolveDavPath(root, dRel);
        if (!dest) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Forbidden");
            return;
        }
        if (!fs.existsSync(target)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
        }
        const overwrite = ((req.headers.overwrite as string) || "T").toUpperCase() !== "F";
        const destExists = fs.existsSync(dest);
        if (destExists && !overwrite) {
            res.writeHead(412, { "Content-Type": "text/plain" });
            res.end("Destination exists");
            return;
        }
        if (!fs.existsSync(path.dirname(dest))) {
            res.writeHead(409, { "Content-Type": "text/plain" });
            res.end("Destination parent missing");
            return;
        }
        try {
            if (destExists) fs.rmSync(dest, { recursive: true, force: true });
            if (method === "COPY") {
                fs.cpSync(target, dest, { recursive: true });
                res.writeHead(destExists ? 204 : 201);
            } else {
                fs.renameSync(target, dest);
                res.writeHead(destExists ? 204 : 201);
            }
            res.end();
        } catch (err) {
            logger.warn(`[WebDAV] ${method} failed:`, (err as Error)?.message ?? err);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end(`${method} failed`);
        }
        return;
    }

    if (method === "PROPPATCH") {
        // accept-and-store-nothing, echo props back as stored
        const body = (await readBody(req)).toString("utf-8");
        const names = new Set<string>();
        const setInner = /<set[\s>]([\s\S]*?)<\/\w*:?set\s*>/i.exec(body)?.[1] ?? body;
        const re = /<(\w+):(\w+)[\s/>]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(setInner)) !== null) {
            if (m[1].toLowerCase() !== "d") names.add(m[2]);
            else if (!["prop", "set", "remove", "propertyupdate"].includes(m[2].toLowerCase())) {
                names.add(m[2]);
            }
        }
        const href = hrefFor(rel === "/" ? "/" : rel.replace(/\/+$/, ""), false);
        const props = [...names]
            .map((n) => `<D:${escXml(n)}/>` )
            .join("");
        res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' });
        res.end(
            multiStatus(
                `<D:response><D:href>${escXml(href)}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
            ),
        );
        return;
    }

    if (method === "LOCK") {
        const token = `opaquelocktoken:${crypto.randomUUID()}`;
        const href = hrefFor(rel === "/" ? "/" : rel.replace(/\/+$/, ""), false);
        res.writeHead(200, { "Content-Type": 'application/xml; charset="utf-8"' });
        res.end(
            `<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>infinity</D:depth><D:owner><D:href>${escXml(href)}</D:href></D:owner><D:timeout>Second-3600</D:timeout><D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`,
        );
        return;
    }

    if (method === "UNLOCK") {
        res.writeHead(204);
        res.end();
        return;
    }

    res.writeHead(501, { "Content-Type": "text/plain" });
    res.end("Not Implemented");
}

/** POST /dav/session, main token only */
export async function handleDavSessionIssue(
    sessions: DavSessionStore,
    auth: PaperCraneAuth | undefined,
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    const header = req.headers.authorization;
    const token = /^Bearer\s+/i.test(header ?? "")
        ? header!.replace(/^Bearer\s+/i, "").trim()
        : parseBasic(header ?? "")?.pass ?? "";
    if (sessions.isSessionSecret(token) || !isMainToken(auth, token)) {
        davUnauthorized(res);
        return;
    }
    let idleMs = DEFAULT_IDLE_MS;
    try {
        const raw = (await readBody(req, 4096)).toString("utf-8");
        const parsed = raw ? JSON.parse(raw) : {};
        if (typeof parsed?.idleMs === "number") idleMs = parsed.idleMs;
    } catch {
        // fall through with defaults
    }
    const s = sessions.issue(idleMs);
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
    const header = req.headers.authorization;
    const token = /^Bearer\s+/i.test(header ?? "")
        ? header!.replace(/^Bearer\s+/i, "").trim()
        : parseBasic(header ?? "")?.pass ?? "";
    if (sessions.isSessionSecret(token) || !isMainToken(auth, token)) {
        davUnauthorized(res);
        return;
    }
    let user = "";
    try {
        const raw = (await readBody(req, 4096)).toString("utf-8");
        user = (raw ? JSON.parse(raw) : {})?.user ?? "";
    } catch {
        // reported below as unknown user
    }
    if (typeof user !== "string" || !sessions.revoke(user)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unknown session" }));
        return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ revoked: true }));
}
