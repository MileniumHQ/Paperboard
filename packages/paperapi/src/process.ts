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
        }),

    write: (id: string, data: string): Promise<void> =>
        send("process-write", { id, data }),

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

        const exitPromise = new Promise<ProcessRunResult>((resolve) => {
            // bounded: a timeout must kill the child it started, not quietly
            // leave it running while reporting a synthetic exit code; null
            // timeout waits for the real exit
            const timer =
                timeoutMs === null
                    ? null
                    : setTimeout(() => {
                          send("process-kill", { id, signal: "SIGTERM" });
                          resolve({ exitCode: -1, code: "RUN_TIMEOUT" });
                      }, timeoutMs);

            const off = on(`process-exit:${id}`, (_event: unknown, payload: any) => {
                if (timer !== null) clearTimeout(timer);
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
