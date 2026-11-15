// A boot's temp root (the compiled daemon, the built renderer, every data
// dir) is removed however the test process ends, the way chrome.ts reaps a
// Chrome profile: a detached shell waits on a FIFO that only this process
// holds open for writing. A line on it says the boot closed and removed the
// root itself; the FIFO closing without one (a timeout, Ctrl-C, a kill, a
// boot that never finished) means this process is gone, and the shell stops
// the processes the boot started and removes the root. bun test runs no exit
// hooks, so nothing in this process can be relied on to do it.
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const WAIT_MS = 20_000;

export interface Reaper {
    /** records this process's children that run from the root, for the reaper to stop */
    track(): void;
    /** the root is removed: the reaper has nothing to do */
    dismiss(): void;
}

// a process is stopped only while its command line still names the root, so
// a recorded id that a finished process gave back is never someone else's.
// Removal is tried again while what was stopped lets go of its files.
const REAP = [
    'exec < "$2"',
    "if read -r _; then exit 0; fi",
    'for pid in $(cat "$1/.reaper-pids" 2> /dev/null); do tr "\\000" "\\n" < "/proc/$pid/cmdline" 2> /dev/null | grep -qF -- "$1" && kill -9 "$pid" 2> /dev/null; done',
    'for _ in $(seq 50); do rm -rf -- "$1"; [ -e "$1" ] || exit 0; sleep 0.2; done',
    "exit 1",
].join("\n");

/** what `file` holds, or null once it is gone (a thread or process that exited since it was listed) */
function readIfThere(file: string): string | null {
    try {
        return fs.readFileSync(file, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ESRCH") return null;
        throw err;
    }
}

/** this process's children whose command line names `root` (Linux; elsewhere none) */
function childrenUnder(root: string): number[] {
    const tasks = `/proc/${process.pid}/task`;
    if (!fs.existsSync(tasks)) return [];
    const pids = fs.readdirSync(tasks).flatMap((task) => (readIfThere(path.join(tasks, task, "children")) ?? "").split(/\s+/).filter(Boolean).map(Number));
    return pids.filter((pid) => readIfThere(`/proc/${pid}/cmdline`)?.includes(root));
}

export async function reapOnExit(root: string): Promise<Reaper> {
    const fifo = path.join(root, ".reaper");
    const pidFile = path.join(root, ".reaper-pids");
    const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    if (made.status !== 0) throw new Error(`Could not make the shell boot's reaper FIFO (exit ${made.status}): ${made.stderr}`);
    // in a session of its own, so no signal to this process's group reaches it
    const shell = spawn("/bin/sh", ["-c", `(${REAP}) > /dev/null 2>&1 &`, "shell-boot-reaper", root, fifo], { stdio: "ignore", detached: true });
    const status = await new Promise<number | null>((resolve, reject) => {
        shell.once("exit", (code) => resolve(code));
        shell.once("error", reject);
    });
    if (status !== 0) throw new Error(`Could not start the shell boot's reaper (exit ${status})`);
    // opened once the reaper reads it, so a dismissal can't land before it
    // listens and be lost; this process is its only writer
    let fd: number | null = null;
    const deadline = Date.now() + WAIT_MS;
    while (fd === null) {
        try {
            fd = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        } catch (err) {
            // ENXIO: nothing reads it yet
            if ((err as NodeJS.ErrnoException).code !== "ENXIO" || Date.now() > deadline) throw err;
            // quiet: the poll interval while the reaper opens its fifo, bounded by a deadline
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    }
    const held = fd;
    return {
        track() {
            fs.writeFileSync(pidFile, childrenUnder(root).join("\n"));
        },
        dismiss() {
            fs.writeSync(held, "done\n");
            fs.closeSync(held);
        },
    };
}
