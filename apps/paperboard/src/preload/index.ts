import { contextBridge, ipcRenderer } from "electron";

// ─── Retained IPC channels ───────────────────────────────────────────────────
// These channels serve the shell window only. Panel iframes inherit this
// preload, so the allowlist here is NOT the enforcement boundary — main
// validates event.senderFrame.url per invoke/send channel (shellGuard.ts:
// panel:// origins get a typed PANEL_IPC_REFUSED on every shell channel),
// and the event-PUSH channels (discovery-changed, computers-changed,
// app-update-*) are filtered at the broadcast: main skips panel://
// webContents (communication.ts isPanelWebContents). Both directions are
// enforced in main; this allowlist is defense-in-depth, not the boundary.

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
