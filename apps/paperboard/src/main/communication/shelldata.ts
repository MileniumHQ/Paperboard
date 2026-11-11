// shell-only IPC; data operations flow through daemon.
// Every handler below validates event.senderFrame.url via shellGuard:
// panel:// origins get a typed PANEL_IPC_REFUSED, never an answer.
import { type IpcMain, type IpcMainInvokeEvent, type WebContents, BrowserWindow, app, clipboard, dialog, nativeTheme, shell } from "electron";
import { broadcastAppSettings, syncTitleBarOverlays, applyNativeTheme, applyRunOnStartup, currentGraphics } from "../appSettings";
import * as path from "path";
import { sanitizeId } from "../../../papercrane/storage";
import { logger } from "../../../papercrane/logger";
import { getAppUpdateState } from "../appUpdateSession";
import { appUpdateDownloadUrl, checkForUpdatesNow, quitAndInstallAppUpdate, releaseHolds, updateQueue } from "../updater";
import { assertShellFrame, isRefusedFrame } from "./shellGuard";
import { createShellInvokeHandlers, SHARED_SHELL_INVOKE_CHANNELS } from "./shellHandlers";
import { runPanelImport, runPanelExport, type PanelFileTransferDeps } from "../panelFileTransfer";
import { poolEndpoint } from "../panelFileEndpoint";
import type { FileTypeFilter } from "../../shared/fileTransfer";
import { paperboardGoogleClient, signInToGoogleDrive } from "../googleOAuth";
import { googleSignInPage, loopbackRedirectPage } from "../googleSignInPage";
import { catchLoopbackRedirect, LoopbackRedirectFailure } from "../loopbackRedirect";
import type { PanelLoopbackRedirectResult } from "../../shared/loopbackRedirect";
import connectionPool from "./papercrane/ConnectionPool";
import { launchOptionsFromArgv } from "../../shared/launchOptions";
import { answerPanelPermissionAsk, openSystemPrivacySettings, panelPermissionStore } from "../panelPermissionHost";
import { isPanelPermission } from "../panelPermissions";

