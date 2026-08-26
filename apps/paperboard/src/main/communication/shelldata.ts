// Shell-only IPC; data operations flow through PaperCrane
import { type IpcMain, app, clipboard } from "electron";
import connectionPool from "./papercrane/ConnectionPool";
import discovery from "./discovery";
import { broadcastAppSettings, syncTitleBarOverlays, applyNativeTheme } from "../appSettings";
import * as fs from "fs";
import * as path from "path";
import { getLocalDir, getPaperboardDir } from "../../../papercrane/paths";
import { logger } from "../../../papercrane/logger";

export default function registerShellIpc(ipcMain: IpcMain) {
    // Throws retryable CRANE_NOT_READY while crane.json is missing or
    // corrupt (null would corrupt the ws URL); callers retry cleanly
    // once the embedded daemon is up.
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

    // Settings saved over WS still need main-side side effects
    ipcMain.on("app-settings-changed", async () => {
        applyNativeTheme();
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

    // ── Network discovery of nearby PaperCrane machines ──────────────────────

    ipcMain.handle("discovery-list", () => {
        discovery.refresh();
        return discovery.list();
    });

    // Clears the update cooldown so the orchestrator runs on the next launch
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
        // Inside an AppImage, process.execPath lives in a temporary squashfs
        // mount that dies with this process; relaunching it directly yields a
        // window that can't load its files (chrome-error). Launch through the
        // AppImage itself instead.
        if (process.platform === "linux" && process.env.APPIMAGE) {
            app.relaunch({ execPath: process.env.APPIMAGE, args });
        } else {
            app.relaunch({ args });
        }
        app.quit();
    });
}
