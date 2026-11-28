// One daemon per data folder, held by the operating system before the
// daemon reads or writes anything in the folder. A claim is names the
// system holds for this process alone, taken without waiting, and ended with
// the process however it ends. Nothing is kept on disk for it, so there is
// nothing to lose, copy, replace or clear.
//
//   Linux    two sockets in the abstract namespace (no file): only one
//            process can listen on a name, and the kernel frees it with
//            the process
//   Windows  two named pipes: only one process can create a name
//   macOS    an exclusive flock on the data folder itself, taken as it is
//            opened (O_EXLOCK | O_NONBLOCK)
//
// On Linux and Windows the two names are, in the order they are taken:
//
//   the folder   named by the folder's device and inode (volume serial
//                number and file id): the same folder under another
//                spelling (a symlink, a junction, a bind mount, another
//                casing on a case-insensitive disk) is the same name
//   the path     named by the data folder's path as it was given (made
//                absolute, never resolved through a symlink): a path that
//                leads to another folder than it did (the folder moved
//                away, deleted and made again, a symlink pointed elsewhere)
//                is still the same name
//
// A start that finds the folder's name held stops there: another server
// uses this folder. One that takes it but finds the path's name held lets
// it go and stops: a server that started on this path still runs, on the
// folder that was here before. On macOS the lock is on the folder alone, so
// a path that leads to a new folder is free to claim at once.
//
// A daemon doesn't follow its folder. Every write goes by path, so a daemon
// checks that the path still leads to the folder it claimed (same device,
// inode and birth time) before it writes the folder's state (checkDataWrite:
// the atomic state files, core/storage.ts; each save of the record store;
// each log line), and once a second for everything else. Once the path
// leads elsewhere, or nowhere, no checked write is made again and the
// daemon stops (onLost). Writes that aren't checked (a panel's own files, an
// install, a backup) can still land at the path in the second before the
// timer finds it.
//
// Before the claim, a start makes exactly one thing: the data folder, when
// it is missing (with any missing folders above it, made as any folder is;
// only the data folder is private), empty. A folder has to be there to be
// claimed; making it is safe for any number of starters at once and puts
// nothing in it.
//
// Another program on this computer may hold a name (on Linux and Windows
// any account can take any name first). Then no daemon starts on the folder
// until it lets go, and the error says which name is held; it can't make two
// daemons run on one folder.
//
// What the claim can't cover, said at start where it can be found cheaply
// (claimLimits) and in the docs (data-directory): two computers sharing one
// folder over a network share (each claims on its own computer), and on
// Linux two containers with network namespaces of their own sharing one
// folder (abstract names are per network namespace; this can't be told
// from inside a container, so it is said only in the docs). A Paperboard
// before this one takes no claim (refuseRunningDaemon, server.ts).
//
// In this process, a claim that is being released (releaseAfter) is waited
// for: a daemon embedded in the app and started again at once opens the
// folder only after the last one has saved its last writes.
import * as crypto from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { errorCode, errorMessage } from "@mileniumhq/paperapi/errors";
import { getPaperboardDir } from "./paths";

// macOS's open(2) flag for an exclusive flock: Node names no constant for it
const O_EXLOCK = 0x20;
/** how often a daemon looks whether its data path still leads to its folder, besides before each checked write */
const WATCH_MS = 1000;

/** Another daemon, or another program on this computer, holds this data folder's claim. */
export class FolderClaimedError extends Error {
    /**
     * "folder": another server uses this folder; "path": one that started
     * on this path still runs, on the folder that was there before.
     */
    constructor(message: string, readonly held: "folder" | "path") {
        super(message);
        this.name = "FolderClaimedError";
    }
}

/** The data path no longer leads to the folder this daemon claimed: it was moved, deleted or replaced. */
export class DataFolderMovedError extends Error {
    constructor(dir: string) {
        super(
            `The data folder ${dir} was moved, deleted or replaced while Paperboard was running. This Paperboard server stopped and wrote nothing more there; ` +
                `what it hadn't saved yet is not saved. Start Paperboard again to use the folder that is at ${dir} now.`,
        );
        this.name = "DataFolderMovedError";
    }
}

