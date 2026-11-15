import { RPC_ROUTES, send, on, type StreamSubscription } from "./ipc";
import { processRunParams } from "./transport/params";
import { newClientId } from "./channels";
import { errorMessage } from "./errors";

// How long stop() waits after each signal for the process to end. The
// daemon gives a whole service 3 s to stop, so one stop() inside it ends
// in time.
const STOP_GRACE_MS = 2_000;

export interface ProcessRunResult {
    exitCode: number;
    /** Machine-readable cause when the run ended without a child exit. */
    code?: "RUN_TIMEOUT";
}

export interface ProcessRunOptions {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    onData?: (data: string) => void;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
}

export interface ProcessStartOptions {
    id: string;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    /** false: the process starts with its input closed, so one that reads input to its end isn't left waiting; writes to it fail */
    stdin?: boolean;
    /** how written text reaches the process; default "utf8". "utf16le" for a Windows program that reads its input as UTF-16 */
    inputEncoding?: "utf8" | "utf16le";
    /** Windows: the process reads an empty console instead of a pipe, for a program that fails on a pipe (a Source dedicated server in -console mode); writes to it fail. No effect elsewhere */
    consoleInput?: boolean;
    /** people rely on it while it runs (a game server): an update of what it runs from waits for it instead of stopping it. Other processes are stopped for an update once they ran under ten minutes, and the panel's afterUpdate starts them again */
    important?: boolean;
}

/** What stopProcess needs of whatever runs the process: processApi, or a test's stand-in. */
export interface ProcessStopHost {
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    /** Calls `callback` when the process exits; returns its teardown. One with `attached` (processApi's) says whether there is anything to hear. */
    onExit(id: string, callback: (exitCode?: number) => void): (() => void) & { readonly attached?: Promise<boolean> };
}

export interface StopProcessOptions {
    /** what runs the process (default processApi) */
    host?: ProcessStopHost;
    /** how long to wait after each signal for the exit, in ms (default 2000) */
    graceMs?: number;
}

/**
 * Stops a process: SIGTERM, then SIGKILL if it is still running after the
 * grace, and resolves once the host says it's gone. One that isn't running,
 * or that ends between the look and the signal, is already stopped; one still
 * running after both signals throws.
 */
export async function stopProcess(id: string, options: StopProcessOptions = {}): Promise<void> {
    const host = options.host ?? processApi;
    const graceMs = options.graceMs ?? STOP_GRACE_MS;
    let exited!: () => void;
    const gone = new Promise<void>((resolve) => (exited = resolve));
    const off = host.onExit(id, () => exited());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        // the daemon tells a process's exit only to connections attached to it;
        // nothing to attach to is nothing running
        if (off.attached && !(await off.attached)) return;
        for (const signal of ["SIGTERM", "SIGKILL"]) {
            if (!(await host.exists(id))) return;
            // one that ended between the look and the signal is stopped all the same
            await host.kill(id, signal).catch(async (err) => {
                if (await host.exists(id)) throw err;
            });
            await Promise.race([gone, new Promise<void>((resolve) => (timer = setTimeout(resolve, graceMs)))]);
            clearTimeout(timer);
        }
        if (await host.exists(id)) throw new Error(`The process ${id} didn't stop`);
    } finally {
        clearTimeout(timer);
        off();
    }
}

// a process stream's text, empty chunks dropped; returns its teardown
function onText(stream: "process-data" | "process-stdout" | "process-stderr", id: string, callback: (data: string) => void): StreamSubscription {
    return on(`${stream}:${id}`, (_event: unknown, data: unknown) => {
        if (typeof data === "string" && data) callback(data);
    });
}

