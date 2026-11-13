import { invoke, send, on, unpackIpcPayload } from "./ipc";
import { newClientId } from "./channels";

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

// supervised background processes
export const processApi = {
    start: async (options: ProcessStartOptions): Promise<{ success: boolean }> =>
        invoke("process-start", {
            id: options.id,
            command: options.command,
            args: options.args || [],
            cwd: options.cwd,
            env: options.env,
            ...(options.stdin === false ? { stdin: false } : {}),
            ...(options.inputEncoding ? { inputEncoding: options.inputEncoding } : {}),
            ...(options.consoleInput ? { consoleInput: true } : {}),
            ...(options.important ? { important: true } : {}),
        }),

    write: (id: string, data: string): Promise<void> =>
        send("process-write", { id, data }),

    /** Ends the process's input once what was written reaches it, for a program that reads its input to the end before it goes on. Later writes fail. */
    closeInput: (id: string): Promise<void> =>
        send("process-close-input", { id }),

    kill: (id: string, signal: string = "SIGTERM"): Promise<void> =>
        send("process-kill", { id, signal }),

    exists: async (id: string): Promise<boolean> =>
        invoke<boolean>("process-exists", { id }),

    attach: async (id: string): Promise<{ success: boolean }> =>
        invoke<{ success: boolean }>("process-attach", { id }),

    onData: (id: string, callback: (data: string) => void): (() => void) => {
        // attach + track are handled by on(); the UNSUBSCRIBE must too —
        // every subscription returns its teardown or it is a leak
        return on(`process-data:${id}`, (event: unknown, data: any) => {
            const text = unpackIpcPayload<string>(event, data) as string;
            if (text) callback(text);
        });
    },

    onStdout: (id: string, callback: (data: string) => void): (() => void) => {
        return on(`process-stdout:${id}`, (event: unknown, data: any) => {
            const text = unpackIpcPayload<string>(event, data) as string;
            if (text) callback(text);
        });
    },

    onStderr: (id: string, callback: (data: string) => void): (() => void) => {
        return on(`process-stderr:${id}`, (event: unknown, data: any) => {
            const text = unpackIpcPayload<string>(event, data) as string;
            if (text) callback(text);
        });
    },

    onExit: (id: string, callback: (exitCode?: number) => void): (() => void) => {
        return on(`process-exit:${id}`, (event: unknown, payload: any) => {
            const raw = payload !== undefined ? payload : event;
            callback(typeof raw === "number" ? raw : raw?.exitCode);
        });
    },

    run: async (options: ProcessRunOptions, timeoutMs: number | null = 30_000): Promise<ProcessRunResult> => {
        const id = newClientId("proc");
        const unsubscribers: (() => void)[] = [];

        if (options.onData) {
            const off = on(`process-data:${id}`, (event: unknown, data: any) => {
                const text = unpackIpcPayload<string>(event, data) as string;
                if (text) options.onData!(text);
            });
            if (off) unsubscribers.push(off);
        }
        if (options.onStdout) {
            const off = on(`process-stdout:${id}`, (event: unknown, data: any) => {
                const text = unpackIpcPayload<string>(event, data) as string;
                if (text) options.onStdout!(text);
            });
            if (off) unsubscribers.push(off);
        }
        if (options.onStderr) {
            const off = on(`process-stderr:${id}`, (event: unknown, data: any) => {
                const text = unpackIpcPayload<string>(event, data) as string;
                if (text) options.onStderr!(text);
            });
            if (off) unsubscribers.push(off);
        }

        const exitPromise = new Promise<ProcessRunResult>((resolve, reject) => {
            // bounded: a timeout must kill the child it started, not quietly
            // leave it running while reporting a synthetic exit code; a kill
            // the daemon refused rejects the run, since the child lives on.
            // null timeout waits for the real exit. Once the deadline passes
            // the run is a timeout however it ends: the child the kill ends
            // can report its exit before the kill's answer arrives, and the
            // code it dies with (143 for SIGTERM) is not the command's verdict
            let timedOut = false;
            const timer =
                timeoutMs === null
                    ? null
                    : setTimeout(() => {
                          timedOut = true;
                          send("process-kill", { id, signal: "SIGTERM" }).then(
                              () => resolve({ exitCode: -1, code: "RUN_TIMEOUT" }),
                              (err) =>
                                  reject(
                                      new Error(
                                          `"${options.command}" timed out after ${timeoutMs} ms and could not be stopped: ${err instanceof Error ? err.message : String(err)}`,
                                      ),
                                  ),
                          );
                      }, timeoutMs);

            const off = on(`process-exit:${id}`, (_event: unknown, payload: any) => {
                if (timer !== null) clearTimeout(timer);
                if (timedOut) {
                    resolve({ exitCode: -1, code: "RUN_TIMEOUT" });
                    return;
                }
                const raw = payload !== undefined ? payload : _event;
                const code = typeof raw === "number" ? raw : raw?.exitCode ?? 0;
                resolve({ exitCode: code });
            });
            if (off) unsubscribers.push(off);
        });

        try {
            await invoke<{ success: boolean }>("process-run", {
                id,
                command: options.command,
                args: options.args || [],
                cwd: options.cwd,
                env: options.env,
            });

            return await exitPromise;
        } finally {
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
