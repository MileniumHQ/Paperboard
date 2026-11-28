// Moves one file between a panel's storage (or, for an export onComputer,
// any file) on a computer's daemon and the disk of the machine running the shell.
// The daemon's /panel-files route owns the path check; this module owns the
// local side: the dialog result and a save that never leaves a half-written
// file at the chosen path.
// No Electron imports: Electron main and the browser-mode host share it,
// each passing the daemon endpoint lookup (panelFileEndpoint.ts).
import * as fs from "fs";
import { randomUUID } from "crypto";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { Transform, type Readable } from "stream";
import { pipeline } from "stream/promises";
import { pinnedTlsOptions } from "daemon/security/pinnedTls";
import { logger } from "daemon/core/logger";
import { errorCode } from "@mileniumhq/paperapi/errors";
import {
    failedResult,
    isImportableName,
    parsePanelFileTransferRequest,
    PanelFileTransferError,
    type ImportedPanelFile,
    type PanelFileTransferRequest,
    type PanelFileTransferResult,
} from "../shared/fileTransfer";
import type { FileTypeFilter } from "@mileniumhq/paperapi";

// a daemon that sends or accepts nothing for this long has failed the transfer
const TRANSFER_IDLE_MS = 60_000;

export interface DaemonEndpoint {
    host: string;
    port: number;
    token: string;
    /** pinned certificate; absent means plaintext loopback */
    cert?: string;
}

export interface PanelFileTransferDeps {
    /** absolute local path the user chose, or null when they canceled */
    pickSavePath(options: { suggestedName: string; filters: FileTypeFilter[] }): Promise<string | null>;
    pickOpenPath(options: { filters: FileTypeFilter[] }): Promise<string | null>;
    /** several files, or one folder (a list of one); null when they canceled */
    pickOpenPaths(options: { filters: FileTypeFilter[]; selection: "files" | "folder" }): Promise<string[] | null>;
    endpoint: (computerId: string) => DaemonEndpoint;
}

/** An import only ever writes into the panel's storage. */
function refuseOnComputer(req: PanelFileTransferRequest): void {
    if (req.onComputer) throw new PanelFileTransferError("invalid-request", "Only an export can name a file anywhere on the computer");
}

function filePath(req: PanelFileTransferRequest): string {
    // an absolute path rides in the query: its spelling is the computer's, and a URL path would normalize it
    if (req.onComputer) return `/panel-files/${encodeURIComponent(req.panelId)}?path=${encodeURIComponent(req.path)}`;
    const segments = req.path.replace(/^[/\\]+/, "").split("/").map(encodeURIComponent);
    return `/panel-files/${encodeURIComponent(req.panelId)}/${segments.join("/")}`;
}

function daemonRequest(
    endpoint: DaemonEndpoint,
    method: string,
    pathname: string,
    headers: Record<string, string> = {},
): http.ClientRequest {
    const options: https.RequestOptions = {
        host: endpoint.host,
        port: endpoint.port,
        path: pathname,
        method,
        headers: { Authorization: `Bearer ${endpoint.token}`, ...headers },
        agent: false,
        timeout: TRANSFER_IDLE_MS,
    };
    const req = endpoint.cert
        ? https.request({ ...options, ...pinnedTlsOptions(endpoint.cert) })
        : http.request(options);
    req.on("timeout", () => req.destroy(new PanelFileTransferError("unreachable", "The computer stopped responding")));
    // an error after the response was handled must not crash main; the
    // response or the pipeline already carries the failure to the caller
    req.on("error", (err) => logger.debug("[panel-files] daemon request ended:", err.message));
    return req;
}

function awaitResponse(req: http.ClientRequest): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
        req.once("response", resolve);
        req.once("error", (err) =>
            reject(err instanceof PanelFileTransferError ? err : new PanelFileTransferError("unreachable", err.message)),
        );
    });
}

async function readText(res: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res) {
        size += (chunk as Buffer).length;
        if (size <= 4096) chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8").slice(0, 4096);
}

