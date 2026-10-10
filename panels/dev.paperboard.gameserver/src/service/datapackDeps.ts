import { config, files as fileApi, type ServiceContext } from "@mileniumhq/paperapi";
import { updatePanelConfig } from "./config";
import { fetchJson } from "../software/http";
import { resolveLevelName } from "./worlds";
import { trashRemovePathsWith } from "./trash";
import { makeTrashRemoveDeps } from "./trashDeps";
import type { DatapackDeps } from "./datapacks";
import { PANEL_ID, type GameServerState } from "./types";

/** The daemon-backed dependencies of the datapack service. */
export function liveDatapackDeps(ctx: ServiceContext<GameServerState>): DatapackDeps {
    return {
        serverDir: () => fileApi.getPath("", PANEL_ID),
        levelName: resolveLevelName,
        fetchJson,
        download: (opts) => fileApi.download({ ...opts, appId: PANEL_ID }),
        readConfig: async () => {
            const saved = await config.get<Record<string, unknown>>(PANEL_ID);
            return saved && typeof saved === "object" ? saved : {};
        },
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
        trash: (paths) => trashRemovePathsWith(makeTrashRemoveDeps(), paths),
    };
}
