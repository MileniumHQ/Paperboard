// Path containment for panel storage: a path a panel names resolves inside
// its own folder, and nothing on the way there may be a link.
import * as fs from "fs";
import * as path from "path";
import { errorCode } from "../../../packages/paperapi/src/errors";

// A component below an existing file is as absent as a missing one
export function isMissingPathError(error: unknown): boolean {
    const code = errorCode(error);
    return code === "ENOENT" || code === "ENOTDIR";
}

function isSameEntry(a: fs.BigIntStats, b: fs.BigIntStats): boolean {
    return a.dev === b.dev && a.ino === b.ino;
}

// Resolve a relative path inside an isolated dir, rejecting traversal and links.
// Call again immediately before filesystem use after any asynchronous work.
export function resolveSecureTargetPath(
    baseDir: string,
    targetPath: string,
    appId?: string,
): string {
    const cleanAppId = appId
        ? appId.replace(/[^a-zA-Z0-9_.-]/g, "_")
        : "default";
    baseDir = path.resolve(baseDir);
    const base = path.join(baseDir, cleanAppId);
    const resolved = path.resolve(base, String(targetPath).replace(/^[/\\]+/, ""));
    const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
    if (resolved !== base && !resolved.startsWith(baseWithSep)) {
        throw new Error(
            `Access denied: path traverses outside assigned storage for ${cleanAppId}`,
        );
    }
    // The files root is daemon-owned; OS aliases above it (e.g. /var on
    // macOS) are allowed, but the root, panel home and every existing path
    // component below it must be real entries, including dangling links.
    // Entries are compared by identity, never by path text: a case-insensitive
    // or normalizing filesystem (APFS, NTFS) reports the stored spelling.
    let rootStat: fs.Stats;
    try { rootStat = fs.lstatSync(baseDir); }
    catch (error) {
        if (isMissingPathError(error)) return resolved;
        throw error;
    }
    if (rootStat.isSymbolicLink()) throw new Error("Access denied: symbolic link at storage root");
    if (!hasOnlyRealEntriesBelow(baseDir, resolved)) {
        throw new Error(`Access denied: symbolic link in storage path for ${cleanAppId}`);
    }
    return resolved;
}

/**
 * Whether every existing path component from `root` (exclusive) down to
 * `target` is a real entry, not a link, dangling links included. `target`
 * must already be inside `root` by path text.
 */
export function hasOnlyRealEntriesBelow(root: string, target: string): boolean {
    let current = root;
    for (const segment of path.relative(root, target).split(path.sep)) {
        if (!segment) continue;
        current = path.join(current, segment);
        let stat: fs.BigIntStats;
        try { stat = fs.lstatSync(current, { bigint: true }); }
        catch (error) {
            if (isMissingPathError(error)) return true;
            throw error;
        }
        if (stat.isSymbolicLink() || !isSameEntry(stat, fs.statSync(fs.realpathSync(current), { bigint: true }))) return false;
    }
    return true;
}

/** Open without following the leaf, then recheck the chain and inode before use. */
export function openResolvedFile(target: string, validate: () => string, flags = fs.constants.O_RDONLY): number {
    validate();
    // Never truncate before validation: an ancestor may change during open.
    const fd = fs.openSync(target, flags | fs.constants.O_NOFOLLOW);
    try {
        validate();
        const opened = fs.fstatSync(fd);
        const current = fs.lstatSync(target);
        if (!opened.isFile() || current.isSymbolicLink() || opened.dev !== current.dev || opened.ino !== current.ino) {
            throw new Error("Access denied: storage file changed while opening");
        }
        return fd;
    } catch (error) { fs.closeSync(fd); throw error; }
}
