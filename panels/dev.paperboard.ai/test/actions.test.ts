// The AI panel's public action schemas: the model dropdowns and personality
// options flows see, and the persona a one-shot ask runs with.
import { describe, it, expect } from "bun:test";
import { publicActions, uiActions } from "../src/service/actions";
import { UI_ACTION_IDS } from "../src/contract";
import { PROMPT_STYLES } from "../src/core/conversation";
import { askSystemPrompt } from "../src/core/conversation";

function fakeApp(models: string[]) {
    return {
        models: { list: models.map((name) => ({ name, capabilities: name.startsWith("agent:") ? ["agent"] : ["completion"] })) },
        ready: Promise.resolve(),
    } as any;
}

function findAction(app: any, id: string) {
    const found = publicActions(app).find((a) => a.id === id);
    if (!found) throw new Error(`no action ${id}`);
    return found as any;
}

describe("Ask AI schema", () => {
    it("offers the installed models with a default-model entry", () => {
        const ask = findAction(fakeApp(["qwen3:8b", "llama3:2b"]), "ask");
        const model = ask.inputs.model;
        expect(model.options.map((o: any) => o.value)).toEqual(["qwen3:8b", "llama3:2b"]);
        expect(model.allowEmpty).toBe(true);
        expect(model.emptyLabel).toBe("Default model");
    });

    it("leaves coding agents out of the model list", () => {
        const ask = findAction(fakeApp(["qwen3:8b", "agent:Codex"]), "ask");
        expect(ask.inputs.model.options.map((o: any) => o.value)).toEqual(["qwen3:8b"]);
    });

    it("offers every personality, defaulting to standard", () => {
        const ask = findAction(fakeApp([]), "ask");
        const personality = ask.inputs.personality;
        expect(personality.default).toBe("standard");
        expect(personality.options.map((o: any) => o.value)).toEqual([...PROMPT_STYLES]);
        for (const option of personality.options) {
            expect(typeof option.description).toBe("string");
            expect(option.description.length).toBeGreaterThan(0);
        }
    });

    it("keeps the model list live when the schema is rebuilt", () => {
        expect(
            findAction(fakeApp(["a:1"]), "ask").inputs.model.options.map((o: any) => o.value),
        ).toEqual(["a:1"]);
        expect(
            findAction(fakeApp(["a:1", "b:1"]), "ask").inputs.model.options.map((o: any) => o.value),
        ).toEqual(["a:1", "b:1"]);
    });

    it("takes instructions and a memory key, and labels the prompt plainly", () => {
        const ask = findAction(fakeApp([]), "ask");
        expect(ask.inputs.prompt.label).toBe("Prompt");
        // instructions are a short line in the flow editor; only the prompt wraps
        expect(ask.inputs.instructions.type).toBe("string");
        expect(ask.inputs.instructions.multiline).toBeUndefined();
        expect(ask.inputs.prompt.multiline).toBe(true);
        expect(ask.inputs.memory).toMatchObject({ type: "string", label: "Memory key", maxLength: 200 });
    });

    it("passes every input through to the app", async () => {
        const calls: unknown[][] = [];
        const app = { ...fakeApp([]), ask: async (...args: unknown[]) => (calls.push(args), "ok") };
        await findAction(app, "ask").run({}, { prompt: "hi", model: "a:1", personality: "no-nonsense", instructions: "Be brief.", memory: "room-1" });
        expect(calls).toEqual([["hi", "a:1", "Be brief.", "no-nonsense", "room-1"]]);
    });

    it("refuses a personality it doesn't have", async () => {
        const app = { ...fakeApp([]), ask: async () => "ok" };
        await expect(findAction(app, "ask").run({}, { prompt: "hi", personality: "pirate" })).rejects.toThrow('Unknown personality "pirate".');
    });
});

describe("flow model management", () => {
    it("lists models as a list of names and forgets by key", async () => {
        const app = { ...fakeApp([]), flowModels: async () => ["a:1", "b:1"], forgetMemory: async (key: string) => key === "room-1" };
        const list = findAction(app, "list-models");
        expect(list.output.type).toBe("list<string>");
        expect(await list.run({}, {})).toEqual(["a:1", "b:1"]);
        expect(await findAction(app, "forget-memory").run({}, { memory: "room-1" })).toBe(true);
    });

    it("no longer downloads or deletes models from flows", () => {
        const ids = publicActions(fakeApp([])).map((a) => a.id);
        expect(ids).not.toContain("download-model");
        expect(ids).not.toContain("delete-model");
        expect(ids).not.toContain("model-downloaded");
    });
});

describe("AI trigger filters", () => {
    it("filters finished-reply events on the payload's model", () => {
        const trigger = findAction(fakeApp(["qwen3:8b"]), "reply-finished");
        expect(trigger.match).toEqual({ field: "model", input: "model" });
        expect(trigger.inputs.model.allowEmpty).toBe(true);
    });
});

describe("askSystemPrompt", () => {
    it("uses the chosen personality and appends caller instructions", () => {
        const standard = askSystemPrompt("standard", "qwen3:8b");
        expect(standard).toContain("qwen3:8b");
        const terse = askSystemPrompt("no-nonsense", "qwen3:8b");
        expect(terse).not.toBe(standard);
        const withInstructions = askSystemPrompt("standard", "qwen3:8b", "  Answer in one sentence  ");
        expect(withInstructions.endsWith("Answer in one sentence")).toBe(true);
        expect(withInstructions).toContain(standard);
    });
});

describe("delete-all chats UI action", () => {
    it("is registered and calls the app's delete-all", async () => {
        let calls = 0;
        const app = {
            ready: Promise.resolve(),
            deleteAllConversations: async () => {
                calls += 1;
            },
        } as any;
        const action = uiActions(app).find((a) => a.id === UI_ACTION_IDS.deleteAllConversations);
        expect(action).toBeDefined();
        await action!.run!({}, {});
        expect(calls).toBe(1);
    });
});

describe("custom prompt UI action", () => {
    it("forwards the toggle and prompt through the settings action", async () => {
        let patch: unknown;
        const app = { ready: Promise.resolve(), updateSettings: async (value: unknown) => { patch = value; } } as any;
        const action = uiActions(app).find((a) => a.id === UI_ACTION_IDS.updateSettings)!;
        await action.run!({}, { customPromptEnabled: true, customSystemPrompt: "My instructions" });
        expect(patch).toEqual({ customPromptEnabled: true, customSystemPrompt: "My instructions" });
    });
});
