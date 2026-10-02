import { contextBridge, ipcRenderer } from "electron";

// ─── Retained IPC channels ───────────────────────────────────────────────────
// These channels serve the shell window only. The preload runs in the
// shell's top frame (nodeIntegrationInSubFrames is false, so panel and
// library iframes never get it), but the allowlist here is still not the
// enforcement boundary: main answers a channel only when
// event.senderFrame.url is the shell's own origin (shellGuard.ts), shell
// windows refuse to navigate away from it, and the event-PUSH channels are
// filtered at the broadcast (communication.ts isPanelWebContents). This
// allowlist is defense-in-depth.

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