async function statusFailure(res: http.IncomingMessage, what: string): Promise<PanelFileTransferError> {
    const detail = (await readText(res)).trim();
    const code = res.statusCode === 404 ? "not-found" : res.statusCode === 413 ? "too-large" : "failed";
    const message = res.statusCode === 404 ? `${what} does not exist` : detail || `${what} failed (HTTP ${res.statusCode})`;
    return new PanelFileTransferError(code, message);
}

/** size of the panel file, failing before any dialog when it can't be saved */
async function statPanelFile(endpoint: DaemonEndpoint, req: PanelFileTransferRequest): Promise<number> {
    const head = daemonRequest(endpoint, "HEAD", filePath(req));
    const response = awaitResponse(head);
    head.end();
    const res = await response;
    if (res.statusCode !== 200) throw await statusFailure(res, `The panel file "${req.path}"`);
    res.resume();
    const size = Number(res.headers["content-length"]);
    if (!Number.isFinite(size) || size < 0) throw new PanelFileTransferError("failed", "The computer did not report the file size");
    return size;
}

/** GET the panel file as a stream; the caller consumes or destroys it */
async function readPanelFile(
    endpoint: DaemonEndpoint,
    req: PanelFileTransferRequest,
): Promise<{ size: number; body: Readable; received: () => number }> {
    const get = daemonRequest(endpoint, "GET", filePath(req));
    const response = awaitResponse(get);
    get.end();
    const res = await response;
    if (res.statusCode !== 200) throw await statusFailure(res, `The panel file "${req.path}"`);
    const size = Number(res.headers["content-length"]);
    let bytes = 0;
    const counter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
            bytes += chunk.length;
            done(null, chunk);
        },
    });
    res.on("error", (err) => counter.destroy(err));
    counter.on("close", () => res.destroy());
    return { size, body: res.pipe(counter), received: () => bytes };
}

/** PUT a stream of known size into the panel's storage */
async function writePanelFile(
    endpoint: DaemonEndpoint,
    req: PanelFileTransferRequest,
    body: Readable,
    size: number,
): Promise<void> {
    refuseOnComputer(req);
    // the daemon answers a file over its cap before any byte is sent: a
    // refusal that arrives while the body is still going out is lost to a
    // connection reset on Windows, leaving only "ECONNRESET" for the reason
    const put = daemonRequest(endpoint, "PUT", filePath(req), {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size),
        Expect: "100-continue",
    });
    const response = awaitResponse(put);
    // a refusal (413, 403) can still answer before the body is sent; the
    // response decides, and the upload stream is torn down either way
    let sent: Promise<Error | undefined> = Promise.resolve(undefined);
    put.once("continue", () => {
        sent = pipeline(body, put).then(() => undefined, (err) => err as Error);
    });
    const res = await response.catch(async (err) => {
        body.destroy();
        await sent;
        throw err;
    });
    if (res.statusCode !== 201 && res.statusCode !== 204) {
        body.destroy();
        const failure = await statusFailure(res, `Writing "${req.path}"`);
        // a refusal before the body leaves the request unfinished
        put.destroy();
        throw failure;
    }
    res.resume();
    const sendError = await sent;
    // a 201 or 204 comes only once the daemon has every byte Content-Length
    // declared (a body cut short aborts the request instead), so the request
    // closing before it reports its own finish lost nothing: the file is in
    if (sendError && errorCode(sendError) !== "ERR_STREAM_PREMATURE_CLOSE") throw new PanelFileTransferError("failed", sendError.message);
}

