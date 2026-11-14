// Downloads for the updaters: bytes hashed in memory for small files, a
// streamed temp file for archives that are listed with `tar -t`.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const UPDATER_USER_AGENT = "Origami-Package-Updater/2.0";

export async function fetchBytes(url: string, fetchFn: typeof fetch, timeoutMs: number, headers: Record<string, string> = {}): Promise<Buffer> {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
}

export async function fetchHashed(url: string, fetchFn: typeof fetch, timeoutMs: number): Promise<{ sha256: string; size: number }> {
    const bytes = await fetchBytes(url, fetchFn, timeoutMs);
    return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength };
}

export interface StreamedDownload {
    /** the archive on disk, deleted when the callback settles */
    path: string;
    size: number;
    sha1: string;
    sha256: string;
    /** hex */
    sha512: string;
}

/**
 * Streams the URL into a temp file while hashing it, hands it to `use`, and
 * always deletes it. Nothing in the file is extracted or run by this.
 */
export async function withStreamedDownload<T>(
    url: string,
    fetchFn: typeof fetch,
    opts: { prefix: string; file: string },
    use: (download: StreamedDownload) => Promise<T>,
): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), opts.prefix));
    try {
        const res = await fetchFn(url, { headers: { "User-Agent": UPDATER_USER_AGENT }, redirect: "follow" });
        if (!res.ok || !res.body) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
        const file = path.join(dir, opts.file);
        const hashes = { sha1: createHash("sha1"), sha256: createHash("sha256"), sha512: createHash("sha512") };
        let size = 0;
        const tap = new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                size += chunk.byteLength;
                for (const h of Object.values(hashes)) h.update(chunk);
                controller.enqueue(chunk);
            },
        });
        await pipeline(Readable.fromWeb(res.body.pipeThrough(tap) as never), createWriteStream(file));
        return await use({ path: file, size, sha1: hashes.sha1.digest("hex"), sha256: hashes.sha256.digest("hex"), sha512: hashes.sha512.digest("hex") });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/** Member paths of a .tar.gz. argv array, no shell; -t only lists. */
export function listTar(archive: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        execFile("tar", ["-tzf", archive], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`tar -tzf failed: ${stderr.trim() || err.message}`));
                return;
            }
            resolve(stdout.split("\n").filter(Boolean));
        });
    });
}
