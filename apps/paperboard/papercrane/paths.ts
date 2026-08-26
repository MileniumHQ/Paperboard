import * as os from "os";
import * as path from "path";

// Single source of truth for the Paperboard data directory.
// Defaults to ~/.paperboard; override with PAPERBOARD_DIR or via setPaperboardDir().
let overrideDir: string | null = null;

export function setPaperboardDir(dir: string): void {
    overrideDir = dir;
}

export function getPaperboardDir(): string {
    if (overrideDir) return overrideDir;
    if (process.env.PAPERBOARD_DIR) return process.env.PAPERBOARD_DIR;
    return path.join(os.homedir(), ".paperboard");
}

export function getAppsDir(): string {
    return path.join(getPaperboardDir(), "apps");
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
