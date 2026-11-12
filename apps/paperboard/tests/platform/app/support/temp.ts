// What this suite makes and must take down again: throwaway directories,
// the processes it started, and the workloads those started. bun test runs
// no process "exit" handlers, so preload.ts calls cleanupSuite() from a
// global afterAll once every file has run.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";

const made: string[] = [];
const SUITE_STARTED = Date.now();
const children = new Set<ChildProcess>();

// The real path: macOS's temp dir is a link (/var → /private/var), and the
// app built into one bakes in a relative path to its resources that only
// resolves from the folder Electron's __dirname reports, the real one.
export function tempDir(label: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `pb-${label}-`)));
    made.push(dir);
    return dir;
}

// A data dir laid out the way tests/setup.ts lays out the shared one.
export function tempDataDir(label = "data"): string {
    const dir = tempDir(label);
    for (const sub of ["packages", "panels", "configs", "files", "local", "logs", "sockets"]) {
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
    }
    return dir;
}

// a process this suite started, ended at cleanup if it is still running
export function ownChild(child: ChildProcess): ChildProcess {
    children.add(child);
    child.once("exit", () => children.delete(child));
    return child;
}

const alive = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw err;
    }
};

// supervisors (and their workloads) a daemon started in one of our data
// dirs outlive that daemon by design; they are ours, so they end here
function endWorkloads(dir: string): void {
    for (const sockets of [path.join(dir, "sockets"), path.join(dir, "data", "sockets")]) {
        if (!fs.existsSync(sockets)) continue;
        for (const file of fs.readdirSync(sockets).filter((f) => f.endsWith(".json"))) {
            const meta = JSON.parse(fs.readFileSync(path.join(sockets, file), "utf8"));
            // a record copied in from a fixture names some other run's pids
            if (!(Date.parse(meta.startedAt) >= SUITE_STARTED)) continue;
            for (const pid of [meta.pid, meta.childPid]) {
                if (typeof pid === "number" && pid > 0 && pid !== process.pid && alive(pid)) process.kill(pid, "SIGKILL");
            }
        }
    }
}

export function cleanupSuite(): void {
    for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    for (const dir of made) endWorkloads(dir);
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
