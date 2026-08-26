import { type IpcMain, webContents } from "electron";
import shelldata from "./shelldata";
import discovery from "./discovery";
import connectionPool from "./papercrane/ConnectionPool";
import { logger } from "../../../papercrane/logger";

// Privileged/host-coupled channels only; data flows through PaperCrane
export function startCommunicator(ipcMain: IpcMain) {
    ipcMain.on("ping", (event) => {
        const frame = (event as any).senderFrame;
        if (frame && typeof frame.send === "function") {
            frame.send("pong", "pong");
        } else {
            event.sender.send("pong", "pong");
        }
    });

    // Renderer errors land in the main file logger for bug reports
    ipcMain.on("renderer-log", (_event, level, message) => {
        if (level !== "error" && level !== "warn" && level !== "info") return;
        const write = logger[level] ?? logger.info;
        write("[Renderer]", message);
    });
    shelldata(ipcMain);

    // Failures inside start() are contained there
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

    // Mirror pool changes to the renderer; payload matches computers-list
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

    // Stops forwarding so a restart never double-subscribes
    return () => {
        connectionPool.off("change", onPoolChange);
    };
}