/** A data folder this process holds. */
export interface FolderClaim {
    /** the data folder as it was claimed */
    readonly dir: string;
    /** What Paperboard can't guarantee for this folder (claimLimits), for the daemon to tell; empty for none. */
    readonly limits: string[];
    /** Hears, once, that the data path no longer leads to the claimed folder; returns the unsubscribe. */
    onLost(listener: (err: DataFolderMovedError) => void): () => void;
    /**
     * Ends the claim once `last` settles (the folder's last writes saved),
     * whether it resolves or rejects. A claim of the folder in this process
     * meanwhile waits for it. Resolves once the claim is ended; calling it
     * again returns the same.
     */
    releaseAfter(last: Promise<unknown>): Promise<void>;
}

/** what a folder is, wherever its path leads: device, inode and birth time (birth time tells an inode used again) */
interface FolderStat {
    dev: bigint;
    ino: bigint;
    birth: bigint;
}

function statFolder(dir: string): FolderStat {
    const stat = fs.statSync(dir, { bigint: true });
    if (!stat.isDirectory()) throw new Error(`${dir} isn't a folder`);
    return { dev: stat.dev, ino: stat.ino, birth: stat.birthtimeNs };
}

/** the names a claim of `dir` takes on this platform: the folder's, then the path's; on macOS only the folder's lock */
function claimNames(dir: string, stat: FolderStat): { folder: string; path: string | null } {
    const folder = `paperboard-daemon-${stat.dev.toString(16)}-${stat.ino.toString(16)}`;
    if (process.platform === "darwin") return { folder, path: null };
    // the path as given, made absolute: a Windows path is the same in any casing
    const spelled = path.resolve(dir);
    const digest = crypto.createHash("sha256").update(process.platform === "win32" ? spelled.toLowerCase() : spelled).digest("hex").slice(0, 32);
    return { folder, path: `paperboard-daemon-path-${digest}` };
}

/** a name as a person could look for it */
function describe(name: string | null): string {
    if (name === null) return "a lock on the folder";
    return process.platform === "win32" ? `the named pipe \\\\.\\pipe\\${name}` : `the abstract socket @${name}`;
}

/**
 * What this runtime names the claim of `dir` (the folder must exist): the
 * folder's name (on macOS the lock takes none, but the folder is the same
 * device and inode) and the path's. For tests that compare runtimes: a
 * claim takes exactly these.
 */
export function claimNamesOf(dir: string): { folder: string; path: string | null } {
    return claimNames(path.resolve(dir), statFolder(dir));
}

/** listens on the name; null when another process does already */
function listenAt(name: string): Promise<net.Server | null> {
    const address = process.platform === "win32" ? `\\\\.\\pipe\\${name}` : `\0${name}`;
    return new Promise((resolve, reject) => {
        // nobody is served here: the name is only held
        const server = net.createServer((socket) => socket.destroy());
        server.once("error", (err) => (errorCode(err) === "EADDRINUSE" ? resolve(null) : reject(err)));
        server.listen(address, () => resolve(server));
    });
}

const closeServer = (server: net.Server) => new Promise<void>((resolve) => server.close(() => resolve()));

/** the folder's lock (macOS); null when another process holds it. Resolves with the release. */
function lockFolder(dir: string): (() => Promise<void>) | null {
    let fd: number;
    try {
        fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | O_EXLOCK);
    } catch (err) {
        const code = errorCode(err);
        if (code === "EAGAIN" || code === "EWOULDBLOCK") return null;
        if (code === "ENOTSUP" || code === "EOPNOTSUPP") {
            throw new Error(`The data folder ${dir} is on a disk that can't hold the lock that keeps two Paperboard servers off one folder. Move the data folder to a local disk.`, { cause: err });
        }
        throw err;
    }
    return async () => fs.closeSync(fd);
}

/** takes the claim's names in order; the one held by another process when one is, else the release of all */
async function takeClaim(dir: string, names: { folder: string; path: string | null }): Promise<{ held: "folder" | "path" } | { release: () => Promise<void> }> {
    if (process.platform === "darwin") {
        const release = lockFolder(dir);
        return release ? { release } : { held: "folder" };
    }
    const folder = await listenAt(names.folder);
    if (!folder) return { held: "folder" };
    let byPath: net.Server | null;
    try {
        byPath = await listenAt(names.path!);
    } catch (err) {
        await closeServer(folder);
        throw err;
    }
    if (!byPath) {
        await closeServer(folder);
        return { held: "path" };
    }
    return { release: async () => void (await Promise.all([closeServer(folder), closeServer(byPath)])) };
}

