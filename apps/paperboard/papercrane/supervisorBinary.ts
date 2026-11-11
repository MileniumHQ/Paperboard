// The workload supervisor's binary (apps/paperboard/supervisor) and where it
// runs from.
//
// Each host carries the binary its own way: the desktop app as a file in its
// resources, the compiled server embedded in its executable. Neither can run
// it in place. An AppImage is a mount that goes away with the app, taking
// every process started from it; an embedded file is not a file the system
// can start; and an installed app's own folder is replaced by an update while
// workloads still run. So the binary is copied once into the data directory,
// named by its content, and every supervisor starts from that copy.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger";
import { getLocalDir } from "./paths";

type BinaryReader = () => Promise<Uint8Array> | Uint8Array;

let reader: BinaryReader | null = null;
let installed: Promise<string> | null = null;

const COPY_NAME_RE = /^paperboard-supervisor-[0-9a-f]{16}(\.exe)?$/;
const STALE_TEMP_MS = 60 * 60_000;

/** The host says how to read its supervisor binary, before any workload starts. */
export function setSupervisorBinary(read: BinaryReader): void {
    reader = read;
    installed = null;
}

export function supervisorBinDir(): string {
    return path.join(getLocalDir(), "bin");
}

const sha256 = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");

/** The supervisor to start, copied into the data directory on first use. */
export function supervisorBinary(): Promise<string> {
    installed ??= install().catch((err) => {
        // a failed copy is tried again by the next start, not remembered
        installed = null;
        throw err;
    });
    return installed;
}

async function install(): Promise<string> {
    if (!reader) throw new Error("This build of Paperboard did not say where its workload supervisor is, so nothing can be started");
    const bytes = await reader();
    if (bytes.length === 0) throw new Error("This build's workload supervisor is empty, so nothing can be started");
    const digest = sha256(bytes);
    const dir = supervisorBinDir();
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `paperboard-supervisor-${digest.slice(0, 16)}${process.platform === "win32" ? ".exe" : ""}`);

    let current: Buffer | null = null;
    try {
        current = await fs.promises.readFile(file);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`The workload supervisor at ${file} could not be read: ${(err as Error).message}`);
    }
    if (!current || sha256(current) !== digest) {
        if (current) logger.warn(`[supervisor] ${file} is not the supervisor this build ships; replacing it`);
        const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
            await fs.promises.writeFile(temp, bytes, { mode: 0o755 });
            // the mode above is cut by the umask
            await fs.promises.chmod(temp, 0o755);
            await fs.promises.rename(temp, file);
        } catch (err) {
            await fs.promises.rm(temp, { force: true }).catch((cleanupErr) => logger.warn(`[supervisor] could not remove ${temp}:`, cleanupErr));
            throw new Error(`The workload supervisor could not be copied to ${file}: ${(err as Error).message}`);
        }
    } else if (process.platform !== "win32" && ((await fs.promises.stat(file)).mode & 0o100) === 0) {
        await fs.promises.chmod(file, 0o755);
    }
    await prune(dir, path.basename(file));
    return file;
}

// Copies an earlier build left. One still running a workload stays usable:
// elsewhere a running file can be removed, and Windows refuses, which is the
// right outcome there.
async function prune(dir: string, keep: string): Promise<void> {
    let entries: string[];
    try {
        entries = await fs.promises.readdir(dir);
    } catch (err) {
        logger.warn(`[supervisor] could not list ${dir} to clear old supervisors:`, err);
        return;
    }
    for (const entry of entries) {
        if (entry === keep) continue;
        const file = path.join(dir, entry);
        try {
            if (entry.endsWith(".tmp")) {
                // another daemon may be writing its copy right now
                if (Date.now() - (await fs.promises.stat(file)).mtimeMs < STALE_TEMP_MS) continue;
            } else if (!COPY_NAME_RE.test(entry)) {
                continue;
            }
            await fs.promises.rm(file, { force: true });
        } catch (err) {
            logger.debug(`[supervisor] left the old supervisor ${file} in place:`, err);
        }
    }
}
