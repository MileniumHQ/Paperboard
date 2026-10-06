// Makes a model's provider usable before a download. Progress is owned by
// state.runtime, which the model browser renders as "Installing Ollama..."
// or "Starting Ollama..." rows; this only drives the sequence.

import { UI_ACTION_IDS } from "../contract";
import { DEFAULT_PROVIDER_ID, providerFor } from "../core/providers";
import { call, state } from "./state";

const STEP_MS = 300;
// The daemon bounds an install download at 30 minutes (papercrane/storage.ts)
// and a runtime boot at 60 s; this UI wait only needs to outlast both, and
// exists so a stuck state can't spin forever.
const SETUP_WAIT_MS = 31 * 60_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await sleep(STEP_MS);
    }
    return predicate();
}

/**
 * Installs the runtime when its package is missing, starts it when it is not
 * running, and resolves only once the provider is ready. The install/start
 * actions acknowledge immediately — progress and failure travel through
 * state.runtime — so this waits on state rather than on an RPC deadline.
 * A provider that is a plain URL needs nothing.
 */
export async function ensureProviderReady(providerId: string = DEFAULT_PROVIDER_ID): Promise<void> {
    const provider = providerFor(providerId);
    if (!provider.runtime) return;
    const ready = () => state.runtime.status === "ready";
    const failed = () => state.runtime.status === "error" || state.runtime.status === "missing";
    if (ready()) return;

    // hydration can land before the first package check; installing then
    // would re-download a package that may already be there
    if (state.runtime.status === "checking" || state.runtime.packageInstalled === undefined) {
        await waitFor(() => state.runtime.status !== "checking", 15_000);
    }
    if (ready()) return;

    // trigger setup only when it is not already running; the actions
    // acknowledge immediately, so nothing here blocks on the download/boot
    if (state.runtime.status !== "installing" && state.runtime.status !== "starting") {
        if (state.runtime.packageInstalled === false || state.runtime.status === "missing") {
            await call(UI_ACTION_IDS.installRuntime);
        } else {
            await call(UI_ACTION_IDS.startRuntime);
        }
    }

    const settled = await waitFor(() => ready() || failed(), SETUP_WAIT_MS);
    if (!settled || !ready()) {
        throw new Error(state.runtime.error || `${provider.label} did not become ready.`);
    }
}
