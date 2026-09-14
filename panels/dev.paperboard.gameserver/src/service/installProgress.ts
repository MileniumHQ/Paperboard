import type { InstallProgress } from "../core/state";

// Progress relay for the server-jar download inside installServerVersion.
// The UI cannot subscribe mid-action (bridge calls are request/response),
// so the service publishes throttled progress through service state, which
// already syncs to the UI. Pure mapping + throttle live here for tests;
// the action owns the setState calls.
export type { InstallProgress };

// Daemon payloads carry more stages ("starting", "checking") and raw
// floats; only the actionable stages reach UI state, percent normalized.
export function toInstallProgress(payload: {
    stage?: unknown;
    percent?: unknown;
}): InstallProgress | null {
    const raw = payload?.percent;
    const percent =
        typeof raw === "number" && Number.isFinite(raw)
            ? Math.min(100, Math.max(0, Math.round(raw)))
            : 0;
    switch (payload?.stage) {
        case "downloading":
        case "verifying":
        case "completed":
        case "error":
            return { stage: payload.stage, percent };
        default:
            return null;
    }
}

// Stage flips always relay; in-stage percent must move at least a point so
// per-chunk download events don't flood state sync with re-renders.
export function shouldRelayInstallProgress(
    prev: InstallProgress | null,
    next: InstallProgress,
): boolean {
    if (!prev) return true;
    if (next.stage !== prev.stage) return true;
    return next.percent - prev.percent >= 1;
}
