import type { Server } from "../../service/server";
import {
    config,
    updateSettings,
    files as fileApi,
} from "../../service/api";
import { parseProperties, extractServerPort } from "../../core/properties";
import { DEFAULT_MOTD } from "../../core/motd";
import type { GameServerState } from "../../service/types";
import { isServerSoftware } from "../../software/catalog";
import { PANEL_ID } from "../../service/types";

export { parseProperties };

export async function loadConfigAndProperties(
    ctx: Server,
): Promise<void> {
    const saved = await config.get<any>(PANEL_ID);
    const patch: Partial<GameServerState> = {};
    // a software Paperboard doesn't run is a damaged setting, never shown as the default one
    if (isServerSoftware(saved?.software)) patch.serverSoftware = saved.software;
    else if (saved?.software !== undefined) throw new Error(`This server's settings name the server software ${JSON.stringify(saved.software)}, which Paperboard doesn't run`);
    if (saved?.version) patch.serverVersion = saved.version;
    if (typeof saved?.ramGB === "number") patch.ramAllocation = saved.ramGB;

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
        // kept raw: the panel renders its § codes. A missing key is the
        // game's default; an empty one is an empty message.
        patch.serverMotd = props["motd"] ?? DEFAULT_MOTD;
    }
    ctx.setState(patch);
}

export async function updatePanelConfig(
    ctx: Server,
    patch: Record<string, unknown>,
): Promise<void> {
    await updateSettings(patch);
    await loadConfigAndProperties(ctx);
}
