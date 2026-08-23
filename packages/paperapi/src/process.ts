import { invoke, send, on, unpackIpcPayload } from "./ipc";

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

// Background supervised process management API
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
            const text = unpackIpcPayload<string>(event, data);
            if (text) callback(text);
        });
        invoke<boolean>("process-exists", { id })
            .then((exists) => {
                if (exists) invoke("process-attach", { id }).catch(() => {});
            })
            .catch(() => {});
    },

    onStdout: (id: string, callback: (data: string) => void): void => {
        on(`process-stdout:${id}`, (event: unknown, data: any) => {
            const text = unpackIpcPayload<string>(event, data);
            if (text) callback(text);
        });
    },

    onStderr: (id: string, callback: (data: string) => void): void => {
        on(`process-stderr:${id}`, (event: unknown, data: any) => {
            const text = unpackIpcPayload<string>(event, data);
            if (text) callback(text);
        });
    },

    onExit: (id: string, callback: (exitCode?: number) => void): void => {
        on(`process-exit:${id}`, (event: unknown, payload: any) => {
            const raw = payload !== undefined ? payload : event;
            callback(typeof raw === "number" ? raw : raw?.exitCode);
        });
    },

    run: async (options: ProcessRunOptions): Promise<{ exitCode: number }> => {
        const id = `proc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        if (options.onData) {
            on(`process-data:${id}`, (event: unknown, data: any) => {
                const text = unpackIpcPayload<string>(event, data);
                options.onData!(text);
            });
        }
        if (options.onStdout) {
            on(`process-stdout:${id}`, (event: unknown, data: any) => {
                const text = unpackIpcPayload<string>(event, data);
                options.onStdout!(text);
            });
        }
        if (options.onStderr) {
            on(`process-stderr:${id}`, (event: unknown, data: any) => {
                const text = unpackIpcPayload<string>(event, data);
                options.onStderr!(text);
            });
        }

        return invoke("process-run", {
            id,
            command: options.command,
            args: options.args || [],
            cwd: options.cwd,
            env: options.env,
        });
    },
};
