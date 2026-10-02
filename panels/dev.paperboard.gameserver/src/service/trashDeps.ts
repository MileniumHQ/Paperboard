import { files as fileApi } from "@paperboard-dev/paperapi";
import type { TrashRemoveDeps } from "./trash";
import { PANEL_ID } from "./types";

// one factory for every destructive path (worlds, world reset, plugins,
// player data): the server folder is resolved from the daemon, the move
// itself happens on this machine's filesystem (see service/trash.ts)
export function makeTrashRemoveDeps(): TrashRemoveDeps {
    return { getServerDir: () => fileApi.getPath("", PANEL_ID) };
}
