// One streamed request body written to a file atomically: the bytes land
// in a sibling temp file and replace the target only once the whole body
// arrived under the cap. A failed, aborted or oversized upload leaves the
// previous file untouched and no temp file behind.
import type * as http from "http";
import * as fs from "fs";
import { logger } from "./logger";
import * as path from "path";
import { randomUUID } from "crypto";
import { Transform } from "stream";
import { pipeline } from "stream/promises";

export class UploadTooLargeError extends Error {
    constructor(readonly cap: number) {
        super(`upload exceeds ${cap} byte cap`);
    }
}

export async function receiveFileAtomic(
    req: http.IncomingMessage,
    target: string,
    cap: number,
    validateTarget?: () => string,
): Promise<void> {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > cap) {
        req.resume();
        throw new UploadTooLargeError(cap);
    }
    validateTarget?.();
    const parent = path.dirname(target);
    const dirFd = process.platform === "linux"
        ? fs.openSync(parent, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)
        : undefined;
    // Linux exposes descriptor-relative paths. Pin the parent through the
    // transfer so even a renamed directory permits cleanup of our own temp.
    const pinnedParent = dirFd !== undefined ? `/proc/self/fd/${dirFd}` : parent;
    const tmpName = `${path.basename(target)}.davpart-${randomUUID()}`;
    const tmp = path.join(pinnedParent, tmpName);
    let created: fs.BigIntStats | undefined;
    let parentIdentity: fs.BigIntStats | undefined;
    try {
        validateTarget?.();
        const before = dirFd !== undefined ? fs.fstatSync(dirFd, { bigint: true }) : fs.lstatSync(parent, { bigint: true });
        parentIdentity = before;
        const current = fs.lstatSync(parent, { bigint: true });
        if (before.dev !== current.dev || before.ino !== current.ino || current.isSymbolicLink()) {
            throw new Error("Access denied: upload directory changed");
        }
        const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        created = fs.fstatSync(fd, { bigint: true });
        let written = 0;
        const counter = new Transform({
            transform(chunk: Buffer, _encoding, done) {
                written += chunk.length;
                if (written > cap) done(new UploadTooLargeError(cap));
                else done(null, chunk);
            },
        });
        // Keep the HTTP request alive long enough to return a typed refusal;
        // pipeline owns and closes both file-side streams on failure.
        const body = req.pipe(counter);
        const abort = () => counter.destroy(new Error("Upload aborted"));
        const fail = (error: Error) => counter.destroy(error);
        req.once("aborted", abort);
        req.once("error", fail);
        try { await pipeline(body, fs.createWriteStream(tmp, { fd, autoClose: true })); }
        finally {
            req.unpipe(counter);
            req.off("aborted", abort);
            req.off("error", fail);
        }
        validateTarget?.();
        const after = fs.lstatSync(parent, { bigint: true });
        if (before.dev !== after.dev || before.ino !== after.ino || after.isSymbolicLink()) {
            throw new Error("Access denied: upload directory changed");
        }
        fs.renameSync(tmp, path.join(pinnedParent, path.basename(target)));
    } catch (err) {
        req.resume();
        try { if (created && parentIdentity) removeStagedFile(pinnedParent, parent, parentIdentity, tmpName, created); }
        catch (cleanupErr) { logger.error("[upload] tmp cleanup failed:", cleanupErr); }
        throw err;
    } finally { if (dirFd !== undefined) fs.closeSync(dirFd); }
}

/**
 * Remove our own temp file even when the directory holding it was renamed
 * away mid-upload. A pinned descriptor path (Linux) always reaches it. Without
 * one, `parent` is only a name: if it no longer is the directory the temp was
 * created in, look for that directory by identity among its former siblings.
 * The file is unlinked only if it is still the inode this upload created.
 */
function removeStagedFile(
    pinnedParent: string,
    parent: string,
    parentIdentity: fs.BigIntStats,
    tmpName: string,
    created: fs.BigIntStats,
): void {
    const isParent = (stat: fs.BigIntStats) => stat.dev === parentIdentity.dev && stat.ino === parentIdentity.ino && !stat.isSymbolicLink();
    let dir: string | undefined;
    if (pinnedParent !== parent) dir = pinnedParent;
    else {
        let current: fs.BigIntStats | undefined;
        try { current = fs.lstatSync(parent, { bigint: true }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (current && isParent(current)) dir = parent;
        else {
            const grandparent = path.dirname(parent);
            for (const name of fs.readdirSync(grandparent)) {
                const candidate = path.join(grandparent, name);
                let stat: fs.BigIntStats;
                try { stat = fs.lstatSync(candidate, { bigint: true }); }
                catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
                if (isParent(stat)) { dir = candidate; break; }
            }
        }
    }
    if (!dir) throw new Error(`staged upload ${tmpName} is in a directory that moved out of ${path.dirname(parent)}`);
    const file = path.join(dir, tmpName);
    let stat: fs.BigIntStats;
    try { stat = fs.lstatSync(file, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (stat.dev !== created.dev || stat.ino !== created.ino) throw new Error(`staged upload ${tmpName} was replaced; leaving it in place`);
    fs.unlinkSync(file);
}
