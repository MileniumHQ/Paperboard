import { contextBridge, ipcRenderer } from "electron";

// ─── Retained IPC channels ───────────────────────────────────────────────────
// Panels use no Electron IPC; these channels serve the shell window only.

import {
    SHELL_INVOKE_CHANNELS,
    SHELL_SEND_CHANNELS,
    SHELL_ON_CHANNELS,
} from "../main/communication/shellChannels";

const INVOKE_CHANNELS = new Set<string>(SHELL_INVOKE_CHANNELS);
const SEND_CHANNELS = new Set<string>(SHELL_SEND_CHANNELS);
const LISTEN_PATTERNS = SHELL_ON_CHANNELS.map((c) => new RegExp(`^${c}$`));

function guard(channel: unknown): string {
    if (typeof channel !== "string") {
        throw new Error("[paperboard] IPC channel must be a string");
    }
    return channel;
}

const guardedIpcRenderer = {
    invoke(channel: string, ...args: unknown[]): Promise<unknown> {
        const ch = guard(channel);
        if (!INVOKE_CHANNELS.has(ch)) {
            return Promise.reject(
                new Error(`[paperboard] IPC channel not allowed: ${ch}`),
            );
        }
        return ipcRenderer.invoke(ch, ...args);
    },

    send(channel: string, ...args: unknown[]): void {
        const ch = guard(channel);
        if (!SEND_CHANNELS.has(ch)) {
            throw new Error(`[paperboard] IPC channel not allowed: ${ch}`);
        }
        ipcRenderer.send(ch, ...args);
    },

    on(channel: string, listener: (...args: any[]) => void): void {
        const ch = guard(channel);
        if (!LISTEN_PATTERNS.some((re) => re.test(ch))) {
            throw new Error(`[paperboard] IPC channel not allowed: ${ch}`);
        }
        ipcRenderer.on(ch, listener as any);
    },

    once(channel: string, listener: (...args: any[]) => void): void {
        const ch = guard(channel);
        if (!LISTEN_PATTERNS.some((re) => re.test(ch))) {
            throw new Error(`[paperboard] IPC channel not allowed: ${ch}`);
        }
        ipcRenderer.once(ch, listener as any);
    },

    removeAllListeners(channel: string): void {
        const ch = guard(channel);
        if (!LISTEN_PATTERNS.some((re) => re.test(ch))) {
            throw new Error(`[paperboard] IPC channel not allowed: ${ch}`);
        }
        ipcRenderer.removeAllListeners(ch);
    },

    removeListener(channel: string, listener: (...args: any[]) => void): void {
        const ch = guard(channel);
        if (!LISTEN_PATTERNS.some((re) => re.test(ch))) {
            throw new Error(`[paperboard] IPC channel not allowed: ${ch}`);
        }
        ipcRenderer.removeListener(ch, listener);
    },
};

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld("electron", {
            ipcRenderer: guardedIpcRenderer,
        });
    } catch (error) {
        console.error(error);
    }
} else {
    // @ts-ignore
    window.electron = { ipcRenderer: guardedIpcRenderer };
}