/** stream the panel file to dest; the chosen path changes only on success */
async function saveTo(endpoint: DaemonEndpoint, req: PanelFileTransferRequest, dest: string): Promise<number> {
    const { size, body, received } = await readPanelFile(endpoint, req);
    const part = `${dest}.paperboard-part-${randomUUID()}`;
    let fd: number | undefined;
    let created = false;
    try {
        fd = fs.openSync(part, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        created = true;
        const out = fs.createWriteStream(part, { fd, autoClose: true });
        fd = undefined; // the stream owns the exclusively opened descriptor
        await pipeline(body, out);
        if (Number.isFinite(size) && received() !== size) {
            throw new PanelFileTransferError("unreachable", "The transfer ended before the whole file arrived");
        }
        fs.renameSync(part, dest);
        return received();
    } catch (err) {
        body.destroy();
        if (fd !== undefined) fs.closeSync(fd);
        try {
            if (created) fs.rmSync(part, { force: true });
        } catch (cleanupErr) {
            logger.warn("[panel-files] could not remove the partial save:", cleanupErr);
        }
        throw err instanceof PanelFileTransferError ? err : new PanelFileTransferError("failed", (err as Error).message);
    }
}

async function uploadFrom(endpoint: DaemonEndpoint, req: PanelFileTransferRequest, source: string): Promise<number> {
    let st: fs.Stats;
    try {
        st = fs.statSync(source);
    } catch (err) {
        throw new PanelFileTransferError("not-found", (err as Error).message);
    }
    if (!st.isFile()) throw new PanelFileTransferError("failed", "Only a single file can be opened");
    await writePanelFile(endpoint, req, fs.createReadStream(source), st.size);
    return st.size;
}

interface PlannedUpload {
    source: string;
    /** the path below the target folder, `/`-separated */
    name: string;
    size: number;
}

function statForImport(source: string, label: string): fs.Stats {
    let st: fs.Stats;
    try {
        st = fs.lstatSync(source);
    } catch (err) {
        throw new PanelFileTransferError("not-found", (err as Error).message);
    }
    // a link could point anywhere on this machine
    if (st.isSymbolicLink()) throw new PanelFileTransferError("failed", `${label} is a link; Paperboard copies files, not links`);
    return st;
}

/** every file under a folder, refusing links and devices; empty folders carry nothing to copy */
function planFolder(root: string): PlannedUpload[] {
    const planned: PlannedUpload[] = [];
    const walk = (dir: string, prefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const name = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (!isImportableName(entry.name)) {
                throw new PanelFileTransferError("failed", `"${name}" has a name that cannot be copied`);
            }
            const source = path.join(dir, entry.name);
            const st = statForImport(source, `"${name}"`);
            if (st.isDirectory()) {
                walk(source, name);
                continue;
            }
            if (!st.isFile()) throw new PanelFileTransferError("failed", `"${name}" is not a regular file`);
            planned.push({ source, name, size: st.size });
        }
    };
    walk(root, "");
    return planned;
}

function planFiles(sources: string[]): PlannedUpload[] {
    const seen = new Set<string>();
    return sources.map((source) => {
        const name = path.basename(source);
        if (!isImportableName(name)) throw new PanelFileTransferError("failed", `"${name}" has a name that cannot be copied`);
        if (seen.has(name)) throw new PanelFileTransferError("invalid-request", `Two chosen files are both called "${name}"`);
        seen.add(name);
        const st = statForImport(source, `"${name}"`);
        if (!st.isFile()) throw new PanelFileTransferError("failed", `"${name}" is not a regular file`);
        return { source, name, size: st.size };
    });
}

/** copies a plan below `dir` in the panel's storage; files already copied stay when a later one fails */
async function uploadPlan(
    endpoint: DaemonEndpoint,
    req: PanelFileTransferRequest,
    dir: string,
    plan: PlannedUpload[],
): Promise<{ files: ImportedPanelFile[]; bytes: number }> {
    const files: ImportedPanelFile[] = [];
    let bytes = 0;
    for (const item of plan) {
        const target = `${dir.replace(/\/+$/, "")}/${item.name}`;
        try {
            await writePanelFile(endpoint, { ...req, path: target }, fs.createReadStream(item.source), item.size);
        } catch (err) {
            if (!(err instanceof PanelFileTransferError)) throw err;
            throw new PanelFileTransferError(err.code, `${item.name}: ${err.message}${files.length ? ` (${files.length === 1 ? "1 file was" : `${files.length} files were`} already copied)` : ""}`);
        }
        files.push({ name: item.name, bytes: item.size });
        bytes += item.size;
    }
    return { files, bytes };
}

