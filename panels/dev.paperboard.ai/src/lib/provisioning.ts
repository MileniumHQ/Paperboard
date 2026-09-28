// Makes a model's provider usable before a download. Progress is owned by
// state.runtime, which the model browser renders as "Installing Ollama..."
// or "Starting Ollama..." rows; this only drives the sequence.

import { UI_ACTION_IDS } from "../contract";
import { DEFAULT_PROVIDER_ID, providerFor } from "../core/providers";
import { call, state } from "./state";

const STEP_MS = 300;

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
 * running, and resolves only once the provider is ready. A provider that is a
 * plain URL needs nothing.
 */
export async function ensureProviderReady(providerId: string = DEFAULT_PROVIDER_ID): Promise<void> {
    const provider = providerFor(providerId);
    if (!provider.runtime) return;
    const ready = () => state.runtime.status === "ready";
    if (ready()) return;

    // hydration can land before the first package check; installing then
    // would re-download a package that may already be there
    if (state.runtime.status === "checking" || state.runtime.packageInstalled === undefined) {
        await waitFor(() => state.runtime.status !== "checking", 15_000);
    }
    if (state.runtime.packageInstalled === false || state.runtime.status === "missing") {
        await call(UI_ACTION_IDS.installRuntime);
    } else if (!ready()) {
        await call(UI_ACTION_IDS.startRuntime);
    }
    if (!ready()) {
        throw new Error(`${provider.label} did not become ready.`);
    }
}
