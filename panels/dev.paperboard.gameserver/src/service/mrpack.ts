import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import {
    INDEX_ENTRY,
    MAX_INDEX_BYTES,
    MAX_OVERRIDE_BYTES,
    MAX_OVERRIDE_FILE_BYTES,
    MAX_PACK_FILES,
    OVERRIDE_DIRS,
    overrideTarget,
    packPathKey,
} from "../core/modpack";

// Reads a downloaded .mrpack without trusting its sizes: the archive is
// streamed through the unzipper, and only the index and the override
// folders are inflated, each counted as it decompresses. A pack that
// claims a small file and inflates to gigabytes is stopped at the cap.

const READ_CHUNK = 16 * 1024;

export interface ExtractedPack {
    /** the parsed modrinth.index.json, not yet validated */
    index: unknown;
    /**
     * override files per layer (overrides/, then server-overrides/), keyed by
     * packPathKey; each is written under `<layersDir>/<layer>/<path>`
     */
    layers: Map<string, string>[];
    /** override paths the server keeps, left out */
    kept: string[];
}

function fail(reason: string): Error {
    return new Error(`This modpack cannot be installed: ${reason}`);
}

export async function extractMrpack(opts: {
    archive: string;
    layersDir: string;
    levelName: string;
}): Promise<ExtractedPack> {
    const layers: Map<string, string>[] = OVERRIDE_DIRS.map(() => new Map());
    const kept: string[] = [];
    const indexChunks: Uint8Array[] = [];
    let indexBytes = 0;
    let indexSeen = false;
    let indexDone = false;
    let fileCount = 0;
    let overrideBytes = 0;
    let failure: unknown = null;
    const inflight: Promise<void>[] = [];
    const openHandles = new Set<nodeFs.FileHandle>();

    const stop = (file: UnzipFile, err: Error) => {
        failure ??= err;
        file.terminate();
    };

    const unzip = new Unzip((file) => {
        if (failure) return;
        if (file.name === INDEX_ENTRY) {
            if (indexSeen) return stop(file, fail(`it has two ${INDEX_ENTRY} entries`));
            indexSeen = true;
            file.ondata = (err, data, final) => {
                if (err) return stop(file, err);
                indexBytes += data.byteLength;
                if (indexBytes > MAX_INDEX_BYTES) return stop(file, fail("its index is too large"));
                indexChunks.push(data);
                if (final) indexDone = true;
            };
            file.start();
            return;
        }
        const target = overrideTarget(file.name, opts.levelName);
        if (target.kind === "unsafe") return stop(file, new Error(target.reason));
        if (target.kind === "skip") return;
        if (target.kind === "kept") {
            kept.push(target.path);
            return;
        }
        const layer = OVERRIDE_DIRS.findIndex((prefix) => file.name.startsWith(prefix));
        const key = packPathKey(target.path);
        if (layers[layer]!.has(key)) return stop(file, fail(`it carries ${target.path} twice`));
        fileCount += 1;
        if (fileCount > MAX_PACK_FILES) return stop(file, fail(`it carries over ${MAX_PACK_FILES} override files`));
        layers[layer]!.set(key, target.path);
        if (file.compression !== 0 && file.compression !== 8) {
            return stop(file, fail(`${target.path} uses an unsupported compression`));
        }

        const out = nodePath.join(opts.layersDir, String(layer), ...target.path.split("/"));
        let handle: nodeFs.FileHandle | null = null;
        let written = 0;
        let chain: Promise<void> = (async () => {
            await nodeFs.mkdir(nodePath.dirname(out), { recursive: true });
            // "wx": a path the archive repeats under another spelling fails here
            handle = await nodeFs.open(out, "wx");
            openHandles.add(handle);
        })();
        inflight.push(chain);
        file.ondata = (err, data, final) => {
            if (err) return stop(file, err);
            written += data.byteLength;
            overrideBytes += data.byteLength;
            if (written > MAX_OVERRIDE_FILE_BYTES) return stop(file, fail(`${target.path} is over the 64 MiB override limit`));
            if (overrideBytes > MAX_OVERRIDE_BYTES) return stop(file, fail("its overrides are over the 512 MiB limit"));
            chain = chain.then(async () => {
                await handle!.write(data);
                if (final) {
                    await handle!.close();
                    openHandles.delete(handle!);
                }
            });
            inflight.push(chain);
        };
        file.start();
    });
    unzip.register(UnzipInflate);

    const settle = async () => {
        const results = await Promise.allSettled(inflight.splice(0));
        const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (rejected) failure ??= rejected.reason;
    };

    const archive = await nodeFs.open(opts.archive, "r");
    try {
        const buffer = new Uint8Array(READ_CHUNK);
        for (;;) {
            const { bytesRead } = await archive.read(buffer, 0, READ_CHUNK, null);
            const final = bytesRead === 0;
            try {
                unzip.push(buffer.slice(0, bytesRead), final);
            } catch (err) {
                failure ??= fail(`the archive is damaged (${err instanceof Error ? err.message : String(err)})`);
            }
            // the writes this chunk produced finish before the next is read:
            // memory holds one chunk's worth of inflated data at most
            await settle();
            if (failure) throw failure;
            if (final) break;
        }
    } finally {
        await settle();
        await archive.close();
        for (const handle of openHandles) await handle.close();
    }

    if (!indexSeen || !indexDone) throw fail(`it has no ${INDEX_ENTRY}`);
    const bytes = new Uint8Array(indexBytes);
    let offset = 0;
    for (const chunk of indexChunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(bytes);
    let index: unknown;
    try {
        index = JSON.parse(text);
    } catch (err) {
        throw fail(`its index is not JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    return { index, layers, kept };
}
