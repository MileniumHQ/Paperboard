import type { IpcRendererEvent } from "electron";

export interface GuardedIpcRenderer {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    send(channel: string, ...args: unknown[]): void;
    on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void;
    once(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void;
    removeListener(channel: string, listener: (...args: any[]) => void): void;
    removeAllListeners(channel: string): void;
}

declare global {
    interface Window {
        electron: {
            ipcRenderer: GuardedIpcRenderer;
        };
        api?: unknown;
    }
}

export {};
