import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { isShellCall, isShellPush, isShellSend, type ShellWire } from "../shared/shellContract";

// ─── The shell's channels ────────────────────────────────────────────────────
// These channels serve the shell window only, and are the ones the contract
// declares (shared/shellContract.ts). The preload runs in the shell's top
// frame (nodeIntegrationInSubFrames is false, so panel and library iframes
// never get it), but this check is still not the enforcement boundary:
// main answers a channel only when event.senderFrame.url is the shell's own
// origin (shellGuard.ts) and reads its args against the contract, shell
// windows refuse to navigate away from it, and the event-PUSH channels are
// filtered at the broadcast (communication.ts, isShellUrl). This check is
// defense-in-depth.

const refused = (channel: unknown) => new Error(`[paperboard] IPC channel not allowed: ${String(channel)}`);

function allowed(channel: string, declared: (channel: string) => boolean): string {
    if (!declared(channel)) throw refused(channel);
    return channel;
}

const wire: ShellWire = {
    invoke(channel, args) {
        if (!isShellCall(channel)) return Promise.reject(refused(channel));
        return ipcRenderer.invoke(channel, args);
    },
    send(channel, args) {
        ipcRenderer.send(allowed(channel, isShellSend), args);
    },
    // the renderer gets the payload, never Electron's event
    on(channel, listener) {
        const ch = allowed(channel, isShellPush);
        const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
        ipcRenderer.on(ch, handler);
        return () => {
            ipcRenderer.removeListener(ch, handler);
        };
    },
};

// a failure to expose the bridge throws: the shell can't run without it
if (process.contextIsolated) {
    contextBridge.exposeInMainWorld("paperboardShell", wire);
} else {
    Object.assign(window, { paperboardShell: wire });
}
