import { type IpcMain, type WebContents, webContents } from "electron";
import shelldata from "./shelldata";
import discovery from "./discovery";
import connectionPool from "./papercrane/ConnectionPool";
import { logger } from "../../../papercrane/logger";
import { isRefusedFrame } from "./shellGuard";
import { addShellPushSink, pushToShells } from "./shellPush";

// R11: event-push channels (discovery-changed, computers-changed, app-*)
// broadcast to shell documents only. A panel iframe's URL is always
// panel:// (same invariant shellGuard enforces per invoke channel); an
// unreadable URL is treated as a panel frame — deny-by-default, same
// polarity as isRefusedFrame.
function isPanelWebContents(wc: WebContents): boolean {
    try {
        const url = wc.getURL?.() ?? "";
        return url === "panel://" || url.startsWith("panel://");
    } catch (err) {
        logger.debug("[Shell] push filter could not read webContents URL:", err);
        return true;
    }
}

// renderer errors land in main log; call as logger.log() to preserve this.
// Browser mode forwards its renderer-log sends here too.
export function logRendererMessage(level: unknown, message: unknown): void {
    if (level !== "error" && level !== "warn" && level !== "info") return;
    logger.log(level, "[Renderer]", String(message));
}

// privileged/host-coupled channels only; data flows through daemon
export function startCommunicator(ipcMain: IpcMain) {
    ipcMain.on("ping", (event) => {
        if (isRefusedFrame(event)) {
            logger.warn('[Shell] PANEL_IPC_REFUSED: channel "ping" is shell-only');
            return;
        }
        const frame = (event as any).senderFrame;
        if (frame && typeof frame.send === "function") {
            frame.send("pong", "pong");
        } else {
            event.sender.send("pong", "pong");
        }
    });

    ipcMain.on("renderer-log", (event, level, message) => {
        if (isRefusedFrame(event)) {
            logger.warn('[Shell] PANEL_IPC_REFUSED: channel "renderer-log" is shell-only');
            return;
        }
        logRendererMessage(level, message);
    });
    shelldata(ipcMain);

    // R11: event-push channels go to shell documents only — panel iframes
    // inherit this main process and must not receive shell discovery or
    // pairing state. Browser-mode tabs attach their own sink (browserHost).
    const removeWindowSink = addShellPushSink((channel, payload) => {
        for (const wc of webContents.getAllWebContents()) {
            if (!wc.isDestroyed() && !isPanelWebContents(wc)) {
                wc.send(channel, payload);
            }
        }
    });

    const onDiscovery = (services: unknown) => pushToShells("discovery-changed", services);
    try {
        discovery.start();
        discovery.on("update", onDiscovery);
    } catch (err) {
        logger.warn("[Discovery] failed to start network browsing:", err);
    }

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
