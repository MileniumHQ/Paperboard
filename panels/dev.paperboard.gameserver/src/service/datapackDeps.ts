import { minecraftOf } from "../games/minecraft/state";
import type { Server } from "./server";

import { updatePanelConfig } from "../games/minecraft/config";
import { fetchJson } from "../software/http";
import { resolveLevelName } from "./worlds";
import { trashRemovePathsWith } from "./trash";
import { makeTrashRemoveDeps } from "./trashDeps";
import type { DatapackDeps } from "./datapacks";
import { PANEL_ID } from "./types";

/** The daemon-backed dependencies of the datapack service. */
export function liveDatapackDeps(ctx: Server): DatapackDeps {
    return {
        serverDir: () => ctx.root(),
        levelName: () => resolveLevelName(ctx),
        fetchJson,
        download: ({ url, targetPath, sha1, sha512 }) =>
            ctx.files.download({ url, targetPath, sha1, checksum: { algorithm: "sha512", value: sha512 }, appId: PANEL_ID }),
        readConfig: async () => ctx.settings,
        records: minecraftOf(ctx).records,
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
        trash: (paths) => trashRemovePathsWith(makeTrashRemoveDeps(ctx), paths),
    };
}
