// Outbound HTTP for remote backup stores. A request body is a buffer or a
// file streamed with its size; a 2xx response can stream to a file under a
// byte cap, anything else is buffered under a small cap for the error
// message. node:http(s) streams under both Node and Bun.
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { pipeline } from "stream/promises";
import { Transform, type Readable } from "stream";
import { BACKUP_ARCHIVE_MAX_BYTES, BACKUP_TRANSFER_TIMEOUT_MS } from "./types";
import { PAPERBOARD_USER_AGENT } from "../userAgent";

export interface HttpResult {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

export interface HttpRequestInit {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
    /** stream this file as the body; Content-Length is set from size */
    bodyFile?: { path: string; size: number };
    /** on a 2xx, stream the body here instead of buffering it */
    toFile?: string;
    /** cap for a toFile body */
    maxFileBytes?: number;
    /** cap for a buffered body */
    maxBytes?: number;
    /** idle socket timeout */
    timeoutMs?: number;
    /** total request lifetime, including connection and response streaming */
    totalTimeoutMs?: number;
}

export class HttpStatusError extends Error {
    constructor(
        readonly status: number,
        readonly body: string,
        what: string,
    ) {
        super(`${what} failed (HTTP ${status})${body ? `: ${body.slice(0, 300)}` : ""}`);
    }
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

function isLoopback(host: string): boolean {
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

/** remote stores speak TLS; plain http is for loopback test servers only */
export function assertSecureUrl(raw: string, what: string): URL {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`${what} is not a URL`);
    }
    if (url.protocol === "https:") return url;
    if (url.protocol === "http:" && isLoopback(url.hostname)) return url;
    throw new Error(`${what} must be an https:// address`);
}

export async function httpRequest(rawUrl: string, init: HttpRequestInit = {}): Promise<HttpResult> {
    const url = new URL(rawUrl);
    const transport = url.protocol === "https:" ? https : http;
    const headers: Record<string, string> = { "User-Agent": PAPERBOARD_USER_AGENT, ...init.headers };
    if (init.bodyFile) headers["Content-Length"] = String(init.bodyFile.size);
    else if (init.body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(init.body));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Backup transfer deadline exceeded")),
        Math.min(init.totalTimeoutMs ?? BACKUP_TRANSFER_TIMEOUT_MS, BACKUP_TRANSFER_TIMEOUT_MS));
    let response: http.IncomingMessage | undefined;
    let upload: Readable | undefined;
    let download: Promise<void> | undefined;
    let created = false;
    let req: http.ClientRequest | undefined;
    try {
        return await new Promise<HttpResult>((resolve, reject) => {
            req = transport.request(url, { method: init.method ?? "GET", headers, agent: false, signal: controller.signal }, (res) => {
                response = res;
                const status = res.statusCode ?? 0;
                if (init.toFile && status >= 200 && status < 300) {
                    const cap = Math.min(init.maxFileBytes ?? BACKUP_ARCHIVE_MAX_BYTES, BACKUP_ARCHIVE_MAX_BYTES);
                    const declared = Number(res.headers["content-length"]);
                    if (Number.isFinite(declared) && declared > cap) {
                        res.destroy();
                        reject(new Error(`The download is larger than ${cap} bytes`));
                        return;
                    }
                    let bytes = 0;
                    const counter = new Transform({
                        transform(chunk: Buffer, _enc, done) {
                            bytes += chunk.length;
                            if (bytes > cap) done(new Error(`The download is larger than ${cap} bytes`));
                            else done(null, chunk);
                        },
                    });
                    // Open before pipeline so cleanup knows whether this request
                    // created its file. A refusal never removes someone else's file.
                    let fd: number;
                    try { fd = fs.openSync(init.toFile, "wx", 0o600); }
                    catch (error) { res.destroy(); reject(error); return; }
                    created = true;
                    download = pipeline(res, counter, fs.createWriteStream(init.toFile, { fd, autoClose: true }), { signal: controller.signal });
                    download.then(() => resolve({ status, headers: res.headers, body: Buffer.alloc(0) }), reject);
                    return;
                }
                const cap = init.maxBytes ?? DEFAULT_MAX_BYTES;
                const chunks: Buffer[] = [];
                let size = 0;
                res.on("data", (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > cap) { res.destroy(new Error(`The response is larger than ${cap} bytes`)); return; }
                    chunks.push(chunk);
                });
                res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
                res.on("error", reject);
            });
            req.setTimeout(init.timeoutMs ?? 60_000, () => req!.destroy(new Error(`${url.host} stopped responding`)));
            req.on("error", reject);
            if (init.bodyFile) {
                upload = fs.createReadStream(init.bodyFile.path);
                pipeline(upload, req, { signal: controller.signal }).catch(reject);
            } else req.end(init.body);
        });
    } catch (caught) {
        let error = caught;
        req?.destroy();
        response?.destroy();
        upload?.destroy();
        // Observe stream closure before removing its partial output.
        if (download) await download.catch((streamError) => { error = controller.signal.aborted ? controller.signal.reason : streamError; });
        if (created && init.toFile) await fs.promises.rm(init.toFile, { force: true });
        throw controller.signal.aborted ? controller.signal.reason : error;
    } finally { clearTimeout(timer); }
}

/** the response as text, throwing HttpStatusError outside 2xx */
export function expectOk(result: HttpResult, what: string): HttpResult {
    if (result.status < 200 || result.status >= 300) throw new HttpStatusError(result.status, result.body.toString("utf8"), what);
    return result;
}
