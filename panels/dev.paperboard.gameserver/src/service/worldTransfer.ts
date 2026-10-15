import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, type UnzipFile } from "fflate";
import { files as fileApi, type ServiceContext } from "@mileniumhq/paperapi";
import {
    DIMENSION_SUFFIXES,
    MAX_WORLD_EXPORT_BYTES,
    MAX_WORLD_EXPORT_ENTRIES,
    MAX_WORLD_IMPORT_BYTES,
    MAX_WORLD_IMPORT_ENTRIES,
    WORLD_TRANSFER_DIR,
    planWorldImport,
    skipOnExport,
    storeWithoutCompression,
} from "../core/worldArchive";
import { assertShellSafeLevelName } from "../core/worlds";
import { withSavingPaused } from "./saving";
import { resolveLevelName } from "./worlds";
import { PANEL_ID, type GameServerState } from "./types";

// Worlds as zip files: a download zips a world's folders into the transfer
// folder for the page to export; an upload is a zip the page imported
// there, unpacked into new world folders. One transfer runs at a time, and
// its file in the transfer folder is removed when it is done with.

const READ_CHUNK = 64 * 1024;
let running = false;

async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (running) throw new Error("Another world upload or download is running");
    running = true;
    try {
        return await work();
    } finally {
        running = false;
    }
}

const serverDir = () => fileApi.getPath("", PANEL_ID);

/** a file the page gave or will take, by bare name, inside the transfer folder */
function transferFile(root: string, name: unknown): string {
    const clean = String(name ?? "");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.zip$/.test(clean) || clean.includes("..")) {
        throw new Error("That is not a world transfer file");
    }
    return nodePath.join(root, WORLD_TRANSFER_DIR, clean);
}

async function listFiles(root: string, folder: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (relative: string) => {
        const entries = await nodeFs.readdir(nodePath.join(root, relative), { withFileTypes: true });
        for (const entry of entries) {
            const path = `${relative}/${entry.name}`;
            if (entry.isDirectory()) await walk(path);
            // links and devices are not world data; a link could point anywhere
            else if (entry.isFile() && !skipOnExport(path)) out.push(path);
            if (out.length > MAX_WORLD_EXPORT_ENTRIES) {
                throw new Error(`This world has over ${MAX_WORLD_EXPORT_ENTRIES} files, more than one download can hold`);
            }
        }
    };
    await walk(folder);
    return out;
}

/**
 * Zips `levelName`'s folders as `<levelName>.zip` in the transfer folder
 * and returns that file's name. A running server's saving is paused for
 * the copy when it is the world being played.
 */
export function exportWorld(ctx: ServiceContext<GameServerState>, levelName: unknown): Promise<{ file: string; bytes: number }> {
    return exclusive(async () => {
        const name = assertShellSafeLevelName(levelName);
        const root = await serverDir();
        const folders: string[] = [];
        for (const suffix of DIMENSION_SUFFIXES) {
            const stat = await nodeFs.lstat(nodePath.join(root, `${name}${suffix}`)).catch((err) => {
                if (err?.code === "ENOENT") return null;
                throw err;
            });
            if (stat?.isDirectory()) folders.push(`${name}${suffix}`);
        }
        if (!folders.includes(name)) throw new Error(`There is no world folder named "${name}"`);

        await nodeFs.mkdir(nodePath.join(root, WORLD_TRANSFER_DIR), { recursive: true });
        const file = `${name.replace(/[^A-Za-z0-9_-]/g, "_")}.zip`;
        const target = transferFile(root, file);
        const active = (await resolveLevelName()).toLowerCase() === name.toLowerCase();
        const copy = () => writeZip(root, folders, target);
        try {
            const bytes = await (active ? withSavingPaused(ctx, copy) : copy());
            return { file, bytes };
        } catch (err) {
            await nodeFs.rm(target, { force: true });
            throw err;
        }
    });
}

export async function writeZip(root: string, folders: string[], target: string): Promise<number> {
    const paths: string[] = [];
    for (const folder of folders) paths.push(...(await listFiles(root, folder)));
    if (paths.length > MAX_WORLD_EXPORT_ENTRIES) {
        throw new Error(`This world has over ${MAX_WORLD_EXPORT_ENTRIES} files, more than one download can hold`);
    }

    const out = await nodeFs.open(target, "w");
    let written = 0;
    let failure: unknown = null;
    let pending: Promise<void> = Promise.resolve();
    const zip = new Zip((err, data) => {
        if (err) failure ??= err;
        if (failure || data.byteLength === 0) return;
        written += data.byteLength;
        if (written > MAX_WORLD_EXPORT_BYTES) {
            failure ??= new Error("This world is over 2 GB zipped, more than one download can hold");
            return;
        }
        pending = pending.then(() => out.write(data).then(() => undefined));
    });
    // each chunk's output is written before the next chunk is read
    const drain = async () => {
        await pending;
        if (failure) throw failure;
    };
    try {
        for (const path of paths) {
            const entry = storeWithoutCompression(path) ? new ZipPassThrough(path) : new ZipDeflate(path, { level: 6 });
            zip.add(entry);
            const source = await nodeFs.open(nodePath.join(root, path), "r");
            try {
                const buffer = new Uint8Array(READ_CHUNK);
                for (;;) {
                    const { bytesRead } = await source.read(buffer, 0, READ_CHUNK, null);
                    entry.push(buffer.slice(0, bytesRead), bytesRead === 0);
                    await drain();
                    if (bytesRead === 0) break;
                }
            } finally {
                await source.close();
            }
        }
        zip.end();
        await drain();
    } finally {
        // a failed write was already raised by drain; this only waits it out
        await Promise.allSettled([pending]);
        await out.close();
    }
    return written;
}

