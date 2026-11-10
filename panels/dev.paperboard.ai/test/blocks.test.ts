// The AI panel's blocks (Actions API v2): what it registers, and that each
// block runs the same function its action does. The real app runs them in
// app.test.ts.
import { describe, expect, it } from "bun:test";
import { aiBlocks } from "../src/service/blocks";
import { PROMPT_STYLES } from "../src/core/conversation";
import { TestBlocks } from "./blocksRig";

function fakeApp(over: Record<string, unknown> = {}) {
    return {
        ready: Promise.resolve(),
        askModelChoices: () => [{ label: "qwen3:8b", value: "ollama|qwen3:8b", description: "Local AI" }],
        blockModels: () => ["ollama|qwen3:8b", "api-0000000a|gpt-x"],
        blockModel: (value: string) => ({ name: value.split("|")[1], provider: "Local AI" }),
        blockChat: (id: string) => ({ title: `chat ${id}`, model: "ollama|qwen3:8b" }),
        ...over,
    } as any;
}

async function registered(app = fakeApp()) {
    const blocks = new TestBlocks();
    await blocks.register(aiBlocks(app));
    return blocks;
}

describe("the AI panel's blocks", () => {
    it("registers the Model and Chat types, the model lists as values, Ask AI and Forget Memory, and When AI Replies", async () => {
        const { set } = await registered();
        expect(set!.types!.map((t) => [t.id, Object.keys(t.fields ?? {})])).toEqual([
            ["model", ["name", "provider"]],
            ["chat", ["title", "model"]],
        ]);
        expect(set!.values!.map((v) => [v.id, v.type, v.changes])).toEqual([
            ["models", "list<model>", true],
            ["favorite-models", "list<model>", true],
        ]);
        expect(set!.commands!.map((c) => [c.id, c.output])).toEqual([
            ["ask", "text"],
            ["forget-memory", "boolean"],
        ]);
        expect(set!.events!.map((e) => [e.id, e.filters, Object.keys(e.values ?? {})])).toEqual([["reply-finished", { model: "model" }, ["text", "chat", "model"]]]);
        for (const def of [...set!.commands!, ...set!.values!, ...set!.events!]) expect(def.category).toBe("AI");
        expect(set!.commands![0]!.inputs!.personality!.choices!.map((c) => c.value)).toEqual([...PROMPT_STYLES]);
    });

    it("Ask AI passes every input to the app, as the action does, and refuses what its inputs don't allow", async () => {
        const calls: unknown[][] = [];
        const blocks = await registered(fakeApp({ ask: async (...args: unknown[]) => (calls.push(args), "ok") }));
        expect(await blocks.run("ask", { prompt: "hi", model: "ollama|qwen3:8b", personality: "no-nonsense", instructions: "Be brief.", memory: "room-1" })).toBe("ok");
        expect(await blocks.run("ask", { prompt: "plain" })).toBe("ok");
        expect(calls).toEqual([
            ["hi", "ollama|qwen3:8b", "Be brief.", "no-nonsense", "room-1"],
            ["plain", undefined, undefined, undefined, undefined],
        ]);
        await expect(blocks.run("ask", { prompt: "hi", personality: "pirate" })).rejects.toThrow('"Personality" must be one of');
        await expect(blocks.run("ask", {})).rejects.toThrow('"Prompt" is required');
        expect(calls).toHaveLength(2);
    });

    it("Forget Memory gives back whether there was anything to forget", async () => {
        const blocks = await registered(fakeApp({ forgetMemory: async (key: string) => key === "room-1" }));
        expect(await blocks.run("forget-memory", { memory: "room-1" })).toBe(true);
        expect(await blocks.run("forget-memory", { memory: "room-2" })).toBe(false);
    });

    it("the values read the app's model lists, and the types' fields look them up", async () => {
        const blocks = await registered();
        expect(await blocks.read("models")).toEqual(["ollama|qwen3:8b", "api-0000000a|gpt-x"]);
        expect(await blocks.read("favorite-models")).toEqual(["ollama|qwen3:8b"]);
        expect(await blocks.property("model", "name", "api-0000000a|gpt-x")).toBe("gpt-x");
        expect(await blocks.property("chat", "model", "c1")).toBe("ollama|qwen3:8b");
    });

    it("a result that isn't its type fails the block", async () => {
        const blocks = await registered(fakeApp({ blockModels: () => [7] }));
        await expect(blocks.read("models")).rejects.toThrow("Models: item 1: expected text");
    });
});
