import { config, files as fileApi, type ServiceContext } from "./api";
import { updatePanelConfig } from "../games/minecraft/config";
import { resolveLevelName } from "./worlds";
import type { UploadDeps } from "./addonUploads";
import { PANEL_ID, type GameServerState } from "./types";

/** The daemon-backed dependencies of the add-on upload service. */
export function liveUploadDeps(ctx: ServiceContext<GameServerState>): UploadDeps {
    return {
        serverDir: () => fileApi.getPath("", PANEL_ID),
        levelName: resolveLevelName,
        readConfig: async () => {
            const saved = await config.get<Record<string, unknown>>(PANEL_ID);
            return saved && typeof saved === "object" ? saved : {};
        },
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
    };
}
