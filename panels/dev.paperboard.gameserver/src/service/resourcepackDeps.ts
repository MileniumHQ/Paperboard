import type { Server } from "./server";
import { files as fileApi, readSettings } from "./api";
import { parseProperties, stringifyServerProperties } from "../core/properties";
import { apiFetch } from "../lib/userAgent";
import { fetchJson } from "../software/http";
import { updatePanelConfig } from "../games/minecraft/config";
import { PANEL_ID, type GameServerState } from "./types";
import type { ResourcePackDeps } from "./resourcepack";

/** The daemon-backed dependencies of the resource pack service. */
export function liveResourcePackDeps(ctx: Server): ResourcePackDeps {
    // a missing file is empty; a failed read throws, so nothing treats an
    // unreadable file as empty and writes over it
    const readProperties = async () => {
        const content = await fileApi.read("server.properties", PANEL_ID);
        return content ? parseProperties(content) : {};
    };
    return {
        fetchJson,
        fetchPack: (url) => apiFetch(url),
        readProperties,
        writeProperties: async (values) => {
            const current = await readProperties();
            await fileApi.write("server.properties", stringifyServerProperties({ ...current, ...values }), PANEL_ID);
        },
        readConfig: readSettings,
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
    };
}
