// Stopping a supervised workload. A Windows child is often a wrapper
// (`cmd /c ping ...`) whose grandchild inherits the stdout/stderr pipes:
// child.kill() ends only the wrapper, the pipes stay open, `close` never
// fires and the workload looks alive forever. taskkill /T ends the whole tree.
import * as cp from "child_process";
import * as path from "path";
import { logger } from "./logger";

export type TreeKillRunner = (file: string, args: string[]) => void;

const TASKKILL_TIMEOUT_MS = 5_000;

export function taskkillCommand(pid: number, systemRoot: string | undefined): { file: string; args: string[] } {
    return {
        file: path.win32.join(systemRoot || "C:\\Windows", "System32", "taskkill.exe"),
        args: ["/PID", String(pid), "/T", "/F"],
    };
}

const runTaskkill: TreeKillRunner = (file, args) => {
    cp.execFileSync(file, args, { windowsHide: true, stdio: "ignore", timeout: TASKKILL_TIMEOUT_MS });
};

/**
 * Stops a workload and, on Windows, everything it started. POSIX keeps the
 * plain signal. Synchronous so a supervisor tearing down cannot exit before
 * the tree is gone. A failed taskkill falls back to killing the child alone
 * and is logged; the exit is still observed by the caller, never assumed.
 */
export function killWorkload(
    child: cp.ChildProcess,
    signal: NodeJS.Signals = "SIGTERM",
    platform: NodeJS.Platform = process.platform,
    run: TreeKillRunner = runTaskkill,
    systemRoot: string | undefined = process.env.SystemRoot,
): void {
    if (platform === "win32" && child.pid) {
        const { file, args } = taskkillCommand(child.pid, systemRoot);
        try {
            run(file, args);
            return;
        } catch (err) {
            logger.warn(`[supervisor] taskkill of workload ${child.pid} failed, killing the child alone:`, (err as Error)?.message ?? err);
        }
    }
    child.kill(signal);
}
