import { type IpcMain, webContents } from "electron";
import shelldata from "./shelldata";
import discovery from "./discovery";
import connectionPool from "./papercrane/ConnectionPool";
import { logger } from "../../../papercrane/logger";

// privileged/host-coupled channels only; data flows through daemon
export function startCommunicator(ipcMain: IpcMain) {
    ipcMain.on("ping", (event) => {
        const frame = (event as any).senderFrame;
        if (frame && typeof frame.send === "function") {
            frame.send("pong", "pong");
        } else {
            event.sender.send("pong", "pong");
        }
    });

    // renderer errors land in main log; call as logger.log() to preserve this
    ipcMain.on("renderer-log", (_event, level, message) => {
        if (level !== "error" && level !== "warn" && level !== "info") return;
        logger.log(level, "[Renderer]", message);
    });
    shelldata(ipcMain);

    try {
        discovery.start();
        discovery.on("update", (services) => {
            for (const wc of webContents.getAllWebContents()) {
                if (!wc.isDestroyed()) {
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
            if (!wc.isDestroyed()) {
                wc.send("computers-changed", payload);
            }
        }
    };
    connectionPool.on("change", onPoolChange);

    // stop forwarding so restart never double-subscribes
    return () => {
        connectionPool.off("change", onPoolChange);
    };
}
