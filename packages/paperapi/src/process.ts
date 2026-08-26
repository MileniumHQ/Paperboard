import { invoke, send, on, unpackIpcPayload } from "./ipc";
import { debugErr } from "./debug";

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

    run: async (options: ProcessRunOptions): Promise<{ exitCode: number }> => {
        const id = `proc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const unsubscribers: (() => void)[] = [];

        if (options.onData) {
            const off = on(`process-data:${id}`, (event: unknown, data: any) => {
                const text = unpackIpcPayload<string>(event, data) as string;
                options.onData!(text);
            });
            unsubscribers.push(off);
        }
        if (options.onStdout) {
            const off = on(`process-stdout:${id}`, (event: unknown, data: any) => {
                const text = unpackIpcPayload<string>(event, data) as string;
                options.onStdout!(text);
            });
            unsubscribers.push(off);
        }
        if (options.onStderr) {
            const off = on(`process-stderr:${id}`, (event: unknown, data: any) => {
                const text = unpackIpcPayload<string>(event, data) as string;
                options.onStderr!(text);
            });
            unsubscribers.push(off);
        }

        try {
            return await invoke<{ exitCode: number }>("process-run", {
                id,
                command: options.command,
                args: options.args || [],
                cwd: options.cwd,
                env: options.env,
            });
        } finally {
            // process-run resolves on exit; release the stream subscriptions.
            for (const off of unsubscribers) off();
        }
    },
};