/** removes a transfer file the page is done with */
export async function discardWorldTransfer(file: unknown): Promise<void> {
    await nodeFs.rm(transferFile(await serverDir(), file), { force: true });
}

/**
 * Unpacks an uploaded zip from the transfer folder into new world folders
 * named `name`. Nothing of an existing world is touched: a name already
 * used is refused, and the folders appear only once fully written.
 */
export function importWorld(file: unknown, requestedName: unknown): Promise<{ name: string; folders: string[] }> {
    return exclusive(async () => {
        const root = await serverDir();
        const archive = transferFile(root, file);
        const name = String(requestedName ?? "").trim();
        try {
            const taken = new Set((await nodeFs.readdir(root)).map((entry) => entry.toLowerCase()));
            for (const suffix of DIMENSION_SUFFIXES) {
                if (taken.has(`${name}${suffix}`.toLowerCase())) throw new Error(`A world or folder named "${name}${suffix}" already exists`);
            }
            const plan = planWorldImport(await zipEntryNames(archive), name);
            const staging = nodePath.join(root, WORLD_TRANSFER_DIR, `import-${randomUUID()}`);
            try {
                await unpack(archive, staging, plan.targets);
                const moved: string[] = [];
                try {
                    for (const folder of plan.folders) {
                        // a folder that appeared meanwhile is not replaced
                        await nodeFs.mkdir(nodePath.join(root, folder));
                        await nodeFs.rmdir(nodePath.join(root, folder));
                        await nodeFs.rename(nodePath.join(staging, folder), nodePath.join(root, folder));
                        moved.push(folder);
                    }
                } catch (err) {
                    for (const folder of moved) await nodeFs.rename(nodePath.join(root, folder), nodePath.join(staging, folder));
                    throw err;
                }
            } finally {
                await nodeFs.rm(staging, { recursive: true, force: true });
            }
            return { name, folders: plan.folders };
        } finally {
            await nodeFs.rm(archive, { force: true });
        }
    });
}

async function readZip(archive: string, onFile: (file: UnzipFile) => void, settle: () => Promise<void>): Promise<void> {
    const unzip = new Unzip(onFile);
    unzip.register(UnzipInflate);
    const handle = await nodeFs.open(archive, "r");
    try {
        const buffer = new Uint8Array(READ_CHUNK);
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, READ_CHUNK, null);
            const final = bytesRead === 0;
            try {
                unzip.push(buffer.slice(0, bytesRead), final);
            } catch (err) {
                throw new Error(`This zip is damaged: ${err instanceof Error ? err.message : String(err)}`);
            }
            await settle();
            if (final) break;
        }
    } finally {
        await handle.close();
    }
}

export async function zipEntryNames(archive: string): Promise<string[]> {
    const names: string[] = [];
    let failure: Error | null = null;
    await readZip(archive, (file) => {
        if (names.length >= MAX_WORLD_IMPORT_ENTRIES) failure ??= new Error(`This zip holds over ${MAX_WORLD_IMPORT_ENTRIES} files`);
        else names.push(file.name);
    }, async () => {
        if (failure) throw failure;
    });
    return names;
}

export async function unpack(archive: string, staging: string, targets: Map<string, string>): Promise<void> {
    let total = 0;
    let failure: unknown = null;
    const inflight: Promise<void>[] = [];
    const open = new Set<nodeFs.FileHandle>();
    const stop = (file: UnzipFile, err: Error) => {
        failure ??= err;
        file.terminate();
    };
    const settle = async () => {
        const results = await Promise.allSettled(inflight.splice(0));
        const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (rejected) failure ??= rejected.reason;
        if (failure) throw failure;
    };
    try {
        await readZip(archive, (file) => {
            if (failure) return;
            const target = targets.get(file.name);
            if (!target) return;
            if (file.compression !== 0 && file.compression !== 8) return stop(file, new Error(`${file.name} uses a compression Paperboard cannot read`));
            const out = nodePath.join(staging, ...target.split("/"));
            let handle: nodeFs.FileHandle | null = null;
            let chain: Promise<void> = (async () => {
                await nodeFs.mkdir(nodePath.dirname(out), { recursive: true });
                // "wx": a path the zip repeats under another spelling fails here
                handle = await nodeFs.open(out, "wx");
                open.add(handle);
            })();
            inflight.push(chain);
            file.ondata = (err, data, final) => {
                if (err) return stop(file, err);
                total += data.byteLength;
                if (total > MAX_WORLD_IMPORT_BYTES) return stop(file, new Error("This world unpacks to over 16 GB"));
                chain = chain.then(async () => {
                    await handle!.write(data);
                    if (final) {
                        await handle!.close();
                        open.delete(handle!);
                    }
                });
                inflight.push(chain);
            };
            file.start();
        }, settle);
    } finally {
        await Promise.allSettled(inflight.splice(0));
        for (const handle of open) await handle.close();
    }
}
