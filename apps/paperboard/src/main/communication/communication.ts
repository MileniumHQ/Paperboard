import { type IpcMain, webContents } from "electron";
import shelldata from "./shelldata";
import discovery from "./discovery";
import connectionPool from "./papercrane/ConnectionPool";
import { logger } from "../../../papercrane/logger";
import { isRefusedFrame, isShellUrl } from "./shellGuard";
import { addShellPushSink, pushToShells } from "./shellPush";

// renderer errors land in main log; call as logger.log() to preserve this.
// Browser mode forwards its renderer-log sends here too.
export function logRendererMessage(level: unknown, message: unknown): void {
    if (level !== "error" && level !== "warn" && level !== "info") return;
    logger.log(level, "[Renderer]", String(message));
}

// privileged/host-coupled channels only; data flows through daemon
export function startCommunicator(ipcMain: IpcMain) {
    ipcMain.on("renderer-log", (event, level, message) => {
        if (isRefusedFrame(event)) {
            logger.warn('[Shell] PANEL_IPC_REFUSED: channel "renderer-log" is shell-only');
            return;
        }
        logRendererMessage(level, message);
    });
    shelldata(ipcMain);

    // event pushes go to shell documents only, by the same allowlist every
    // shell channel answers by: a panel, the screenshot controller or any
    // other page gets none. Browser-mode tabs attach their own sink (browserHost).
    const removeWindowSink = addShellPushSink((channel, payload) => {
        for (const wc of webContents.getAllWebContents()) {
            if (!wc.isDestroyed() && isShellUrl(wc.getURL())) wc.send(channel, payload);
        }
    });

    const onDiscovery = (services: unknown) => pushToShells("discovery-changed", services);
    // a failure to browse is kept and said by discovery-list
    discovery.start();
    discovery.on("update", onDiscovery);

    // mirror pool changes; payload matches computers-list
    const onPoolChange = () => {
        pushToShells("computers-changed", {
            computers: connectionPool.listComputers(),
            activeId: connectionPool.getActiveId(),
        });
    };
    connectionPool.on("change", onPoolChange);

    // stop forwarding so restart never double-subscribes
    return () => {
        connectionPool.off("change", onPoolChange);
        discovery.off("update", onDiscovery);
        discovery.stop();
        removeWindowSink();
    };
}