// Linux filesystem types (mountinfo) of network shares this recognizes: NFS,
// SMB, 9P, Ceph, AFS, GlusterFS, davfs, and the FUSE mounts of sshfs, rclone
// and GNOME's gvfs. Other network filesystems aren't recognized (data-directory)
const NETWORK_FS = new Set([
    "nfs", "nfs4", "cifs", "smb3", "smbfs", "9p", "ceph", "fuse.ceph-fuse", "afs", "glusterfs", "fuse.glusterfs", "davfs",
    "fuse.sshfs", "fuse.rclone", "fuse.gvfsd-fuse",
]);

/** mountinfo escapes a space, tab, newline and backslash as \ooo */
const unescapeMount = (field: string) => field.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));

/** the filesystem type of the mount `real` is on, by /proc/self/mountinfo's text; null when none holds it */
export function mountTypeOf(mountinfo: string, real: string): string | null {
    let best: { point: string; type: string } | null = null;
    for (const line of mountinfo.split("\n")) {
        const [left, right] = line.split(" - ");
        if (!left || !right) continue;
        const point = unescapeMount(left.split(" ")[4] ?? "");
        const type = right.split(" ")[0] ?? "";
        const inside = point === "/" || real === point || real.startsWith(`${point}/`);
        // the last of equally long mount points is the one on top
        if (inside && (!best || point.length >= best.point.length)) best = { point, type };
    }
    return best?.type ?? null;
}

/** the filesystem type of the mount `real` is on; null when /proc can't be read */
function linuxFsType(real: string): string | null {
    let info: string;
    try {
        info = fs.readFileSync("/proc/self/mountinfo", "utf8");
    } catch {
        return null; // quiet: only finds a limit to tell of; the claim holds without it
    }
    return mountTypeOf(info, real);
}

/**
 * What Paperboard can't guarantee for the folder, found cheaply: a folder
 * on a network share (Linux: the filesystem types in NETWORK_FS; Windows: a
 * real path that is a network path, \\server\share). Each is a sentence for
 * a person. A network filesystem not in that list isn't found.
 */
export function claimLimits(dir: string): string[] {
    const share = `The data folder ${dir} is on a network share. Paperboard keeps a second server on this computer off it, but can't see a server on another computer that uses the same share: use the folder from one computer at a time.`;
    if (process.platform === "win32") return /^\\\\(?![?.]\\)/.test(fs.realpathSync.native(dir)) ? [share] : [];
    if (process.platform === "linux") {
        const type = linuxFsType(fs.realpathSync(dir));
        return type !== null && NETWORK_FS.has(type) ? [share] : [];
    }
    return [];
}

/** a claim's own record in this process: what its path must lead to, and who hears it doesn't */
interface Held {
    dir: string;
    stat: FolderStat;
    /** latched once the path leads elsewhere: every checked write after is refused with it */
    lost: DataFolderMovedError | null;
    listeners: Set<(err: DataFolderMovedError) => void>;
    released: Promise<void> | null;
}

/** each name this process holds or is releasing → its claim */
const HELD = new Map<string, Held>();
/** the claims the timer looks at: held, not lost, not being released */
const WATCHED = new Set<Held>();

