import { contextBridge, ipcRenderer } from "electron";

// ─── Retained IPC channels ───────────────────────────────────────────────────
// These channels serve the shell window only. The preload runs in the
// shell's top frame (nodeIntegrationInSubFrames is false, so panel and
// library iframes never get it), but the allowlist here is still not the
// enforcement boundary: main answers a channel only when
// event.senderFrame.url is the shell's own origin (shellGuard.ts), shell
// windows refuse to navigate away from it, and the event-PUSH channels are
// filtered at the broadcast (communication.ts, isShellUrl). This
// allowlist is defense-in-depth.

import {
    SHELL_INVOKE_CHANNELS,
    SHELL_SEND_CHANNELS,
    SHELL_ON_CHANNELS,
} from "../main/communication/shellChannels";

const INVOKE_CHANNELS = new Set<string>(SHELL_INVOKE_CHANNELS);
const SEND_CHANNELS = new Set<string>(SHELL_SEND_CHANNELS);
const ON_CHANNELS = new Set<string>(SHELL_ON_CHANNELS);

function guard(channel: unknown): string {
    if (typeof channel !== "string") {
        throw new Error("[paperboard] IPC channel must be a string");
    }
    return channel;
}

function listenable(channel: unknown): string {
    const ch = guard(channel);
    if (!ON_CHANNELS.has(ch)) throw new Error(`[paperboard] IPC channel not allowed: ${ch}`);
    return ch;
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
        ipcRenderer.on(listenable(channel), listener as any);
    },

    once(channel: string, listener: (...args: any[]) => void): void {
        ipcRenderer.once(listenable(channel), listener as any);
    },

    removeAllListeners(channel: string): void {
        ipcRenderer.removeAllListeners(listenable(channel));
    },

    removeListener(channel: string, listener: (...args: any[]) => void): void {
        ipcRenderer.removeListener(listenable(channel), listener);
    },
};

// a failure to expose the bridge throws: the shell can't run without it
if (process.contextIsolated) {
    contextBridge.exposeInMainWorld("electron", {
        ipcRenderer: guardedIpcRenderer,
    });
} else {
    // @ts-ignore
    window.electron = { ipcRenderer: guardedIpcRenderer };
}
