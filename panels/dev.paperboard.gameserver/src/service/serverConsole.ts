import type { Server } from "./server";

import { SERVER_PROC_ID } from "./types";

/**
 * A console line nobody waits for (status polls, the stop request whose
 * force-kill timer is the recovery). The write
 * can fail, so the failure is logged here instead of surfacing as an
 * unhandled rejection; callers that need delivery await ctx.process.write.
 */
export function writeServerLineBestEffort(ctx: Server, line: string): void {
    // quiet: nobody waits for this line; a stop that never arrived is the force-kill timer's to recover
    const failed = (err: unknown) => console.error("[Service:Console] write to the server console failed:", err);
    try {
        Promise.resolve(ctx.process.write(SERVER_PROC_ID, line)).catch(failed);
    } catch (err) {
        failed(err);
    }
}
