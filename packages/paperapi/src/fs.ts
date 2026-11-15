// Replacing a file whole or not at all, in a panel's service: the new
// contents go to a temp file of their own beside it, are flushed to disk,
// and the temp file is renamed over the old one. A crash leaves the old
// file, never half of the new one, and a failed write takes its temp file
// with it.
//
// Service-only (it uses Node's file system): import it from
// "@mileniumhq/paperapi/fs", never in a page.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { errorMessage } from "./errors";

export interface WriteFileAtomicOptions {
    /**
     * The written file's permissions, set exactly: 0o600 for a secret, or an
     * old file's stat() mode to keep a script executable. Without it, 0o666
     * less the umask, as any new file.
     */
    mode?: number;
}

/** where a write goes first: beside the file, with a name no other writer shares */
function tempFor(file: string): string {
    return `${file}.${randomBytes(6).toString("hex")}.tmp`;
}

const TEMP_NAME = /\.[0-9a-f]{12}\.tmp$/;

/**
 * Whether `name` (a file name or a path) is one of writeFileAtomic's temp
 * files: a write still landing, or one a crash left behind. A file list
 * hides them, and a sweep at startup, before anything writes, may delete them.
 */
export function isWriteFileAtomicTemp(name: string): boolean {
    return TEMP_NAME.test(name);
}

/** the permission bits of a mode, which may be a whole stat() mode */
function permissions(options: WriteFileAtomicOptions): number | undefined {
    return options.mode === undefined ? undefined : options.mode & 0o7777;
}

// a failed cleanup is told, never thrown in place of the write's own failure
function cleanupFailed(tmp: string, err: unknown): void {
    console.error(`[paperapi] couldn't remove ${tmp} after a failed write: ${errorMessage(err)}`);
}

/** Replaces `file` with `data` in one step; its folder is made if it's missing. Throws the write's own failure. */
export async function writeFileAtomic(file: string, data: string | Uint8Array, options: WriteFileAtomicOptions = {}): Promise<void> {
    const mode = permissions(options);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = tempFor(file);
    try {
        // made with its mode, so a secret is never readable by others, even for a moment
        const handle = await fsp.open(tmp, "w", mode ?? 0o666);
        try {
            // and set exactly, past the umask
            if (mode !== undefined) await handle.chmod(mode);
            await handle.writeFile(data);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fsp.rename(tmp, file);
    } catch (err) {
        await fsp.rm(tmp, { force: true }).catch((cleanup) => cleanupFailed(tmp, cleanup));
        throw err;
    }
}

/** writeFileAtomic for code that can't wait: the same steps, blocking. */
export function writeFileAtomicSync(file: string, data: string | Uint8Array, options: WriteFileAtomicOptions = {}): void {
    const mode = permissions(options);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = tempFor(file);
    try {
        const fd = fs.openSync(tmp, "w", mode ?? 0o666);
        try {
            if (mode !== undefined) fs.fchmodSync(fd, mode);
            fs.writeFileSync(fd, data);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
    } catch (err) {
        try {
            fs.rmSync(tmp, { force: true });
        } catch (cleanup) {
            cleanupFailed(tmp, cleanup);
        }
        throw err;
    }
}
