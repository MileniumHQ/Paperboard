import type { Settings } from "./types";

/** A successful RPC alone does not prove that a running service applied new settings. */
export async function saveSettings(
    patch: Partial<Settings>,
    deps: {
        update: (patch: Partial<Settings>) => Promise<Settings>;
        refresh: () => Promise<void>;
    },
): Promise<void> {
    const saved = await deps.update(patch);
    if (
        (patch.customPromptEnabled !== undefined && saved?.customPromptEnabled !== patch.customPromptEnabled) ||
        (patch.customSystemPrompt !== undefined && saved?.customSystemPrompt !== patch.customSystemPrompt)
    ) {
        throw new Error("The AI service did not apply this setting. Restart Paperboard to load the updated service, then try again.");
    }
    try {
        // Refresh through the bridge so its state and the UI mirror agree even
        // when the state-change event has not arrived.
        await deps.refresh();
    } catch (error) {
        throw new Error(`Settings were saved, but could not be refreshed. Try the setting again. ${String(error)}`);
    }
}
