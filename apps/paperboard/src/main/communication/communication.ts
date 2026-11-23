import { type IpcMain, webContents } from "electron";
import shelldata from "./shelldata";
import discovery from "./discovery";
import connectionPool from "./papercrane/ConnectionPool";
import { isShellUrl } from "./shellGuard";
import { addShellPushSink, pushToShells } from "./shellPush";
import type { DiscoveredComputer } from "../../shared/shellContract";

// privileged/host-coupled channels only; data flows through daemon
export function startCommunicator(ipcMain: IpcMain) {
    shelldata(ipcMain);

    // event pushes go to shell documents only, by the same allowlist every
    // shell channel answers by: a panel, the screenshot controller or any
    // other page gets none. Browser-mode tabs attach their own sink (browserHost).
    const removeWindowSink = addShellPushSink((channel, payload) => {
        for (const wc of webContents.getAllWebContents()) {
            if (!wc.isDestroyed() && isShellUrl(wc.getURL())) wc.send(channel, payload);
        }
    });

    // a paired computer seen at a new address is followed there
    const onDiscovery = (services: DiscoveredComputer[]) => {
        void connectionPool.followDiscovered(services);
        pushToShells("discovery-changed", services);
    };
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
    const onUnreachable = () => discovery.rediscover();
    connectionPool.on("unreachable", onUnreachable);

    // stop forwarding so restart never double-subscribes
    return () => {
        connectionPool.off("change", onPoolChange);
        connectionPool.off("unreachable", onUnreachable);
        discovery.off("update", onDiscovery);
        discovery.stop();
        removeWindowSink();
    };
}
