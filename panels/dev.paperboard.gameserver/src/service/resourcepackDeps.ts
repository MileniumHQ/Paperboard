import { config, files as fileApi, type ServiceContext } from "@mileniumhq/paperapi";
import { parseProperties, stringifyServerProperties } from "../core/properties";
import { apiFetch } from "../lib/userAgent";
import { fetchJson } from "../software/http";
import { updatePanelConfig } from "./config";
import { PANEL_ID, type GameServerState } from "./types";
import type { ResourcePackDeps } from "./resourcepack";

/** The daemon-backed dependencies of the resource pack service. */
export function liveResourcePackDeps(ctx: ServiceContext<GameServerState>): ResourcePackDeps {
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
        readConfig: async () => {
            const saved = await config.get<Record<string, unknown>>(PANEL_ID);
            return saved && typeof saved === "object" ? saved : {};
        },
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
    };
}
