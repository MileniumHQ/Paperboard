import type { Server } from "./server";
import { files as fileApi, readSettings } from "./api";
import { updatePanelConfig } from "../games/minecraft/config";
import { fetchJson } from "../software/http";
import { resolveLevelName } from "./worlds";
import { trashRemovePathsWith } from "./trash";
import { makeTrashRemoveDeps } from "./trashDeps";
import type { DatapackDeps } from "./datapacks";
import { PANEL_ID, type GameServerState } from "./types";

/** The daemon-backed dependencies of the datapack service. */
export function liveDatapackDeps(ctx: Server): DatapackDeps {
    return {
        serverDir: () => fileApi.getPath("", PANEL_ID),
        levelName: resolveLevelName,
        fetchJson,
        download: ({ url, targetPath, sha1, sha512 }) =>
            fileApi.download({ url, targetPath, sha1, checksum: { algorithm: "sha512", value: sha512 }, appId: PANEL_ID }),
        readConfig: readSettings,
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
        trash: (paths) => trashRemovePathsWith(makeTrashRemoveDeps(), paths),
    };
}
