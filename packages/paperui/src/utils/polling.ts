import { onCleanup } from "solid-js";

export interface CreatePollingOptions {
    /** run once immediately instead of waiting for the first interval */
    immediate?: boolean;
}

/**
 * Bounded polling for components: one interval, cleared on cleanup, and a
 * callback failure is logged instead of becoming an unhandled rejection.
 * Returns a stop function for callers that want to end it early.
 */
export function createPolling(
    fn: () => void | Promise<void>,
    intervalMs: number,
    options: CreatePollingOptions = {},
): () => void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        throw new Error(
            `createPolling needs a positive interval, got ${String(intervalMs)}`,
        );
    }

    const tick = () => {
        try {
            const result = fn();
            if (result && typeof (result as Promise<void>).then === "function") {
                (result as Promise<void>).catch((err) => {
                    console.error("[paperui] polling callback failed:", err);
                });
            }
        } catch (err) {
            console.error("[paperui] polling callback failed:", err);
        }
    };

    if (options.immediate) tick();
    const timer = setInterval(tick, intervalMs);

    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
    };

    onCleanup(stop);
    return stop;
}
