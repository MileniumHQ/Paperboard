import { expect, test, mock } from "bun:test";
let unreadable = true;
let writes = 0;
mock.module("@mileniumhq/paperapi", () => ({
    config: {
        get: async () => { if (unreadable) throw new Error("Config unreadable"); return null; },
        set: async () => { writes++; throw new Error("Config save failed"); },
    },
    files: {},
    system: {},
}));
const { updatePanelConfig } = await import("../src/service/config");
test("setup save preserves unreadable config and propagates persistence failures", async () => {
    await expect(updatePanelConfig({} as any, { configured: true })).rejects.toThrow("Config unreadable");
    expect(writes).toBe(0);
    unreadable = false;
    await expect(updatePanelConfig({} as any, { configured: true })).rejects.toThrow("Config save failed");
    expect(writes).toBe(1);
});
