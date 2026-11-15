// HTTP(S) downloads to a file, with progress, checksums and bounds.
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PAPERBOARD_USER_AGENT } from "./userAgent";
import { LimitError } from "./storage";
import { errorMessage } from "@mileniumhq/paperapi/errors";

export interface DownloadProgressPayload {
    stage:
        | "starting"
        | "checking"
        | "stopping"
        | "downloading"
        | "verifying"
        | "extracting"
        | "completed"
        | "error";
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}

export type ProgressCallback = (payload: DownloadProgressPayload) => void;

// Streams a URL to a file with progress and optional SHA check
export async function streamToFileWithProgress(
    url: string,
    tempFilePath: string,
    onProgress?: ProgressCallback,
    expectedSha1?: string,
    expectedSha256?: string,
    // tests lower these; every caller in the daemon takes the defaults
    limits: { maxBytes?: number; idleMs?: number; totalMs?: number } = {},
): Promise<{ sha1: string; sha256: string }> {
    // network downloads only: under Bun (the compiled daemon) fetch also
    // reads file:// URLs, which would let file:download copy any local file
    // (the vault included) into a panel's folder
    let scheme: string;
    try {
        scheme = new URL(url).protocol;
    } catch (err) {
        throw new Error(`Download refused: not a URL (${errorMessage(err)})`);
    }
    if (scheme !== "https:" && scheme !== "http:") {
        throw new Error(`Download refused: only http(s) URLs are downloaded, not ${scheme}`);
    }

    onProgress?.({ stage: "starting", percent: 0, message: "Connecting..." });

    if (activeDownloads >= 8) throw new LimitError("Too many concurrent downloads (max 8)");
    activeDownloads++;
    const controller = new AbortController();
    const idleMs = limits.idleMs ?? 45_000;
    let idle = setTimeout(() => controller.abort(new Error("Download connection timed out")), idleMs);
    const lifetime = setTimeout(() => controller.abort(new Error("Download exceeded lifetime deadline")), limits.totalMs ?? 30 * 60_000);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": PAPERBOARD_USER_AGENT },
        });
        if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
        const totalBytes = Number(res.headers.get("content-length")) || 0;
        const cap = limits.maxBytes ?? 2 * 1024 * 1024 * 1024;
        const overCap = () => new LimitError(`Download exceeds the ${cap % 2 ** 30 === 0 ? `${cap / 2 ** 30} GiB` : `${cap} byte`} cap`);
        if (totalBytes > cap) throw overCap();
        let loadedBytes = 0;
        const sha1 = crypto.createHash("sha1");
        const sha256 = crypto.createHash("sha256");
        await fs.promises.mkdir(path.dirname(tempFilePath), { recursive: true });
        const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            clearTimeout(idle);
            idle = setTimeout(() => controller.abort(new Error("Download stalled")), idleMs);
            loadedBytes += chunk.length;
            if (loadedBytes > cap) { callback(overCap()); return; }
            sha1.update(chunk); sha256.update(chunk);
            try {
                onProgress?.({ stage: "downloading", percent: totalBytes ? Math.min(99, Math.round(loadedBytes / totalBytes * 100)) : 50, bytesLoaded: loadedBytes, bytesTotal: totalBytes });
                callback(null, chunk);
            } catch (err) { callback(err as Error); }
        } });
        await pipeline(Readable.fromWeb(res.body as any), meter, fs.createWriteStream(tempFilePath), { signal: controller.signal });
        const actualSha1 = sha1.digest("hex");
        const actualSha256 = sha256.digest("hex");
        if (expectedSha1 && actualSha1 !== expectedSha1.toLowerCase()) throw new Error("SHA1 mismatch");
        if (expectedSha256 && actualSha256 !== expectedSha256.toLowerCase()) throw new Error("SHA256 mismatch");
        return { sha1: actualSha1, sha256: actualSha256 };
    } catch (err) {
        controller.abort();
        await fs.promises.rm(tempFilePath, { force: true });
        throw err;
    } finally {
        clearTimeout(idle); clearTimeout(lifetime);
        activeDownloads--;
    }
}
let activeDownloads = 0;
