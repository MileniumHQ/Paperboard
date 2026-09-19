// shell-only IPC; data operations flow through daemon.
// Every handler below validates event.senderFrame.url via shellGuard:
// panel:// origins get a typed PANEL_IPC_REFUSED, never an answer.
import { type IpcMain, app, clipboard, shell } from "electron";
import connectionPool from "./papercrane/ConnectionPool";
import discovery from "./discovery";
import { broadcastAppSettings, syncTitleBarOverlays, applyNativeTheme, applyRunOnStartup } from "../appSettings";
import * as fs from "fs";
import * as path from "path";
import { getLocalDir, getPaperboardDir, getFilesDir, ensureDir } from "../../../papercrane/paths";
import { sanitizeId } from "../../../papercrane/storage";
import { logger } from "../../../papercrane/logger";
import { openRemoteFolder } from "../remoteFolder";
import { assertShellFrame, isRefusedFrame } from "./shellGuard";
import { readCraneHandshake } from "../../../papercrane/handshake";

export default function registerShellIpc(ipcMain: IpcMain) {
    // throws retryable CRANE_NOT_READY until embedded daemon is up
    ipcMain.handle("crane-credentials", (event) => {
        assertShellFrame(event, "crane-credentials");
        const creds = readCraneHandshake();
        if (!creds) throw new Error("CRANE_NOT_READY");
        return { ...creds, computerId: "local" };
    });

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
        void (async () => {
            applyNativeTheme();
            applyRunOnStartup();
            await broadcastAppSettings().catch((err) => logger.warn("[shelldata] settings broadcast failed:", err));
            syncTitleBarOverlays();
        })().catch((err) =>
            logger.warn("[shelldata] app-settings-changed failed:", err?.message ?? err),
        );
    });

    // ── Computer pairing & selection (privileged orchestration) ─────────────

    ipcMain.handle("computers-list", (event) => {
        assertShellFrame(event, "computers-list");
        return {
            computers: connectionPool.listComputers(),
            activeId: connectionPool.getActiveId(),
        };
    });

    ipcMain.handle(
        "computer-probe",
        async (event, args?: { host: string; port?: number }) => {
            assertShellFrame(event, "computer-probe");
            const { host, port } = args ?? {};
            if (typeof host !== "string" || !host) {
                throw new Error("Missing required parameter: host");
            }
            return await connectionPool.probe(host, port);
        },
    );

    ipcMain.handle(
        "computer-pair",
        async (
            event,
            args?: { host: string; port?: number; code: string; name?: string },
        ) => {
            assertShellFrame(event, "computer-pair");
            const { host, port, code, name } = args ?? {};
            if (typeof host !== "string" || !host) {
                throw new Error("Missing required parameter: host");
            }
            if (typeof code !== "string" || !code) {
                throw new Error("Missing required parameter: code");
            }
            return await connectionPool.pairComputer(host, port, code, name);
        },
    );

    ipcMain.handle(
        "computer-update",
        (event, args?: { id: string; name?: string; port?: number }) => {
            assertShellFrame(event, "computer-update");
            const { id, name, port } = args ?? {};
            if (typeof id !== "string" || !id) {
                throw new Error("Missing required parameter: id");
            }
            return connectionPool.updateComputer(id, { name, port });
        },
    );

    ipcMain.handle("computer-remove", (event, id: string) => {
        assertShellFrame(event, "computer-remove");
        // same boundary check as every sibling handler: renderer input is
        // validated here, not trusted from the caller's types
        if (typeof id !== "string" || !id) {
            throw new Error("Missing required parameter: id");
        }
        return connectionPool.removeComputer(id);
    });

    ipcMain.handle("computer-switch", (event, id: string) => {
        assertShellFrame(event, "computer-switch");
        if (typeof id !== "string" || !id) {
            throw new Error("Missing required parameter: id");
        }
        return connectionPool.setActive(id);
    });

    // local dir or panel files dir; remotes mount an ephemeral session
    ipcMain.handle(
        "open-panel-folder",
        async (event, args?: { computerId: string; panelId?: string }) => {
            assertShellFrame(event, "open-panel-folder");
            const { computerId, panelId } = args ?? {};
            if (typeof computerId !== "string" || !computerId) {
                throw new Error("Missing required parameter: computerId");
            }
            // sanitize at this layer for BOTH branches: the local branch
            // below sanitizes, the remote branch must not receive raw input
            const cleanPanelId = panelId ? sanitizeId(panelId) : null;
            if (panelId && !cleanPanelId) {
                throw new Error("Invalid parameter: panelId");
            }
            if (computerId !== "local") {
                const res = await openRemoteFolder(computerId, cleanPanelId ?? undefined);
                if (!res.ok) {
                    logger.warn(`[Shell] open-panel-folder (remote ${computerId}) failed:`, res.error);
                }
                return res.ok;
            }
            let dir = getPaperboardDir();
            if (cleanPanelId) dir = path.join(getFilesDir(), cleanPanelId);
            try {
                ensureDir(dir);
                shell.openPath(dir);
                return true;
            } catch (err: any) {
                logger.warn("[Shell] open-panel-folder failed:", err?.message ?? err);
                return false;
            }
        },
    );

    // app version for shell label
    ipcMain.handle("app-version", (event) => {
        assertShellFrame(event, "app-version");
        return app.getVersion();
    });

    // ── Network discovery of nearby PaperCrane machines ──────────────────────

    ipcMain.handle("discovery-list", (event) => {
        assertShellFrame(event, "discovery-list");
        discovery.refresh();
        return discovery.list();
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
}
