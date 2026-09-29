import { invoke, send, on, unpackIpcPayload } from "./ipc";
import "./readiness";

export * from "./ipc";
export * from "./config";
export * from "./registryFetch";
export * from "./panelMerge";
export * from "./storeListing";
export { isPanelId, requirePanelId } from "./panelIdentity";
export * from "./identity";
export * from "./secrets";
export * from "./package";
export * from "./file";
export * from "./process";
export * from "./panels";
export * from "./system";
export * from "./actions";
export * from "./service";
export * from "./bridge";
export * from "./channels";
export * from "./protocol";
export * from "./shell";

// terminal management
export const terminalApi = {
    /** Terminal identity is the explicit argument: options cannot clobber it. */
    create: (
        id: string,
        options?: {
            cols?: number;
            rows?: number;
            cwd?: string;
            env?: Record<string, string>;
        },
    ): Promise<void> => send("terminal-create", { ...options, id }),

    write: (id: string, data: string): Promise<void> =>
        send("terminal-write", { id, data }),

    resize: (id: string, cols: number, rows: number): Promise<void> =>
        send("terminal-resize", { id, cols, rows }),

    destroy: (id: string): Promise<void> => send("terminal-destroy", { id }),

    exists: async (id: string): Promise<boolean> =>
        invoke<boolean>("terminal-exists", { id }),

    onData: (id: string, callback: (data: string) => void): (() => void) => {
        return on(`terminal-data:${id}`, (event: unknown, data: any) => {
            const str = unpackIpcPayload<string>(event, data) as string;
            if (str) callback(str);
        });
    },

    onExit: (id: string, callback: (exitCode?: number) => void): (() => void) => {
        return on(`terminal-exit:${id}`, (event: unknown, payload: any) => {
            const raw = payload !== undefined ? payload : event;
            callback(typeof raw === "number" ? raw : raw?.exitCode);
        });
    },
};

export const terminal = terminalApi;
