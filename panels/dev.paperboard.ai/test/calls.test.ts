// The AI panel's page and widget calls (bridge.call): that every name the UI
// uses is a call the service answers, and what a few of them forward. Ask
// AI's own schema and the personas are in blocks.test.ts.
import { describe, it, expect } from "bun:test";
import { callBlockId } from "@mileniumhq/paperapi";
import { CALLS, WIDGET_CALLS } from "../src/contract";
import { askSystemPrompt } from "../src/core/conversation";
import { uiCalls } from "../src/service/calls";

const ctx = {} as any;

describe("the page's calls", () => {
    const calls = uiCalls({ ready: Promise.resolve() } as any);

    it("answers every call name the page and widgets use, each a valid internal block id", () => {
        const names = [...Object.values(CALLS), ...Object.values(WIDGET_CALLS)];
        expect(Object.keys(calls).sort()).toEqual([...names].sort());
        for (const name of names) expect(callBlockId(name)).toBe(`call-${name}`);
    });

    it("forwards a favorite's provider, model and the heart's state, and nothing else", async () => {
        let input: unknown;
        const app = { ready: Promise.resolve(), setFavorite: async (value: unknown) => { input = value; return []; } } as any;
        await uiCalls(app)[CALLS.setFavorite]!(ctx, { provider: "api-0000000a", model: "gpt-4o", favorite: true, extra: 1 });
        expect(input).toEqual({ provider: "api-0000000a", model: "gpt-4o", favorite: true });
    });

    it("delete-all calls the app's delete-all", async () => {
        let count = 0;
        const app = { ready: Promise.resolve(), deleteAllConversations: async () => { count += 1; } } as any;
        await uiCalls(app)[CALLS.deleteAllConversations]!(ctx);
        expect(count).toBe(1);
    });

    it("settings forward the custom prompt toggle and text", async () => {
        let patch: unknown;
        const app = { ready: Promise.resolve(), updateSettings: async (value: unknown) => { patch = value; } } as any;
        await uiCalls(app)[CALLS.updateSettings]!(ctx, { customPromptEnabled: true, customSystemPrompt: "My instructions" });
        expect(patch).toEqual({ customPromptEnabled: true, customSystemPrompt: "My instructions" });
    });

    it("a call with a missing id fails with its reason", async () => {
        await expect(calls[CALLS.deleteConversation]!(ctx, {})).rejects.toThrow("id is required");
    });
});

describe("askSystemPrompt", () => {
    it("uses the chosen personality and appends caller instructions", () => {
        const standard = askSystemPrompt("standard", "qwen3:8b");
        expect(standard).toContain("qwen3:8b");
        expect(askSystemPrompt("no-nonsense", "qwen3:8b")).not.toBe(standard);
        const withInstructions = askSystemPrompt("standard", "qwen3:8b", "  Answer in one sentence  ");
        expect(withInstructions.endsWith("Answer in one sentence")).toBe(true);
        expect(withInstructions).toContain(standard);
    });
});
