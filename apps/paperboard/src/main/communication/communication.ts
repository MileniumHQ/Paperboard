import { type IpcMain, type WebContents, webContents } from "electron";
import shelldata from "./shelldata";
import discovery from "./discovery";
import connectionPool from "./papercrane/ConnectionPool";
import { logger } from "../../../papercrane/logger";
import { isRefusedFrame } from "./shellGuard";

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

    // renderer errors land in main log; call as logger.log() to preserve this
    ipcMain.on("renderer-log", (event, level, message) => {
        if (isRefusedFrame(event)) {
            logger.warn('[Shell] PANEL_IPC_REFUSED: channel "renderer-log" is shell-only');
            return;
        }
        if (level !== "error" && level !== "warn" && level !== "info") return;
        logger.log(level, "[Renderer]", message);
    });
    shelldata(ipcMain);

    try {
        discovery.start();
        discovery.on("update", (services) => {
            for (const wc of webContents.getAllWebContents()) {
                // R11: event-push channels go to shell documents only —
                // panel iframes inherit this main process and must not
                // receive shell discovery state (the preload comment
                // claims per-channel enforcement; this makes the push
                // side true, not just the invoke side).
                if (!wc.isDestroyed() && !isPanelWebContents(wc)) {
                    wc.send("discovery-changed", services);
                }
            }
        });
    } catch (err) {
        logger.warn("[Discovery] failed to start network browsing:", err);
    }

    // mirror pool changes; payload matches computers-list
    const onPoolChange = () => {
        const payload = {
            computers: connectionPool.listComputers(),
            activeId: connectionPool.getActiveId(),
        };
        for (const wc of webContents.getAllWebContents()) {
            // R11: shell-only push — see the discovery broadcast above
            if (!wc.isDestroyed() && !isPanelWebContents(wc)) {
                wc.send("computers-changed", payload);
            }
        }
    };
    connectionPool.on("change", onPoolChange);

    // stop forwarding so restart never double-subscribes
    return () => {
        connectionPool.off("change", onPoolChange);
        discovery.stop();
    };
}
