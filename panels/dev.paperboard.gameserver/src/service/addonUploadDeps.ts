import { minecraftOf } from "../games/minecraft/state";
import type { Server } from "./server";

import { updatePanelConfig } from "../games/minecraft/config";
import { resolveLevelName } from "./worlds";
import type { UploadDeps } from "./addonUploads";

/** The daemon-backed dependencies of the add-on upload service. */
export function liveUploadDeps(ctx: Server): UploadDeps {
    return {
        serverDir: () => ctx.root(),
        levelName: () => resolveLevelName(ctx),
        readConfig: async () => ctx.settings,
        records: minecraftOf(ctx).records,
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
    };
}
