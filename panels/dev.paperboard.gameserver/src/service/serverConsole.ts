import { processApi } from "@mileniumhq/paperapi";
import { SERVER_PROC_ID } from "./types";

/**
 * A console line nobody waits for (status polls, the stop request whose
 * force-kill timer is the recovery, optimistic gamerule edits). The write
 * can fail, so the failure is logged here instead of surfacing as an
 * unhandled rejection; callers that need delivery await processApi.write.
 */
export function writeServerLineBestEffort(line: string): void {
    const failed = (err: unknown) => console.error("[Service:Console] write to the server console failed:", err);
    try {
        Promise.resolve(processApi.write(SERVER_PROC_ID, line)).catch(failed);
    } catch (err) {
        failed(err);
    }
}
