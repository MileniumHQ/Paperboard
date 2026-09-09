import { invoke, send, on, unpackIpcPayload } from "./ipc";
import { debugErr } from "./debug";
import { newClientId } from "./channels";

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

    write: (id: string, data: string): void => {
        send("process-write", { id, data });
    },

    kill: (id: string, signal: string = "SIGTERM"): void => {
        send("process-kill", { id, signal });
    },

    exists: async (id: string): Promise<boolean> =>
        invoke<boolean>("process-exists", { id }),

    attach: async (id: string): Promise<{ success: boolean }> =>
        invoke<{ success: boolean }>("process-attach", { id }),

    onData: (id: string, callback: (data: string) => void): void => {
        on(`process-data:${id}`, (event: unknown, data: any) => {
            const text = unpackIpcPayload<string>(event, data) as string;
            if (text) callback(text);
        });
        invoke<boolean>("process-exists", { id })
            .then((exists) => {
                if (exists) invoke("process-attach", { id }).catch((err) => debugErr(`process-attach ${id}`, err));
            })
            .catch((err) => debugErr(`process-exists ${id}`, err));
    },

    onStdout: (id: string, callback: (data: string) => void): void => {
        on(`process-stdout:${id}`, (event: unknown, data: any) => {
            const text = unpackIpcPayload<string>(event, data) as string;
            if (text) callback(text);
        });
    },

    onStderr: (id: string, callback: (data: string) => void): void => {
        on(`process-stderr:${id}`, (event: unknown, data: any) => {
            const text = unpackIpcPayload<string>(event, data) as string;
            if (text) callback(text);
        });
    },

    onExit: (id: string, callback: (exitCode?: number) => void): void => {
        on(`process-exit:${id}`, (event: unknown, payload: any) => {
            const raw = payload !== undefined ? payload : event;
            callback(typeof raw === "number" ? raw : raw?.exitCode);
        });
    },

    run: async (options: ProcessRunOptions, timeoutMs = 30_000): Promise<{ exitCode: number }> => {
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

        const exitPromise = new Promise<{ exitCode: number }>((resolve) => {
            const timer = setTimeout(() => {
                resolve({ exitCode: -1 });
            }, timeoutMs);

            const off = on(`process-exit:${id}`, (_event: unknown, payload: any) => {
                clearTimeout(timer);
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
        options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        let stdout = "";
        let stderr = "";
        const res = await processApi.run(
            {
                command,
                args,
                cwd: options?.cwd,
                env: options?.env,
                onStdout: (text) => {
                    stdout += text;
                },
                onStderr: (text) => {
                    stderr += text;
                },
            },
            options?.timeoutMs ?? 30_000,
        );
        return {
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: res.exitCode,
        };
    },
};

export const process = processApi;