// supervised background processes
export const processApi = {
    // the router shapes the wire params, one place for every start option
    start: (options: ProcessStartOptions): Promise<{ success: boolean }> =>
        RPC_ROUTES["process-start"].call(undefined, processRunParams(options)),

    write: (id: string, data: string): Promise<void> =>
        send("process-write", { id, data }),

    /** Ends the process's input once what was written reaches it, for a program that reads its input to the end before it goes on. Later writes fail. */
    closeInput: (id: string): Promise<void> =>
        send("process-close-input", { id }),

    kill: (id: string, signal: string = "SIGTERM"): Promise<void> =>
        send("process-kill", { id, signal }),

    exists: (id: string): Promise<boolean> => RPC_ROUTES["process-exists"].call(undefined, { id }),

    /**
     * Stops a supervised process: SIGTERM, then SIGKILL if it is still running
     * after a grace of 2 s, and resolves once the daemon says it's gone. One
     * that isn't running is already stopped; one still running after both
     * signals throws. See stopProcess for a host of the caller's own.
     */
    stop: (id: string, options?: Pick<StopProcessOptions, "graceMs">): Promise<void> => stopProcess(id, options),

    attach: (id: string): Promise<{ success: boolean }> => RPC_ROUTES["process-attach"].call(undefined, { id }),

    onData: (id: string, callback: (data: string) => void): StreamSubscription => onText("process-data", id, callback),

    onStdout: (id: string, callback: (data: string) => void): StreamSubscription => onText("process-stdout", id, callback),

    onStderr: (id: string, callback: (data: string) => void): StreamSubscription => onText("process-stderr", id, callback),

    onExit: (id: string, callback: (exitCode?: number) => void): StreamSubscription => {
        return on(`process-exit:${id}`, (_event: unknown, exit: { exitCode?: number }) => {
            callback(exit.exitCode);
        });
    },

    run: async (options: ProcessRunOptions, timeoutMs: number | null = 30_000): Promise<ProcessRunResult> => {
        const id = newClientId("proc");
        const unsubscribers: (() => void)[] = [];
        if (options.onData) unsubscribers.push(onText("process-data", id, options.onData));
        if (options.onStdout) unsubscribers.push(onText("process-stdout", id, options.onStdout));
        if (options.onStderr) unsubscribers.push(onText("process-stderr", id, options.onStderr));

        // the deadline starts once the daemon started the child: a start it
        // refused has nothing to time out, and nothing to kill
        let timer: ReturnType<typeof setTimeout> | null = null;
        let startDeadline = () => {};
        const exitPromise = new Promise<ProcessRunResult>((resolve, reject) => {
            // bounded: a timeout must kill the child it started, not quietly
            // leave it running while reporting a synthetic exit code; a kill
            // the daemon refused rejects the run, since the child lives on.
            // null timeout waits for the real exit. Once the deadline passes
            // the run is a timeout however it ends: the child the kill ends
            // can report its exit before the kill's answer arrives, and the
            // code it dies with (143 for SIGTERM) is not the command's verdict
            let timedOut = false;
            let exited = false;
            startDeadline = () => {
                if (timeoutMs === null || exited) return;
                timer = setTimeout(() => {
                    timedOut = true;
                    send("process-kill", { id, signal: "SIGTERM" }).then(
                        () => resolve({ exitCode: -1, code: "RUN_TIMEOUT" }),
                        (err) =>
                            reject(
                                new Error(
                                    `"${options.command}" timed out after ${timeoutMs} ms and could not be stopped: ${errorMessage(err)}`,
                                ),
                            ),
                    );
                }, timeoutMs);
            };

            unsubscribers.push(on(`process-exit:${id}`, (_event: unknown, exit: { exitCode?: number }) => {
                exited = true;
                if (timer !== null) clearTimeout(timer);
                if (timedOut) {
                    resolve({ exitCode: -1, code: "RUN_TIMEOUT" });
                    return;
                }
                resolve({ exitCode: exit.exitCode ?? 0 });
            }));
        });

        try {
            await RPC_ROUTES["process-run"].call(undefined, processRunParams<ProcessStartOptions>({ id, command: options.command, args: options.args, cwd: options.cwd, env: options.env }));
            startDeadline();
            return await exitPromise;
        } finally {
            if (timer !== null) clearTimeout(timer);
            for (const off of unsubscribers) off();
        }
    },

    exec: async (
        command: string,
        args: string[] = [],
        options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; execBufferCapBytes?: number },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        // BOUNDED: a chatty command must not balloon exec's memory cap-free
        const cap = options?.execBufferCapBytes ?? 10 * 1024 * 1024;
        let stdout = "";
        let stderr = "";
        const res = await processApi.run(
            {
                command,
                args,
                cwd: options?.cwd,
                env: options?.env,
                onStdout: (text) => {
                    if (stdout.length < cap) stdout += text;
                },
                onStderr: (text) => {
                    if (stderr.length < cap) stderr += text;
                },
            },
            options?.timeoutMs ?? 30_000,
        );
        // a timeout is not an exit code -1 shaped like any other failure:
        // reject loudly so callers can't mistake partial output for success
        if (res.code === "RUN_TIMEOUT") {
            throw new Error(
                `RUN_TIMEOUT: "${command}" exceeded ${options?.timeoutMs ?? 30_000}ms and was killed`,
            );
        }
        return {
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: res.exitCode,
        };
    },
};

export const process = processApi;
