// Moves one file between a panel's storage on a computer's daemon and the
// disk of the machine running the shell. The daemon's /panel-files route
// owns the path check; this module owns the local side: the dialog result,
// the size cap for what it writes, one dialog per panel at a time, and a
// save that never leaves a half-written file at the chosen path.
// No Electron imports: Electron main and the browser-mode host share it,
// each passing the daemon endpoint lookup (panelFileEndpoint.ts).
import * as fs from "fs";
import { randomUUID } from "crypto";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { Transform, type Readable } from "stream";
import { pipeline } from "stream/promises";
import { pinnedTlsOptions } from "../../papercrane/pinnedTls";
import { logger } from "../../papercrane/logger";
import {
    failedResult,
    parsePanelFileTransferRequest,
    PanelFileTransferError,
    type FileTypeFilter,
    type PanelFileTransferRequest,
    type PanelFileTransferResult,
} from "../shared/fileTransfer";

// the largest file a save writes to this machine; uploads are capped by
// the receiving daemon (PAPERCRANE_DAV_MAX_UPLOAD)
export const PANEL_FILE_SAVE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
// a daemon that sends or accepts nothing for this long has failed the transfer
const TRANSFER_IDLE_MS = 60_000;
// open dialogs and transfers across every panel; each panel holds one
export const MAX_ACTIVE_PANEL_FILE_TRANSFERS = 4;

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
    endpoint: (computerId: string) => DaemonEndpoint;
}

function filePath(req: PanelFileTransferRequest): string {
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
    if (size > PANEL_FILE_SAVE_MAX_BYTES) {
        throw new PanelFileTransferError("too-large", `The file is larger than Paperboard saves (${PANEL_FILE_SAVE_MAX_BYTES} bytes)`);
    }
    return size;
}

function byteCap(cap: number, counted: { bytes: number }): Transform {
    return new Transform({
        transform(chunk: Buffer, _encoding, done) {
            counted.bytes += chunk.length;
            if (counted.bytes > cap) done(new PanelFileTransferError("too-large", `The file grew past ${cap} bytes while saving`));
            else done(null, chunk);
        },
    });
}

/** GET the panel file as a stream, capped; the caller consumes or destroys it */
export async function readPanelFile(
    endpoint: DaemonEndpoint,
    req: PanelFileTransferRequest,
): Promise<{ size: number; body: Readable; received: () => number }> {
    const get = daemonRequest(endpoint, "GET", filePath(req));
    const response = awaitResponse(get);
    get.end();
    const res = await response;
    if (res.statusCode !== 200) throw await statusFailure(res, `The panel file "${req.path}"`);
    const size = Number(res.headers["content-length"]);
    if (Number.isFinite(size) && size > PANEL_FILE_SAVE_MAX_BYTES) {
        res.destroy();
        throw new PanelFileTransferError("too-large", `The file is larger than Paperboard saves (${PANEL_FILE_SAVE_MAX_BYTES} bytes)`);
    }
    const counted = { bytes: 0 };
    const capped = byteCap(PANEL_FILE_SAVE_MAX_BYTES, counted);
    res.on("error", (err) => capped.destroy(err));
    capped.on("close", () => res.destroy());
    return { size, body: res.pipe(capped), received: () => counted.bytes };
}

/** PUT a stream of known size into the panel's storage */
export async function writePanelFile(
    endpoint: DaemonEndpoint,
    req: PanelFileTransferRequest,
    body: Readable,
    size: number,
): Promise<void> {
    const put = daemonRequest(endpoint, "PUT", filePath(req), {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size),
    });
    const response = awaitResponse(put);
    // a refusal (413, 403) can answer before the body is sent; the
    // response decides, and the upload stream is torn down either way
    const sent = pipeline(body, put).catch((err) => err as Error);
    const res = await response.catch(async (err) => {
        body.destroy();
        await sent;
        throw err;
    });
    if (res.statusCode !== 201 && res.statusCode !== 204) {
        body.destroy();
        throw await statusFailure(res, `Writing "${req.path}"`);
    }
    res.resume();
    const sendError = await sent;
    if (sendError) throw new PanelFileTransferError("failed", sendError.message);
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

// one dialog per panel, a few across the app: a dialog is modal to the
// user, and a transfer holds a socket and a file
const activeDialogs = new Set<string>();

function acquireSlot(req: PanelFileTransferRequest): () => void {
    const key = `${req.computerId}::${req.panelId}`;
    if (activeDialogs.has(key)) throw new PanelFileTransferError("busy", "This panel already has an export or import running");
    if (activeDialogs.size >= MAX_ACTIVE_PANEL_FILE_TRANSFERS) {
        throw new PanelFileTransferError("busy", "Too many file transfers are running; try again when one finishes");
    }
    activeDialogs.add(key);
    return () => activeDialogs.delete(key);
}

async function withPanelFileSlot<T>(req: PanelFileTransferRequest, run: () => Promise<T>): Promise<T> {
    const release = acquireSlot(req);
    try {
        return await run();
    } finally {
        release();
    }
}

export async function runPanelExport(args: unknown, deps: PanelFileTransferDeps): Promise<PanelFileTransferResult> {
    try {
        const req = parsePanelFileTransferRequest(args);
        const endpoint = deps.endpoint(req.computerId);
        return await withPanelFileSlot(req, async () => {
            await statPanelFile(endpoint, req);
            const dest = await deps.pickSavePath({
                suggestedName: req.suggestedName ?? path.posix.basename(req.path.replace(/\\/g, "/")),
                filters: req.filters,
            });
            if (!dest) return { status: "canceled" } as const;
            const bytes = await saveTo(endpoint, req, dest);
            return { status: "exported", name: path.basename(dest), bytes } as const;
        });
    } catch (err) {
        logger.warn("[panel-files] file transfer failed:", (err as Error)?.message ?? err);
        return failedResult(err);
    }
}

export async function runPanelImport(args: unknown, deps: PanelFileTransferDeps): Promise<PanelFileTransferResult> {
    try {
        const req = parsePanelFileTransferRequest(args);
        const endpoint = deps.endpoint(req.computerId);
        return await withPanelFileSlot(req, async () => {
            const source = await deps.pickOpenPath({ filters: req.filters });
            if (!source) return { status: "canceled" } as const;
            const bytes = await uploadFrom(endpoint, req, source);
            return { status: "imported", name: path.basename(source), bytes } as const;
        });
    } catch (err) {
        logger.warn("[panel-files] file transfer failed:", (err as Error)?.message ?? err);
        return failedResult(err);
    }
}

// Browser mode: the dialog runs in the user's browser, so the host only
// checks the file before the picker opens, then moves bytes. A read holds
// the panel's slot until its stream closes either way.
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
    const target = endpoint(req.computerId);
    const release = acquireSlot(req);
    try {
        const file = await readPanelFile(target, req);
        file.body.once("close", release);
        return { size: file.size, body: file.body };
    } catch (err) {
        release();
        throw err;
    }
}

export async function writePanelFileFromBrowser(
    args: unknown,
    body: Readable,
    size: number,
    endpoint: (computerId: string) => DaemonEndpoint,
): Promise<PanelFileTransferResult> {
    const req = parsePanelFileTransferRequest(args);
    const target = endpoint(req.computerId);
    return withPanelFileSlot(req, async () => {
        await writePanelFile(target, req, body, size);
        return { status: "imported", name: path.posix.basename(req.path.replace(/\\/g, "/")), bytes: size } as const;
    });
}
