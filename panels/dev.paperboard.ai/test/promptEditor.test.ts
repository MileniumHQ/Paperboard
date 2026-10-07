// The custom prompt editor used to seed its text with "" while its
// "last saved" marker was seeded from the stored prompt; the sync effect then
// saw them equal and never filled the textarea, so reopening Settings showed a
// non-empty stored prompt as a blank field. These pin the mount contract.
//
// solid-js resolves to its SSR (non-reactive) build under bun's "node"
// condition, so the browser build is substituted before the module loads.
import { describe, it, expect, mock } from "bun:test";
import * as solidClient from "solid-js/dist/dev.js";

mock.module("solid-js", () => solidClient);

const { createPromptEditor } = await import("../src/core/promptEditor");
type PromptEditor = import("../src/core/promptEditor").PromptEditor;

function mount(
    stored: () => string | null,
    save: (value: string) => Promise<boolean>,
    debounceMs?: number,
): { editor: PromptEditor; dispose: () => void } {
    let editor!: PromptEditor;
    const dispose = solidClient.createRoot((d) => {
        editor = createPromptEditor(() => ({ customSystemPrompt: stored() }), save, debounceMs);
        return d;
    });
    return { editor, dispose };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe("createPromptEditor", () => {
    it("shows the stored prompt on mount instead of a blank field", () => {
        const { editor, dispose } = mount(() => "keep me", async () => true);
        expect(editor.value()).toBe("keep me");
        dispose();
    });

    it("seeds empty for null and empty stored prompts", () => {
        const a = mount(() => null, async () => true);
        const b = mount(() => "", async () => true);
        expect(a.editor.value()).toBe("");
        expect(b.editor.value()).toBe("");
        a.dispose();
        b.dispose();
    });

    it("persists an edit after the debounce", async () => {
        let stored: string | null = "old";
        const saved: string[] = [];
        const { editor, dispose } = mount(
            () => stored,
            async (value) => {
                stored = value;
                saved.push(value);
                return true;
            },
            0,
        );
        editor.update("new text");
        await settle();
        expect(saved).toEqual(["new text"]);
        dispose();
    });

    it("reverts the field when the service refuses the save", async () => {
        const { editor, dispose } = mount(() => "old", async () => false, 0);
        editor.update("unsaved");
        await settle();
        expect(editor.value()).toBe("old");
        dispose();
    });
});
