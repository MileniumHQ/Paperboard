// shell-only IPC; data operations flow through daemon. Every channel the
// contract declares (shared/shellContract.ts) is served here, after
// event.senderFrame.url is checked via shellGuard: panel:// origins get a
// typed PANEL_IPC_REFUSED, never an answer.
import { type IpcMain, type IpcMainInvokeEvent, type WebContents, BrowserWindow, app, dialog, nativeTheme, shell } from "electron";
import { broadcastAppSettings, syncTitleBarOverlays, applyNativeTheme, applyRunOnStartup, currentGraphics, readAppSettings } from "../appSettings";
import * as path from "path";
import { logger } from "daemon/core/logger";
import { getAppUpdateState } from "../appUpdateSession";
import { checkForUpdatesNow } from "../updater";
import { appUpdateDownloadUrl, restartToUpdate } from "../appUpdater";
import { releaseHolds } from "../updateHolds";
import { updateQueue } from "../updateQueue";
import { setShellUnsaved } from "../quitGate";
import { answerShellAsk } from "../shellAsk";
import { assertShellFrame, isRefusedFrame } from "./shellGuard";
import { createShellInvokeHandlers } from "./shellHandlers";
import { shellServer } from "./shellServer";
import type { SendArgs } from "../../shared/shellContract";
import { runPanelImport, runPanelExport, type PanelFileTransferDeps } from "../panelFileTransfer";
import { poolEndpoint } from "../panelFileEndpoint";
import type { FileTypeFilter } from "../../shared/fileTransfer";
import { cancelGoogleSignIn, paperboardGoogleClient, signInToGoogleDrive } from "../googleOAuth";
import { googleSignInPage, loopbackRedirectPage } from "../googleSignInPage";
import { catchLoopbackRedirect, LoopbackRedirectFailure } from "../loopbackRedirect";
import connectionPool from "./papercrane/ConnectionPool";
import { launchOptionsFromArgv } from "../../shared/launchOptions";
import { answerPanelPermissionAsk, openSystemPrivacySettings, panelPermissionStore } from "../panelPermissionHost";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import { issueContext, sendIssue } from "../issueSend";

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

// renderer errors land in main log; call as logger.log() to preserve this.
// Browser mode forwards its renderer-log sends here too.
export function logRendererMessage({ level, message }: SendArgs<"renderer-log">): void {
    logger.log(level, "[Renderer]", message);
}

// main-side effects of freshly saved settings; browser mode runs the same.
// Resolves to why Run on startup couldn't be applied, or null.
export async function applySavedAppSettings(): Promise<string | null> {
    const settings = readAppSettings();
    applyNativeTheme(settings);
    const loginItemError = applyRunOnStartup(settings);
    await broadcastAppSettings();
    syncTitleBarOverlays();
    return loginItemError;
}

