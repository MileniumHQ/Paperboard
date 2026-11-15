import type { Server } from "./server";

import type { TrashRemoveDeps } from "./trash";

// one factory for every destructive path (worlds, world reset, plugins,
// player data): the server folder is resolved from the daemon, the move
// itself happens on this machine's filesystem (see service/trash.ts)
export function makeTrashRemoveDeps(ctx: Server): TrashRemoveDeps {
    return { getServerDir: () => ctx.root() };
}
