import type { Server } from "./server";

import type { PortDeps } from "./ports";

/** The daemon-backed dependencies of the server's port claims. */
export function livePortDeps(ctx: Server): PortDeps {
    return {
        serverDir: () => ctx.root(),
        ports: ctx.ports,
    };
}
