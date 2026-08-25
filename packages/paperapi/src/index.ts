import { invoke, send, on, unpackIpcPayload } from "./ipc";

export * from "./types";
export * from "./ipc";
export * from "./config";
export * from "./package";
export * from "./file";
export * from "./process";
export * from "./panels";
export * from "./system";

// Terminal management API
export const terminalApi = {
    create: (
        id: string,
        options?: {
            cols?: number;
            rows?: number;
            cwd?: string;
            env?: Record<string, string>;
        },
    ) => send("terminal-create", { id, ...options }),

    write: (id: string, data: string) => send("terminal-write", { id, data }),

    resize: (id: string, cols: number, rows: number) =>
        send("terminal-resize", { id, cols, rows }),

    destroy: (id: string) => send("terminal-destroy", { id }),

    exists: async (id: string): Promise<boolean> =>
        invoke<boolean>("terminal-exists", { id }),

    onData: (id: string, callback: (data: string) => void) => {
        on(`terminal-data:${id}`, (event: unknown, data: any) => {
            const str = unpackIpcPayload<string>(event, data) as string;
            if (str) callback(str);
        });
    },

    onExit: (id: string, callback: (exitCode?: number) => void) => {
        on(`terminal-exit:${id}`, (event: unknown, payload: any) => {
            const raw = payload !== undefined ? payload : event;
            callback(typeof raw === "number" ? raw : raw?.exitCode);
        });
    },
};

export const terminal = terminalApi;
