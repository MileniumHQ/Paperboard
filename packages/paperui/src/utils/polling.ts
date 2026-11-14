import { onCleanup } from "solid-js";

export interface CreatePollingOptions {
    /** run once immediately instead of waiting for the first interval */
    immediate?: boolean;
}

/**
 * Bounded polling for components: one interval, cleared on cleanup. A tick
 * whose previous call is still running is skipped, so calls never overlap.
 * A failure is not caught: it reaches PaperProvider's uncaught-error toast,
 * and the next tick still runs. Returns a stop function for callers that
 * want to end it early.
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

    let running = false;
    const tick = () => {
        if (running) return;
        const result = fn();
        if (!result) return;
        running = true;
        // a rejection passes through, unhandled, to the uncaught-error toast
        void result.finally(() => {
            running = false;
        });
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
