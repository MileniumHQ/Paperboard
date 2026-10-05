import {
    config,
    files as fileApi,
    system,
    type ServiceContext,
} from "@mileniumhq/paperapi";
import { parseProperties, extractServerPort, cleanMotdValue } from "../core/properties";
import type { GameServerState } from "./types";
import { PANEL_ID } from "./types";

export { parseProperties };

export async function loadConfigAndProperties(
    ctx: ServiceContext<GameServerState>,
): Promise<void> {
    try {
        const saved = await config.get<any>(PANEL_ID);
        const patch: Partial<GameServerState> = {};
        if (saved?.software) patch.serverSoftware = saved.software;
        if (saved?.version) patch.serverVersion = saved.version;
        if (typeof saved?.ramGB === "number") patch.ramAllocation = saved.ramGB;

        try {
            patch.localIp = await system.getLocalIP();
        } catch (err) {
            console.debug("[Service:Config] local IP lookup failed:", String(err));
        }

        const propertiesContent = await fileApi.read("server.properties", PANEL_ID);
        if (propertiesContent) {
            const props = parseProperties(propertiesContent);
            const port = extractServerPort(props);
            // While the server is up, serverPort is the ACTUAL bound port
            // captured from its startup log. Projecting the newly configured
            // (not-yet-applied) value here made Overview advertise a port the
            // running server was not listening on until the next restart.
            const status = ctx.state.serverStatus;
            const serverLive = status !== undefined && status !== "offline";
            if (port && !serverLive) patch.serverPort = port;
            const motd = cleanMotdValue(props["motd"]);
            if (motd) patch.serverMotd = motd;
        }
        ctx.setState(patch);
    } catch (err) {
        console.error("[Service:Config] Error loading server config:", err);
    }
}

export async function updatePanelConfig(
    ctx: ServiceContext<GameServerState>,
    patch: Record<string, unknown>,
): Promise<void> {
    let current: Record<string, unknown> = {};
    try {
        const saved = await config.get<Record<string, unknown>>(PANEL_ID);
        if (saved && typeof saved === "object") current = saved;
    } catch (err) {
        console.debug("[Service:Config] no saved panel config yet:", String(err));
    }
    await config.set({ ...current, ...patch }, PANEL_ID);
    await loadConfigAndProperties(ctx);
}
