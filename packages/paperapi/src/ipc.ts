import type { IpcRendererLike } from "./types";

// Resolves an IPC renderer object from a given window object
function resolveIpc(win: any): IpcRendererLike | undefined {
    return win?.electron?.ipcRenderer || win?.ipcRenderer || win?.api?.ipcRenderer || win?.api;
}

// Discovers the available Electron IPC interface in window, parent iframe, or top window
function getIpc(): IpcRendererLike | undefined {
    if (typeof window === "undefined") return undefined;

    const direct = resolveIpc(window);
    if (direct && (typeof direct.send === "function" || typeof direct.invoke === "function")) {
        return direct;
    }

    try {
        if (window.parent && window.parent !== window) {
            const parentIpc = resolveIpc(window.parent);
            if (parentIpc && (typeof parentIpc.send === "function" || typeof parentIpc.invoke === "function")) {
                return parentIpc;
            }
        }
    } catch {}

    try {
        if (window.top && window.top !== window && window.top !== window.parent) {
            const topIpc = resolveIpc(window.top);
            if (topIpc && (typeof topIpc.send === "function" || typeof topIpc.invoke === "function")) {
                return topIpc;
            }
        }
    } catch {}

    return undefined;
}

// Unpacks raw event/payload arguments from IPC listeners
export function unpackIpcPayload<T = any>(event: unknown, data: any): T {
    const raw = data !== undefined ? data : event;
    if (raw && typeof raw === "object" && "data" in raw && typeof (raw as any).data === "string") {
        return (raw as any).data;
    }
    return raw as T;
}

export const ipcRenderer: IpcRendererLike = {
    invoke: (channel, ...args) =>
        getIpc()?.invoke(channel, ...args) ?? Promise.reject(new Error(`[paperapi] IPC unavailable for ${channel}`)),
    send: (channel, ...args) => getIpc()?.send(channel, ...args),
    on: (channel, listener) => getIpc()?.on(channel, listener),
    once: (channel, listener) => getIpc()?.once?.(channel, listener),
    removeListener: (channel, listener) => getIpc()?.removeListener?.(channel, listener),
    removeAllListeners: (channel) => getIpc()?.removeAllListeners?.(channel),
};

export const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args);

export const send = (channel: string, ...args: unknown[]): void =>
    ipcRenderer.send(channel, ...args);

export const on = (
    channel: string,
    listener: (event: any, ...args: any[]) => void,
): (() => void) | void => ipcRenderer.on(channel, listener);
