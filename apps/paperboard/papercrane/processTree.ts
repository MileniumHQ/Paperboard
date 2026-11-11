// Stopping a supervised workload. A child is often a wrapper (`cmd /c ping
// ...`, `sh -c "a; b"`) whose grandchild inherits the stdout/stderr pipes:
// child.kill() ends only the wrapper, the pipes stay open, `close` never
// fires and the workload looks alive forever. taskkill /T ends the whole tree
// on Windows; elsewhere the workload leads its own process group
// (workloadSpawnsDetached) and the signal goes to the group.
import * as cp from "child_process";
import * as path from "path";
import { logger } from "./logger";

export type TreeKillRunner = (file: string, args: string[]) => void;
export type GroupSignaller = (pid: number, signal: NodeJS.Signals) => void;

const TASKKILL_TIMEOUT_MS = 5_000;

export function taskkillCommand(pid: number, systemRoot: string | undefined): { file: string; args: string[] } {
    return {
        file: path.win32.join(systemRoot || "C:\\Windows", "System32", "taskkill.exe"),
        args: ["/PID", String(pid), "/T", "/F"],
    };
}

/**
 * Whether a piped workload is spawned detached. On POSIX that makes it the
 * leader of a new process group, so killWorkload can signal everything it
 * started. On Windows detached means a new console, so it stays attached.
 */
export function workloadSpawnsDetached(platform: NodeJS.Platform = process.platform): boolean {
    return platform !== "win32";
}

const runTaskkill: TreeKillRunner = (file, args) => {
    cp.execFileSync(file, args, { windowsHide: true, stdio: "ignore", timeout: TASKKILL_TIMEOUT_MS });
};

const signalGroup: GroupSignaller = (pid, signal) => {
    process.kill(-pid, signal);
};

/**
 * Stops a workload and everything it started: taskkill /T on Windows, the
 * workload's process group elsewhere. Synchronous so a supervisor tearing
 * down cannot exit before the tree is gone. A failed tree kill falls back to
 * killing the child alone and is logged; the exit is still observed by the
 * caller, never assumed.
 */
export function killWorkload(
    child: cp.ChildProcess,
    signal: NodeJS.Signals = "SIGTERM",
    platform: NodeJS.Platform = process.platform,
    run: TreeKillRunner = runTaskkill,
    systemRoot: string | undefined = process.env.SystemRoot,
    group: GroupSignaller = signalGroup,
): void {
    if (platform === "win32" && child.pid) {
        const { file, args } = taskkillCommand(child.pid, systemRoot);
        try {
            run(file, args);
            return;
        } catch (err) {
            logger.warn(`[supervisor] taskkill of workload ${child.pid} failed, killing the child alone:`, (err as Error)?.message ?? err);
        }
    } else if (platform !== "win32" && child.pid) {
        try {
            group(child.pid, signal);
            return;
        } catch (err) {
            // the group has no process left: the workload is already gone
            if ((err as NodeJS.ErrnoException)?.code === "ESRCH") return;
            logger.warn(`[supervisor] signalling workload group ${child.pid} failed, killing the child alone:`, (err as Error)?.message ?? err);
        }
    }
    child.kill(signal);
}
