// Electron's own data (Chromium profile: cookies, local storage, caches,
// crash dumps, logs, and the app updater's downloads) lives with the rest of
// Paperboard in <PAPERBOARD_DIR>/local/electron instead of the platform's
// app-data folder (~/.config/Paperboard, ~/Library/Application Support/
// Paperboard, %APPDATA%\Paperboard). Must run before anything reads a path,
// including requestSingleInstanceLock, whose lock lives in userData.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { App } from "electron";
import { getLocalDir } from "../../papercrane/paths";

export function electronDataDir(): string {
    return path.join(getLocalDir(), "electron");
}

export type ElectronDataMove = "current" | "fresh" | "moved" | "in-use";

// Chromium's SingletonLock (Linux, macOS) is a symlink to "<host>-<pid>"
// while a profile is open. A crash can leave it behind, so the pid decides.
// Windows has no symlink; there the open profile makes the rename fail.
function profileInUse(dir: string): boolean {
    let target: string;
    try {
        target = fs.readlinkSync(path.join(dir, "SingletonLock"));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw err;
    }
    const cut = target.lastIndexOf("-");
    const host = target.slice(0, cut);
    const pid = Number(target.slice(cut + 1));
    if (cut < 0 || !Number.isInteger(pid) || pid <= 0) return false;
    // another computer sharing this home: Chromium settles that itself
    if (host !== os.hostname()) return true;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ESRCH") return false;
        // alive, but another account's: still somebody's open profile
        if (code === "EPERM") return true;
        throw err;
    }
}

/**
 * Moves an older install's Electron data from `from` to `to` once. "in-use"
 * means an older Paperboard still has it open: leave it there, and the
 * single-instance lock in it hands this launch to that window. Throws when
 * the move fails, leaving `from` untouched so the next launch retries.
 */
export function moveElectronData(from: string, to: string): ElectronDataMove {
    if (fs.existsSync(to)) return "current";
    if (!fs.existsSync(from)) return "fresh";
    if (profileInUse(from)) return "in-use";
    fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
    try {
        fs.renameSync(from, to);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
        // another filesystem: copy, then drop the original only once the
        // copy is whole; a partial copy is removed so the next launch retries
        try {
            fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true, errorOnExist: true });
        } catch (copyErr) {
            fs.rmSync(to, { recursive: true, force: true });
            throw copyErr;
        }
        fs.rmSync(from, { recursive: true });
    }
    return "moved";
}

/**
 * Points Electron at electronDataDir(), moving an older install's data
 * there first. Returns the error when the move failed; Electron then keeps
 * whichever folder holds the data for this run and the caller reports it.
 */
export function relocateElectronData(app: App): Error | null {
    // an explicit --user-data-dir is the caller's choice
    if (app.commandLine.hasSwitch("user-data-dir")) return null;
    const legacy = app.getPath("userData");
    const dir = electronDataDir();
    let move: ElectronDataMove;
    let error: Error | null = null;
    try {
        move = moveElectronData(legacy, dir);
    } catch (err) {
        // a whole copy whose original could not be removed is still the data
        const copied = fs.existsSync(dir);
        error = new Error(
            copied
                ? `Moved Paperboard's Electron data to ${dir}, but could not remove ${legacy}: ${(err as Error).message}. You can delete it yourself.`
                : `Could not move Paperboard's Electron data from ${legacy} to ${dir}: ${(err as Error).message}. ` +
                      "Paperboard is using the old folder for now and tries again on the next launch.",
        );
        if (!copied) return error;
        move = "moved";
    }
    if (move === "in-use") return null;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    app.setPath("userData", dir);
    app.setPath("sessionData", dir);
    app.setPath("crashDumps", path.join(dir, "Crashpad"));
    app.setAppLogsPath(path.join(dir, "logs"));
    return error;
}
