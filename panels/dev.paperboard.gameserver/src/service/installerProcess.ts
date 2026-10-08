import { processApi } from "@mileniumhq/paperapi";

// Runs a software installer (Forge, NeoForge) as a daemon-supervised child
// under a fixed id the panel owns, so its exit is observed rather than
// inferred: a timed-out installer is signalled and then waited for, and a
// staging folder is only cleaned once nothing is writing into it.

export const INSTALLER_PROC_ID = "mc-installer";
export const INSTALLER_TIMEOUT_MS = 20 * 60_000;
const EXIT_GRACE_MS = 10_000;
const TAIL_LINES = 30;

export type InstallerProcessApi = Pick<typeof processApi, "start" | "onData" | "onExit" | "kill" | "exists">;

export interface InstallerRun {
    javaBin: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    /** how long a signalled installer gets to exit before the next signal */
    exitGraceMs?: number;
    onLine?: (line: string) => void;
}

export interface InstallerResult {
    exitCode: number;
    /** last lines of output, for the failure message */
    tail: string[];
}

/** Thrown when the installer could not be confirmed stopped; its folder must be left alone. */
export class InstallerStillRunningError extends Error {}

function delay<T>(ms: number, value: T): { promise: Promise<T>; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(value), ms);
        (timer as unknown as { unref?: () => void }).unref?.();
    });
    return { promise, cancel: () => clearTimeout(timer) };
}

export async function runInstallerProcess(
    run: InstallerRun,
    proc: InstallerProcessApi = processApi,
): Promise<InstallerResult> {
    if (await proc.exists(INSTALLER_PROC_ID)) {
        throw new Error("Another server install is still running");
    }

    const tail: string[] = [];
    let partial = "";
    const pushLine = (line: string) => {
        const clean = line.replace(/\r$/, "");
        if (!clean.trim()) return;
        tail.push(clean);
        if (tail.length > TAIL_LINES) tail.shift();
        run.onLine?.(clean);
    };

    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => {
        resolveExit = resolve;
    });
    const offData = proc.onData(INSTALLER_PROC_ID, (chunk) => {
        const lines = (partial + chunk).split("\n");
        partial = lines.pop() ?? "";
        lines.forEach(pushLine);
    });
    const offExit = proc.onExit(INSTALLER_PROC_ID, (code) => {
        // an exit with no code reported is not a success
        resolveExit(typeof code === "number" ? code : -1);
    });

    try {
        await proc.start({
            id: INSTALLER_PROC_ID,
            command: run.javaBin,
            args: run.args,
            cwd: run.cwd,
            env: run.env,
        });

        const timeout = delay(run.timeoutMs ?? INSTALLER_TIMEOUT_MS, null);
        const exitCode = await Promise.race([exited, timeout.promise]);
        timeout.cancel();
        if (exitCode !== null) {
            if (partial) pushLine(partial);
            return { exitCode, tail };
        }

        // timed out: signal, then observe the exit before reporting
        for (const signal of ["SIGTERM", "SIGKILL"]) {
            await proc.kill(INSTALLER_PROC_ID, signal);
            const grace = delay(run.exitGraceMs ?? EXIT_GRACE_MS, null);
            const code = await Promise.race([exited, grace.promise]);
            grace.cancel();
            if (code !== null) {
                throw new Error(
                    `The installer did not finish within ${Math.round((run.timeoutMs ?? INSTALLER_TIMEOUT_MS) / 60_000)} minutes and was stopped`,
                );
            }
        }
        throw new InstallerStillRunningError(
            "The installer did not finish in time and did not exit when stopped",
        );
    } finally {
        offData();
        offExit();
    }
}

/**
 * Stops an installer a previous service run left behind (the service
 * restarted mid-install) and waits until it is gone. Throws when it
 * cannot be confirmed stopped.
 */
export async function stopLeftoverInstaller(
    proc: InstallerProcessApi = processApi,
    pollMs = 250,
    limitMs = 15_000,
): Promise<boolean> {
    if (!(await proc.exists(INSTALLER_PROC_ID))) return false;
    await proc.kill(INSTALLER_PROC_ID, "SIGKILL");
    const deadline = Date.now() + limitMs;
    while (Date.now() < deadline) {
        if (!(await proc.exists(INSTALLER_PROC_ID))) return true;
        await delay(pollMs, null).promise;
    }
    throw new InstallerStillRunningError("A leftover server installer did not exit when stopped");
}