export default function registerShellIpc(ipcMain: IpcMain) {
    const server = shellServer<IpcMainInvokeEvent>(
        "window",
        {
            // pairing, discovery, folders, version, daemon credentials, saved
            // settings: the same handlers the browser-mode bridge serves
            ...createShellInvokeHandlers({
                appVersion: () => app.getVersion(),
                launchOptions: () => launchOptionsFromArgv(process.argv),
                graphics: currentGraphics,
                openPath: (dir) => shell.openPath(dir),
                appSettingsChanged: applySavedAppSettings,
                sendIssue: (text, details) => sendIssue(text, details, issueContext("window", app.getVersion(), process.getSystemVersion())),
            }),

            // panel permissions: your answer to a question the window was asked,
            // and the saved answers App Settings lists and changes
            "panel-permission-answer": (answer, event) => answerPanelPermissionAsk(event.sender, answer),
            "panel-permissions-list": () => panelPermissionStore().list(),
            "panel-permission-set": ({ panelId, permission, answer }) => panelPermissionStore().set(panelId, permission, answer),
            "open-system-privacy": ({ permission }) => openSystemPrivacySettings(permission),

            // a panel's save and open dialogs; the shell names the asking frame
            "panel-file-export": (request, event) => runPanelExport(request, nativeFileDialogs(event)),
            "panel-file-import": (request, event) => runPanelImport(request, nativeFileDialogs(event)),

            // a panel's sign-in redirect to localhost, caught on this device; the
            // renderer already decided the panel runs on another computer
            "panel-loopback-redirect": async ({ requestId, redirectUri }, event) => {
                const open = loopbackRequestsOf(event.sender);
                if (open.has(requestId)) throw new Error(`Loopback redirect request ${requestId} is already open`);
                const controller = new AbortController();
                open.set(requestId, controller);
                try {
                    const url = await catchLoopbackRedirect(redirectUri, {
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
            },
            "panel-loopback-redirect-cancel": ({ requestId }, event) => {
                loopbackRequests.get(event.sender.id)?.get(requestId)?.abort();
            },

            // adds a Google Drive backup location to a computer, or with a
            // locationId signs an existing one in again (it keeps its folder): main
            // runs the sign-in with Paperboard's Google client and hands the refresh
            // token straight to that computer's daemon, which refreshes with the
            // same client
            "backup-gdrive-connect": (target) => {
                const google = paperboardGoogleClient(import.meta.env);
                if (!google) throw new Error("This build of Paperboard has no Google sign-in. Use a release build to connect Google Drive.");
                const client = connectionPool.getClient(target.computerId.trim());
                // the browser tab is answered after the daemon keeps the sign-in; a
                // sign-in still waiting for the browser is replaced
                return signInToGoogleDrive(
                    google,
                    {
                        openExternal: (url) => shell.openExternal(url),
                        page: (outcome, reason) => googleSignInPage(outcome, nativeTheme.shouldUseDarkColors, reason),
                    },
                    (refreshToken) =>
                        "locationId" in target
                            ? client.call("backup:location-reconnect", { locationId: target.locationId.trim(), ...google, refreshToken }, 120_000)
                            : client.call("backup:location-add", { location: { kind: "gdrive", label: target.label.trim(), ...google, refreshToken } }, 120_000),
                );
            },
            "backup-gdrive-cancel": () => cancelGoogleSignIn(),

            "update-queue": () => updateQueue.snapshot(),
            // Stop and update: held updates join the list as one; resolves when they
            // ran. An update that fails there is told by the list (and its toast),
            // so only a request that could not start rejects
            "update-release": async ({ keys }) => {
                await releaseHolds(keys);
            },
            // Settings' Update everything now: look for updates in place, now
            "update-check": () => checkForUpdatesNow(),
            "app-update-state": () => getAppUpdateState(),
            "open-update-download": () => shell.openExternal(appUpdateDownloadUrl()),

            // Restart to update: false when a page with unsaved work kept
            // Paperboard open; a refusal reaches the dialog that asked
            "quit-and-install": () => restartToUpdate(),

            // whether this window's panels hold unsaved work, which a quit asks about
            "panels-unsaved": ({ unsaved }, event) => setShellUnsaved(event.sender, unsaved),
            "quit-answer": (answer, event) => answerShellAsk(event.sender, ["quit-ask"], answer),
        },
        {
            // full quit from the settings UI: the same path as the tray/menu Quit
            "quit-app": () => app.quit(),
            "renderer-log": logRendererMessage,
        },
    );

    // every channel answers the shell document only (shellGuard.ts)
    for (const channel of server.calls) {
        ipcMain.handle(channel, (event, args) => {
            assertShellFrame(event, channel);
            return server.call(channel, args, event);
        });
    }
    for (const channel of server.sends) {
        ipcMain.on(channel, (event, args) => {
            if (isRefusedFrame(event)) {
                logger.warn(`[Shell] PANEL_IPC_REFUSED: channel "${channel}" is shell-only`);
                return;
            }
            try {
                server.send(channel, args);
            } catch (err) {
                // quiet: a send has no answer to carry its refusal, so main's log says it
                logger.error("[Shell]", errorMessage(err));
            }
        });
    }
}
