// shell-only IPC; data operations flow through daemon.
// Every handler below validates event.senderFrame.url via shellGuard:
// panel:// origins get a typed PANEL_IPC_REFUSED, never an answer.
import { type IpcMain, app, clipboard, shell } from "electron";
import { broadcastAppSettings, syncTitleBarOverlays, applyNativeTheme, applyRunOnStartup } from "../appSettings";
import * as fs from "fs";
import * as path from "path";
import { getLocalDir } from "../../../papercrane/paths";
import { logger } from "../../../papercrane/logger";
import { getAppUpdateState } from "../appUpdateSession";
import { assertShellFrame, isRefusedFrame } from "./shellGuard";
import { createShellInvokeHandlers, SHARED_SHELL_INVOKE_CHANNELS } from "./shellHandlers";

// main-side effects of freshly saved settings; browser mode runs the same
export function applySavedAppSettings(): void {
    void (async () => {
        applyNativeTheme();
        applyRunOnStartup();
        await broadcastAppSettings().catch((err) => logger.warn("[shelldata] settings broadcast failed:", err));
        syncTitleBarOverlays();
    })().catch((err) =>
        logger.warn("[shelldata] app-settings-changed failed:", err?.message ?? err),
    );
}

export default function registerShellIpc(ipcMain: IpcMain) {
    // Electron 44 rearchitected the clipboard module to the W3C shape: the
    // read/write methods now return Promises. Awaiting is correct on both the
    // old and new APIs (await on a non-Promise resolves it), so write success
    // reflects the actual write instead of reporting true unconditionally.
    ipcMain.handle("clipboard-read", async (event) => {
        assertShellFrame(event, "clipboard-read");
        return await clipboard.readText();
    });
    ipcMain.handle("clipboard-write", async (event, text: string) => {
        assertShellFrame(event, "clipboard-write");
        await clipboard.writeText(text);
        return true;
    });

    // settings saved over WS still need main-side side effects.
    // ipcMain.on does not observe async handler rejections: the async work
    // runs in an explicit closure with its own catch so a throw outside the
    // internally-guarded appliers can never become an unobserved rejection.
    ipcMain.on("app-settings-changed", (event) => {
        if (isRefusedFrame(event)) {
            logger.warn('[Shell] PANEL_IPC_REFUSED: channel "app-settings-changed" is shell-only');
            return;
        }
        applySavedAppSettings();
    });

    // pairing, discovery, folders, version, daemon credentials: the same
    // handlers the browser-mode bridge serves (shellHandlers.ts)
    const shared = createShellInvokeHandlers({
        appVersion: () => app.getVersion(),
        openPath: (dir) => shell.openPath(dir),
    });
    for (const channel of SHARED_SHELL_INVOKE_CHANNELS) {
        const handler = shared[channel];
        ipcMain.handle(channel, (event, args) => {
            assertShellFrame(event, channel);
            return handler(args);
        });
    }

    ipcMain.handle("app-update-state", (event) => {
        assertShellFrame(event, "app-update-state");
        return getAppUpdateState();
    });
    ipcMain.handle("open-update-download", async (event) => {
        assertShellFrame(event, "open-update-download");
        await shell.openExternal("https://paperboard.dev/downloads/");
    });

    // restart into staged update; no-op without a download
    ipcMain.on("quit-and-install", (event) => {
        if (isRefusedFrame(event)) {
            logger.warn('[Shell] PANEL_IPC_REFUSED: channel "quit-and-install" is shell-only');
            return;
        }
        try {
            const { autoUpdater } = require("electron-updater");
            autoUpdater.quitAndInstall(false, true);
        } catch (err: any) {
            logger.warn("[Shell] quit-and-install failed:", err?.message ?? err);
        }
    });

    // clear update cooldown so orchestrator runs next launch
    ipcMain.on("relaunch-for-update", (event) => {
        if (isRefusedFrame(event)) {
            logger.warn('[Shell] PANEL_IPC_REFUSED: channel "relaunch-for-update" is shell-only');
            return;
        }
        try {
            fs.rmSync(path.join(getLocalDir(), "last_update.json"), {
                force: true,
            });
        } catch (err: any) {
            logger.warn(
                "[Shell] failed to clear update state:",
                err?.message ?? err,
            );
        }
        const args = process.argv.slice(1).filter((a) => a !== "--update");
        // AppImage execPath dies with the process; relaunch via APPIMAGE env
        if (process.platform === "linux" && process.env.APPIMAGE) {
            app.relaunch({ execPath: process.env.APPIMAGE, args });
        } else {
            app.relaunch({ args });
        }
        app.quit();
    });

    // full quit from the settings UI: the same path as the tray/menu Quit
    ipcMain.on("quit-app", (event) => {
        if (isRefusedFrame(event)) {
            logger.warn('[Shell] PANEL_IPC_REFUSED: channel "quit-app" is shell-only');
            return;
        }
        app.quit();
    });
}
