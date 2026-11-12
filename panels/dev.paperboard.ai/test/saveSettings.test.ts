import { expect, it } from "bun:test";
import { saveSettings } from "../src/core/saveSettings";
import { DEFAULT_SETTINGS } from "../src/core/types";

it("refreshes settings after saving without relying on an event", async () => {
    let displayed = DEFAULT_SETTINGS;
    const saved = { ...DEFAULT_SETTINGS, customPromptEnabled: true, customSystemPrompt: "Instructions" };
    await saveSettings({ customPromptEnabled: true }, {
        update: async () => saved,
        refresh: async () => { displayed = saved; },
    });
    expect(displayed.customPromptEnabled).toBe(true);
});

it("reports a running service that silently ignores the toggle", async () => {
    await expect(saveSettings({ customPromptEnabled: true }, {
        update: async () => DEFAULT_SETTINGS,
        refresh: async () => { throw new Error("must not refresh an unapplied setting"); },
    })).rejects.toThrow("Restart Paperboard");
});