/** throws when the claim's path no longer leads to its folder; the first time, its listeners hear it */
function check(held: Held): void {
    if (held.lost) throw held.lost;
    let now: FolderStat | null;
    try {
        now = statFolder(held.dir);
    } catch (err) {
        const code = errorCode(err);
        // anything else (a disk error) isn't an answer: this write fails with it, and the next one asks again
        if (code !== "ENOENT" && code !== "ENOTDIR" && !/isn't a folder/.test(errorMessage(err))) throw err;
        now = null;
    }
    if (now && now.dev === held.stat.dev && now.ino === held.stat.ino && now.birth === held.stat.birth) return;
    const lost = (held.lost = new DataFolderMovedError(held.dir));
    WATCHED.delete(held);
    // told after the write that found it has failed, never inside it: a listener stops the daemon
    queueMicrotask(() => {
        for (const listener of held.listeners) listener(lost);
    });
    throw lost;
}

/** whether `file` is the folder or inside it */
function inside(dir: string, file: string): boolean {
    const rel = path.relative(dir, file);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Before a write to `file`: throws DataFolderMovedError when it is in a
 * data folder this process claimed and the folder's path no longer leads to
 * it. Nothing to check for a file outside any claimed folder.
 */
export function checkDataWrite(file: string): void {
    // until a claim is let go, its last writes too (a stop saving what it has) are checked
    for (const held of new Set(HELD.values())) if (inside(held.dir, file)) check(held);
}

let watchTimer: ReturnType<typeof setInterval> | null = null;

function watch(held: Held): void {
    WATCHED.add(held);
    if (watchTimer) return;
    watchTimer = setInterval(() => {
        for (const claim of [...WATCHED]) {
            try {
                check(claim);
            } catch {
                // quiet: a lost folder was told to its listeners by check(); a disk error is asked again next time
            }
        }
        if (!WATCHED.size && watchTimer) {
            clearInterval(watchTimer);
            watchTimer = null;
        }
    }, WATCH_MS);
    watchTimer.unref?.();
}

/** the data folder, made when missing: only it is private, the folders above it are made as any folder is */
function makeDataFolder(dir: string): void {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    try {
        fs.mkdirSync(dir, { mode: 0o700 });
    } catch (err) {
        // quiet: there already, made by the person or by another starter at the same moment
        if (errorCode(err) !== "EEXIST") throw err;
    }
}

/**
 * Claims this process's data folder (PAPERBOARD_DIR) for its daemon, or
 * throws FolderClaimedError when another process holds it, or this one
 * does and isn't releasing it.
 */
export async function claimDataFolder(): Promise<FolderClaim> {
    const dir = path.resolve(getPaperboardDir());
    // the one thing made before the claim (the top of this file)
    makeDataFolder(dir);
    const stat = statFolder(dir);
    const names = claimNames(dir, stat);
    const keys = [names.folder, ...(names.path ? [names.path] : [])];
    for (let mine = keys.map((k) => HELD.get(k)).find(Boolean); mine; mine = keys.map((k) => HELD.get(k)).find(Boolean)) {
        if (!mine.released) {
            if (mine.lost) {
                throw new FolderClaimedError(`This process still runs the Paperboard server that started with the data folder path ${dir}, on the folder that was there before it was moved or replaced. It is stopping: start this one again once it has.`, "path");
            }
            throw new FolderClaimedError(`This process already runs a Paperboard server with the data folder ${dir}. Only one server can use a data folder at a time.`, "folder");
        }
        await mine.released;
    }
    const held: Held = { dir, stat, lost: null, listeners: new Set(), released: null };
    for (const key of keys) HELD.set(key, held);
    const forget = () => {
        for (const key of keys) if (HELD.get(key) === held) HELD.delete(key);
        WATCHED.delete(held);
    };
    let taken: Awaited<ReturnType<typeof takeClaim>>;
    try {
        taken = await takeClaim(dir, names);
    } catch (err) {
        forget();
        throw new Error(`The data folder ${dir} couldn't be claimed for this Paperboard server: ${errorMessage(err)}`, { cause: err });
    }
    if ("held" in taken) {
        forget();
        if (taken.held === "folder") {
            throw new FolderClaimedError(
                `Another Paperboard server is already starting or running with the data folder ${dir}, or another program on this computer holds the folder's claim (${describe(process.platform === "darwin" ? null : names.folder)}). Only one server can use a data folder at a time: stop the other one first.`,
                "folder",
            );
        }
        throw new FolderClaimedError(
            `A Paperboard server that started with the data folder path ${dir} is still running, on the folder that was there before: the folder was moved, deleted or replaced while it ran. ` +
                `It stops before it writes there again. Stop it, then start this one. (Or another program on this computer holds the path's claim, ${describe(names.path)}.)`,
            "path",
        );
    }
    const end = taken.release;
    let limits: string[];
    try {
        limits = claimLimits(dir);
    } catch (err) {
        forget();
        // the error is the limits' one; a release that fails too is said beside it, never in its place
        let undone = "";
        try {
            await end();
        } catch (releaseErr) {
            undone = ` (letting go of the claim failed too: ${errorMessage(releaseErr)})`;
        }
        throw new Error(`The data folder ${dir} couldn't be checked for this Paperboard server: ${errorMessage(err)}${undone}`, { cause: err });
    }
    watch(held);
    return {
        dir,
        limits,
        onLost(listener) {
            held.listeners.add(listener);
            return () => held.listeners.delete(listener);
        },
        releaseAfter(last) {
            held.released ??= last
                .then(
                    () => undefined,
                    () => undefined, // quiet: whoever handed `last` in reports its failure; the claim ends either way
                )
                .then(() => {
                    WATCHED.delete(held);
                    held.listeners.clear();
                    return end();
                })
                .finally(forget);
            return held.released;
        },
    };
}
