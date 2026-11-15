import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFileAtomicSync } from "./storage";
import { getPaperboardDir } from "./paths";
import { logger } from "./logger";
import { errorCode } from "../../../packages/paperapi/src/errors";

const promisifiedExecFile = promisify(execFile);

// PID file, detects stale instances on restart. Identity is path-bound:
// only a PID whose executable matches the recorded one may be signalled.
function getPidFile(): string {
    return path.join(getPaperboardDir(), "papercrane.pid");
}

interface PidFileRecord {
    pid: number;
    startedAt: string;
    execPath: string;
}

export function writePidFile() {
    try {
        const pidFile = getPidFile();
        if (!fs.existsSync(path.dirname(pidFile))) {
            fs.mkdirSync(path.dirname(pidFile), { recursive: true });
        }
        const record: PidFileRecord = {
            pid: process.pid,
            startedAt: new Date().toISOString(),
            execPath: process.execPath,
        };
        writeFileAtomicSync(pidFile, JSON.stringify(record, null, 2));
    } catch (err) {
        logger.error("[Paperboard Server] could not write the PID file, so the next start cannot reclaim this port from this instance if it is left running:", err);
    }
}

function readPidRecord(): PidFileRecord | null {
    try {
        const pidFile = getPidFile();
        if (fs.existsSync(pidFile)) {
            const raw = JSON.parse(fs.readFileSync(pidFile, "utf8").trim());
            if (typeof raw?.pid === "number" && typeof raw?.execPath === "string") {
                return raw as PidFileRecord;
            }
        }
    } catch (err) {
        logger.warn("[Paperboard Server] the PID file is unreadable, so no stale instance can be reclaimed from it:", err);
    }
    return null;
}

export function removePidFile() {
    try {
        fs.unlinkSync(getPidFile());
    } catch (err) {
        // gone already is the goal; anything else leaves a record the next
        // start reads as a stale instance to reclaim
        if (errorCode(err) !== "ENOENT") logger.error("[Paperboard Server] could not remove the PID file:", err);
    }
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        // ESRCH/EPERM both mean "not ours to signal" — false IS the answer,
        // logged so a stale-pidfile takeover stays visible
        logger.debug(`[Paperboard Server] pid ${pid} liveness probe failed (treated as not alive):`, err);
        return false;
    }
}

// The executable a live PID runs, or null when the system won't say. A PID
// from our own pidfile may since belong to another program: it is signalled
// only when it still runs the executable the record names.
async function processExecutable(pid: number): Promise<string | null> {
    try {
        if (process.platform === "linux") return fs.readlinkSync(`/proc/${pid}/exe`);
        if (process.platform === "win32") {
            const { stdout } = await promisifiedExecFile(
                "powershell.exe",
                ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction Stop).Path`],
                { windowsHide: true, timeout: 15_000 },
            );
            return stdout.trim() || null;
        }
        // macOS and the BSDs: the full path a program was started from
        const { stdout } = await promisifiedExecFile("ps", ["-p", String(pid), "-o", "comm="], { timeout: 15_000 });
        return stdout.trim() || null;
    } catch (err) {
        logger.debug(`[Paperboard Server] could not read the executable of PID ${pid}:`, err);
        return null;
    }
}

const samePath = (a: string, b: string) =>
    process.platform === "linux" ? path.resolve(a) === path.resolve(b) : path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

async function isRecordedProcessAlive(record: PidFileRecord): Promise<boolean> {
    if (!isProcessAlive(record.pid)) return false;
    const exe = await processExecutable(record.pid);
    return exe !== null && samePath(exe, record.execPath);
}

// whether the PID is gone before the deadline
async function exitedWithin(pid: number, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (isProcessAlive(pid)) {
        if (Date.now() >= deadline) return false;
        await new Promise((r) => setTimeout(r, 50));
    }
    return true;
}

// PID-file reclaim only: one fact, one source, executable-verified. A port
// held by anything we cannot identify is never signalled.
export async function killStalePaperCrane(port: number): Promise<boolean> {
    const record = readPidRecord();
    if (!record || record.pid === process.pid || !(await isRecordedProcessAlive(record))) return false;
    console.log(`[Paperboard Server] Reclaiming port ${port} from stale instance (PID ${record.pid})...`);
    try {
        process.kill(record.pid, "SIGTERM");
    } catch (err) {
        logger.debug(`[Paperboard Server] SIGTERM to PID ${record.pid} failed:`, err);
    }
    if (!(await exitedWithin(record.pid, 2000))) {
        try {
            process.kill(record.pid, "SIGKILL");
        } catch (err) {
            logger.debug(`[Paperboard Server] SIGKILL to PID ${record.pid} failed:`, err);
        }
        if (!(await exitedWithin(record.pid, 2000))) return false;
    }
    removePidFile();
    return true;
}