// native dialogs, modal to the window whose panel asked
function nativeFileDialogs(event: IpcMainInvokeEvent): PanelFileTransferDeps {
    const window = BrowserWindow.fromWebContents(event.sender);
    const filters = (list: FileTypeFilter[]) => list.map((f) => ({ name: f.name, extensions: f.extensions }));
    return {
        endpoint: poolEndpoint,
        pickSavePath: async ({ suggestedName, filters: list }) => {
            const options = { defaultPath: path.join(app.getPath("downloads"), suggestedName), filters: filters(list) };
            const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
            return result.canceled || !result.filePath ? null : result.filePath;
        },
        pickOpenPath: async ({ filters: list }) => {
            const options = { properties: ["openFile" as const], filters: filters(list) };
            const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        pickOpenPaths: async ({ filters: list, selection }) => {
            const options =
                selection === "folder"
                    ? { properties: ["openDirectory" as const] }
                    : { properties: ["openFile" as const, "multiSelections" as const], filters: filters(list) };
            const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : result.filePaths;
        },
    };
}

// open loopback redirect listeners by the shell window that asked and the
// shell's own id for the request; a window that reloads or closes stops its
// listeners, since no frame is left to hand the redirect to
const loopbackRequests = new Map<number, Map<string, AbortController>>();

function loopbackRequestsOf(sender: WebContents): Map<string, AbortController> {
    let open = loopbackRequests.get(sender.id);
    if (!open) {
        const mine = new Map<string, AbortController>();
        open = mine;
        loopbackRequests.set(sender.id, mine);
        const stopAll = () => {
            for (const controller of mine.values()) controller.abort();
            mine.clear();
        };
        sender.once("destroyed", () => {
            stopAll();
            loopbackRequests.delete(sender.id);
        });
        sender.on("did-navigate", stopAll);
    }
    return open;
}

function loopbackRequestId(args: unknown): string {
    const id = (args as { requestId?: unknown } | null)?.requestId;
    if (typeof id !== "string" || !id || id.length > 128) throw new Error("Invalid parameter: requestId");
    return id;
}

// main-side effects of freshly saved settings; browser mode runs the same.
// Resolves to why Run on startup couldn't be applied, or null.
export async function applySavedAppSettings(): Promise<string | null> {
    applyNativeTheme();
    const loginItemError = applyRunOnStartup();
    await broadcastAppSettings().catch((err) => logger.warn("[shelldata] settings broadcast failed:", err));
    syncTitleBarOverlays();
    return loginItemError;
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

    // settings saved over WS still need main-side side effects
    ipcMain.handle("app-settings-changed", (event) => {
        assertShellFrame(event, "app-settings-changed");
        return applySavedAppSettings();
    });

    // pairing, discovery, folders, version, daemon credentials: the same
    // handlers the browser-mode bridge serves (shellHandlers.ts)
    const shared = createShellInvokeHandlers({
        appVersion: () => app.getVersion(),
        launchOptions: () => launchOptionsFromArgv(process.argv),
        graphics: currentGraphics,
        openPath: (dir) => shell.openPath(dir),
    });
    for (const channel of SHARED_SHELL_INVOKE_CHANNELS) {
        const handler = shared[channel];
        ipcMain.handle(channel, (event, args) => {
            assertShellFrame(event, channel);
            return handler(args);
        });
    }

    // panel permissions: your answer to a question the window was asked,
    // and the saved answers App Settings lists and changes
    ipcMain.handle("panel-permission-answer", (event, args) => {
        assertShellFrame(event, "panel-permission-answer");
        answerPanelPermissionAsk(event.sender, args);
    });
    ipcMain.handle("panel-permissions-list", (event) => {
        assertShellFrame(event, "panel-permissions-list");
        return panelPermissionStore().list();
    });
    ipcMain.handle("panel-permission-set", (event, args) => {
        assertShellFrame(event, "panel-permission-set");
        const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
        const panelId = typeof a.panelId === "string" ? sanitizeId(a.panelId) : null;
        if (!panelId) throw new Error("Invalid parameter: panelId");
        if (!isPanelPermission(a.permission)) throw new Error("Invalid parameter: permission");
        if (a.answer !== "allowed" && a.answer !== "denied") throw new Error("Invalid parameter: answer");
        panelPermissionStore().set(panelId, a.permission, a.answer);
    });
    ipcMain.handle("open-system-privacy", (event, permission) => {
        assertShellFrame(event, "open-system-privacy");
        return openSystemPrivacySettings(permission);
    });

    // a panel's save and open dialogs; the shell names the asking frame
    ipcMain.handle("panel-file-export", (event, args) => {
        assertShellFrame(event, "panel-file-export");
        return runPanelExport(args, nativeFileDialogs(event));
    });
    ipcMain.handle("panel-file-import", (event, args) => {
        assertShellFrame(event, "panel-file-import");
        return runPanelImport(args, nativeFileDialogs(event));
    });

    // a panel's sign-in redirect to localhost, caught on this device; the
    // renderer already decided the panel runs on another computer
    ipcMain.handle("panel-loopback-redirect", async (event, args): Promise<PanelLoopbackRedirectResult> => {
        assertShellFrame(event, "panel-loopback-redirect");
        const requestId = loopbackRequestId(args);
        const open = loopbackRequestsOf(event.sender);
        if (open.has(requestId)) throw new Error(`Loopback redirect request ${requestId} is already open`);
        const controller = new AbortController();
        open.set(requestId, controller);
        try {
            const url = await catchLoopbackRedirect((args as { redirectUri?: unknown }).redirectUri, {
                signal: controller.signal,
                page: () => loopbackRedirectPage(nativeTheme.shouldUseDarkColors),
            });
            return { status: "caught", url };
        } catch (err) {
            if (err instanceof LoopbackRedirectFailure) return { status: "failed", code: err.code, message: err.message };
            logger.error("[loopback] catching a redirect failed:", err);
            return { status: "failed", code: "failed", message: (err as Error)?.message ?? String(err) };
        } finally {
            if (open.get(requestId) === controller) open.delete(requestId);
        }
    });
    ipcMain.handle("panel-loopback-redirect-cancel", (event, args) => {
        assertShellFrame(event, "panel-loopback-redirect-cancel");
        loopbackRequests.get(event.sender.id)?.get(loopbackRequestId(args))?.abort();
    });

    // adds a Google Drive backup location to a computer, or with a
    // locationId signs an existing one in again (it keeps its folder): main
    // runs the sign-in with Paperboard's Google client and hands the refresh
    // token straight to that computer's daemon, which refreshes with the
    // same client
    ipcMain.handle("backup-gdrive-connect", async (event, args) => {
        assertShellFrame(event, "backup-gdrive-connect");
        const field = (name: string, max: number) => {
            const value = args?.[name];
            if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} is required`);
            return value.trim();
        };
        const computerId = field("computerId", 128);
        const locationId = args?.locationId === undefined ? null : field("locationId", 64);
        const label = locationId ? null : field("label", 60);
        const google = paperboardGoogleClient(import.meta.env);
        if (!google) throw new Error("This build of Paperboard has no Google sign-in. Use a release build to connect Google Drive.");
        const client = connectionPool.getClient(computerId);
        // the browser tab is answered after the daemon keeps the sign-in
        return signInToGoogleDrive(
            google,
            {
                openExternal: (url) => shell.openExternal(url),
                page: (outcome, reason) => googleSignInPage(outcome, nativeTheme.shouldUseDarkColors, reason),
            },
            (refreshToken) =>
                locationId
                    ? client.call("backup:destination-reconnect", { destinationId: locationId, ...google, refreshToken }, 120_000)
                    : client.call("backup:destination-add", { destination: { kind: "gdrive", label, ...google, refreshToken } }, 120_000),
        );
    });

    ipcMain.handle("update-queue", (event) => {
        assertShellFrame(event, "update-queue");
        return updateQueue.snapshot();
    });
    // Stop and update: held updates join the list as one; resolves when they
    // ran. An update that fails there is told by the list (and its toast),
    // so only a request that could not start rejects
    ipcMain.handle("update-release", async (event, args: { keys?: unknown }) => {
        assertShellFrame(event, "update-release");
        const keys = args?.keys;
        if (!Array.isArray(keys) || keys.length === 0 || keys.length > 64 || keys.some((key) => typeof key !== "string" || !key || key.length > 512)) {
            throw new Error("keys must list the held updates");
        }
        await releaseHolds(keys as string[]);
    });
    // Settings' Update everything now: look for updates in place, now
    ipcMain.handle("update-check", async (event) => {
        assertShellFrame(event, "update-check");
        await checkForUpdatesNow();
    });
    ipcMain.handle("app-update-state", (event) => {
        assertShellFrame(event, "app-update-state");
        return getAppUpdateState();
    });
    ipcMain.handle("open-update-download", async (event) => {
        assertShellFrame(event, "open-update-download");
        await shell.openExternal(appUpdateDownloadUrl());
    });

    // restart into staged update; no-op without a download
    ipcMain.on("quit-and-install", (event) => {
        if (isRefusedFrame(event)) {
            logger.warn('[Shell] PANEL_IPC_REFUSED: channel "quit-and-install" is shell-only');
            return;
        }
        try {
            quitAndInstallAppUpdate();
        } catch (err: any) {
            logger.warn("[Shell] quit-and-install failed:", err?.message ?? err);
        }
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
