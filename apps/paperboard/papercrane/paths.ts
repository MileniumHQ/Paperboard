import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// data directory, override with PAPERBOARD_DIR
let overrideDir: string | null = null;

export function setPaperboardDir(dir: string): void {
    overrideDir = dir;
}

export function getPaperboardDir(): string {
    if (overrideDir) return overrideDir;
    if (process.env.PAPERBOARD_DIR) return process.env.PAPERBOARD_DIR;
    return path.join(os.homedir(), ".paperboard");
}

export function getPackagesDir(): string {
    return path.join(getPaperboardDir(), "packages");
}

export function getPanelsDir(): string {
    return path.join(getPaperboardDir(), "panels");
}

export function getConfigsDir(): string {
    return path.join(getPaperboardDir(), "configs");
}

export function getFilesDir(): string {
    return path.join(getPaperboardDir(), "files");
}

export function getLocalDir(): string {
    return path.join(getPaperboardDir(), "local");
}

export function getLogsDir(): string {
    return path.join(getPaperboardDir(), "logs");
}

export function getSocketsDir(): string {
    return path.join(getPaperboardDir(), "sockets");
}

// sockets/ holds supervisor endpoints (a client may type into a running
// terminal) and their metadata (args, env): owner-only, so another account
// cannot list, read or connect whatever the umask was. Re-applied on every
// use so a directory made by an older build is tightened too. Like local/,
// a filesystem without modes (FAT) refuses the chmod; that is reported and
// the directory is used as it is.
export function ensurePrivateDir(dir: string): string {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32" && (fs.statSync(dir).mode & 0o077) !== 0) {
        try { fs.chmodSync(dir, 0o700); }
        catch (err) { console.warn(`[paths.ts] could not restrict ${dir} to its owner:`, err); }
    }
    return dir;
}

// ensure a directory exists, no-op on failure
export function ensureDir(dir: string): string {
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (err) { console.error("[paths.ts] ensureDir failed:", err) }
    return dir;
}