export async function runPanelExport(args: unknown, deps: PanelFileTransferDeps): Promise<PanelFileTransferResult> {
    try {
        const req = parsePanelFileTransferRequest(args);
        const endpoint = deps.endpoint(req.computerId);
        await statPanelFile(endpoint, req);
        const dest = await deps.pickSavePath({
            suggestedName: req.suggestedName ?? path.posix.basename(req.path.replace(/\\/g, "/")),
            filters: req.filters,
        });
        if (!dest) return { status: "canceled" } as const;
        const bytes = await saveTo(endpoint, req, dest);
        return { status: "exported", name: path.basename(dest), bytes } as const;
    } catch (err) {
        logger.warn("[panel-files] file transfer failed:", (err as Error)?.message ?? err);
        return failedResult(err);
    }
}

export async function runPanelImport(args: unknown, deps: PanelFileTransferDeps): Promise<PanelFileTransferResult> {
    try {
        const req = parsePanelFileTransferRequest(args);
        refuseOnComputer(req);
        const endpoint = deps.endpoint(req.computerId);
        if (req.selection === "file") {
            const source = await deps.pickOpenPath({ filters: req.filters });
            if (!source) return { status: "canceled" } as const;
            const bytes = await uploadFrom(endpoint, req, source);
            return { status: "imported", name: path.basename(source), bytes } as const;
        }
        const picked = await deps.pickOpenPaths({ filters: req.filters, selection: req.selection });
        if (!picked || picked.length === 0) return { status: "canceled" } as const;
        if (req.selection === "files") {
            const { files, bytes } = await uploadPlan(endpoint, req, req.path, planFiles(picked));
            return { status: "imported", name: files.length === 1 ? files[0]!.name : `${files.length} files`, bytes, files } as const;
        }
        const folder = picked[0]!;
        const folderName = path.basename(folder);
        if (!isImportableName(folderName)) throw new PanelFileTransferError("failed", `"${folderName}" has a name that cannot be copied`);
        if (!statForImport(folder, `"${folderName}"`).isDirectory()) throw new PanelFileTransferError("failed", `"${folderName}" is not a folder`);
        const plan = planFolder(folder);
        if (plan.length === 0) throw new PanelFileTransferError("failed", `"${folderName}" holds no files`);
        const { files, bytes } = await uploadPlan(endpoint, req, `${req.path.replace(/\/+$/, "")}/${folderName}`, plan);
        return { status: "imported", name: folderName, bytes, files } as const;
    } catch (err) {
        logger.warn("[panel-files] file transfer failed:", (err as Error)?.message ?? err);
        return failedResult(err);
    }
}

// Browser mode: the dialog runs in the user's browser, so the host only
// checks the file before the picker opens, then moves bytes.
export async function statPanelFileForBrowser(
    args: unknown,
    endpoint: (computerId: string) => DaemonEndpoint,
): Promise<{ size: number }> {
    const req = parsePanelFileTransferRequest(args);
    return { size: await statPanelFile(endpoint(req.computerId), req) };
}

export async function readPanelFileForBrowser(
    args: unknown,
    endpoint: (computerId: string) => DaemonEndpoint,
): Promise<{ size: number; body: Readable }> {
    const req = parsePanelFileTransferRequest(args);
    const file = await readPanelFile(endpoint(req.computerId), req);
    return { size: file.size, body: file.body };
}

export async function writePanelFileFromBrowser(
    args: unknown,
    body: Readable,
    size: number,
    endpoint: (computerId: string) => DaemonEndpoint,
): Promise<PanelFileTransferResult> {
    const req = parsePanelFileTransferRequest(args);
    await writePanelFile(endpoint(req.computerId), req, body, size);
    return { status: "imported", name: path.posix.basename(req.path.replace(/\\/g, "/")), bytes: size } as const;
}
