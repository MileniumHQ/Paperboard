// One daemon per data folder, held by the operating system before the
// daemon reads or writes anything in the folder. The claim is one name,
// taken in one atomic step, that ends with the process however it ends:
//
//   macOS    an exclusive flock on the data folder itself, taken as it is
//            opened (O_EXLOCK | O_NONBLOCK)
//   Linux    a socket in the abstract namespace (no file), named by the
//            folder's device and inode: only one process can listen on a
//            name, and the kernel frees it with the process
//   Windows  a named pipe, named by the folder's volume serial number and
//            file id: only one process can create a name
//
// All three belong to the folder itself, not to how it is spelled: a
// symlink, a junction, a bind mount, another casing on a case-insensitive
// disk, or the folder moved or renamed is the same claim. A copy of the
// folder is another folder, with a claim of its own. Nothing is kept on
// disk for the claim, so there is nothing to lose, copy, replace or clear.
//
// Before the claim, a start makes exactly one thing: the data folder, when
// it is missing (with any missing folders above it), empty. A folder has
// to be there to be claimed; making it is safe for any number of starters
// at once and puts nothing in it.
//
// Another program on this computer may hold the name (on Linux and Windows
// any account can take any name first). Then no daemon starts on the folder
// until it lets go, and the error says what holds the claim; it can't make
// two daemons run on one folder.
//
// What the claim can't cover, said at start where it can be found cheaply
// (claimLimits) and in the docs (data-directory): two computers sharing one
// folder over a network share (each claims on its own computer), and on
// Linux two containers with network namespaces of their own sharing one
// folder (abstract names are per network namespace). A Paperboard before
// this one takes no claim: either finds the other once it runs
// (refuseRunningDaemon, server.ts), and only two started at the same
// moment aren't stopped.
//
// In this process, a claim that is being released (releaseAfter) is waited
// for: a daemon embedded in the app and started again at once opens the
// folder only after the last one has saved its last writes.
import * as fs from "fs";
import * as net from "net";
import { errorCode, errorMessage } from "@mileniumhq/paperapi/errors";
import { getPaperboardDir } from "./paths";

// macOS's open(2) flag for an exclusive flock: Node names no constant for it
const O_EXLOCK = 0x20;

/** Another daemon, or another program on this computer, holds this data folder's claim. */
export class FolderClaimedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FolderClaimedError";
    }
}

/** A data folder this process holds. */
export interface FolderClaim {
    /** What Paperboard can't guarantee for this folder (claimLimits), for the daemon to tell; empty for none. */
    readonly limits: string[];
    /**
     * Ends the claim once `last` settles (the folder's last writes saved),
     * whether it resolves or rejects. A claim of the folder in this process
     * meanwhile waits for it. Resolves once the claim is ended; calling it
     * again returns the same.
     */
    releaseAfter(last: Promise<unknown>): Promise<void>;
}

/** the folder's identity → this process's claim on it, and its release once one began */
const HELD = new Map<string, { released: Promise<void> | null }>();

/** the folder itself, whatever spells it: device (volume serial on Windows) and inode (file id) */
function folderIdentity(dir: string): string {
    const stat = fs.statSync(dir, { bigint: true });
    if (!stat.isDirectory()) throw new Error(`${dir} isn't a folder`);
    return `${stat.dev.toString(16)}-${stat.ino.toString(16)}`;
}

/** what holds the claim of the folder with this identity, as a person could look for it */
function claimName(identity: string): string {
    if (process.platform === "darwin") return "a lock on the folder";
    if (process.platform === "win32") return `the named pipe \\\\.\\pipe\\paperboard-daemon-${identity}`;
    return `the abstract socket @paperboard-daemon-${identity}`;
}

/** listens on `address`; null when another process does already */
function listenAt(address: string): Promise<net.Server | null> {
    return new Promise((resolve, reject) => {
        // nobody is served here: the name is only held
        const server = net.createServer((socket) => socket.destroy());
        server.once("error", (err) => (errorCode(err) === "EADDRINUSE" ? resolve(null) : reject(err)));
        server.listen(address, () => resolve(server));
    });
}

/** takes the operating system's claim; null when another process holds it. Resolves with the release. */
async function takeClaim(dir: string, identity: string): Promise<(() => Promise<void>) | null> {
    if (process.platform === "darwin") {
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
    const address = process.platform === "win32" ? `\\\\.\\pipe\\paperboard-daemon-${identity}` : `\0paperboard-daemon-${identity}`;
    const server = await listenAt(address);
    if (!server) return null;
    return () => new Promise<void>((resolve) => server.close(() => resolve()));
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
 * real path that is a network path, \\server\share), and a daemon in a
 * container (Linux: a container's marker file or variable). Each is a
 * sentence for a person. A network filesystem not in that list, and a
 * container that leaves no marker, aren't found.
 */
export function claimLimits(dir: string): string[] {
    const limits: string[] = [];
    const share = `The data folder ${dir} is on a network share. Paperboard keeps a second server on this computer off it, but can't see a server on another computer that uses the same share: use the folder from one computer at a time.`;
    if (process.platform === "win32") {
        if (/^\\\\(?![?.]\\)/.test(fs.realpathSync.native(dir))) limits.push(share);
    } else if (process.platform === "linux") {
        const type = linuxFsType(fs.realpathSync(dir));
        if (type !== null && NETWORK_FS.has(type)) limits.push(share);
        if (process.env.container || fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv")) {
            limits.push(
                `This Paperboard server runs in a container. Paperboard keeps a second server in this container off the data folder ${dir}, but can't see one in another container that shares the folder with a network of its own: give each container a data folder of its own.`,
            );
        }
    }
    return limits;
}

/**
 * Claims this process's data folder (PAPERBOARD_DIR) for its daemon, or
 * throws FolderClaimedError when another process holds it, or this one
 * does and isn't releasing it.
 */
export async function claimDataFolder(): Promise<FolderClaim> {
    const dir = getPaperboardDir();
    // the one thing made before the claim (the top of this file)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const identity = folderIdentity(dir);
    for (let mine = HELD.get(identity); mine; mine = HELD.get(identity)) {
        if (!mine.released) throw new FolderClaimedError(`This process already runs a Paperboard server with the data folder ${dir}. Only one server can use a data folder at a time.`);
        await mine.released;
    }
    const held: { released: Promise<void> | null } = { released: null };
    HELD.set(identity, held);
    let release: (() => Promise<void>) | null = null;
    let limits: string[];
    try {
        release = await takeClaim(dir, identity);
        limits = release ? claimLimits(dir) : [];
    } catch (err) {
        HELD.delete(identity);
        await release?.();
        throw new Error(`The data folder ${dir} couldn't be claimed for this Paperboard server: ${errorMessage(err)}`, { cause: err });
    }
    if (!release) {
        HELD.delete(identity);
        throw new FolderClaimedError(
            `Another Paperboard server is already starting or running with the data folder ${dir}, or another program on this computer holds the folder's claim (${claimName(identity)}). Only one server can use a data folder at a time: stop the other one first.`,
        );
    }
    const end = release;
    return {
        limits,
        releaseAfter(last) {
            held.released ??= last
                .then(
                    () => undefined,
                    () => undefined, // quiet: whoever handed `last` in reports its failure; the claim ends either way
                )
                .then(end)
                .finally(() => {
                    if (HELD.get(identity) === held) HELD.delete(identity);
                });
            return held.released;
        },
    };
}
