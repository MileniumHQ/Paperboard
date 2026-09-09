// shell-only IPC; data operations flow through daemon
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

export default function registerShellIpc(ipcMain: IpcMain) {
    // throws retryable CRANE_NOT_READY until embedded daemon is up
    ipcMain.handle("crane-credentials", () => {
        const file = path.join(getPaperboardDir(), "local", "crane.json");
        let creds: Record<string, unknown>;
        try {
            creds = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
            throw new Error("CRANE_NOT_READY");
        }
        return { ...creds, computerId: "local" };
    });

    ipcMain.handle("clipboard-read", () => clipboard.readText());
    ipcMain.handle("clipboard-write", (_, text: string) => {
        clipboard.writeText(text);
        return true;
    });

    // settings saved over WS still need main-side side effects
    ipcMain.on("app-settings-changed", async () => {
        applyNativeTheme();
        applyRunOnStartup();
        await broadcastAppSettings().catch(() => {});
        syncTitleBarOverlays();
    });

    // ── Computer pairing & selection (privileged orchestration) ─────────────

    ipcMain.handle("computers-list", () => ({
        computers: connectionPool.listComputers(),
        activeId: connectionPool.getActiveId(),
    }));

    ipcMain.handle(
        "computer-probe",
        async (_, { host, port }: { host: string; port?: number }) => {
            return await connectionPool.probe(host, port);
        },
    );

    ipcMain.handle(
        "computer-pair",
        async (
            _,
            {
                host,
                port,
                code,
                name,
            }: { host: string; port?: number; code: string; name?: string },
        ) => {
            return await connectionPool.pairComputer(host, port, code, name);
        },
    );

    ipcMain.handle(
        "computer-update",
        (_, { id, name, port }: { id: string; name?: string; port?: number }) => {
            return connectionPool.updateComputer(id, { name, port });
        },
    );

    ipcMain.handle("computer-remove", (_, id: string) => {
        return connectionPool.removeComputer(id);
    });

    ipcMain.handle("computer-switch", (_, id: string) => {
        return connectionPool.setActive(id);
    });

    // local dir or panel files dir; remotes mount an ephemeral session
    ipcMain.handle(
        "open-panel-folder",
        async (_, { computerId, panelId }: { computerId: string; panelId?: string }) => {
            if (computerId !== "local") {
                const res = await openRemoteFolder(computerId, panelId);
                if (!res.ok) {
                    logger.warn(`[Shell] open-panel-folder (remote ${computerId}) failed:`, res.error);
                }
                return res.ok;
            }
            let dir = getPaperboardDir();
            const clean = panelId ? sanitizeId(panelId) : null;
            if (clean) dir = path.join(getFilesDir(), clean);
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
    ipcMain.handle("app-version", () => app.getVersion());

    // ── Network discovery of nearby PaperCrane machines ──────────────────────

    ipcMain.handle("discovery-list", () => {
        discovery.refresh();
        return discovery.list();
    });

    // restart into staged update; no-op without a download
    ipcMain.on("quit-and-install", () => {
        try {
            const { autoUpdater } = require("electron-updater");
            autoUpdater.quitAndInstall(false, true);
        } catch (err: any) {
            logger.warn("[Shell] quit-and-install failed:", err?.message ?? err);
        }
    });

    // clear update cooldown so orchestrator runs next launch
    ipcMain.on("relaunch-for-update", () => {
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
