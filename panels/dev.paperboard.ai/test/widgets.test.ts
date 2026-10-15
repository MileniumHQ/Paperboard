// Home widgets: reading and unloading the models Ollama holds in memory
// (over real HTTP against the scripted Ollama), and the states the widgets
// show from the mirrored service state.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { startFakeOllama, type FakeOllama } from "./fakeOllama";
import { OllamaClient } from "../src/service/ollamaClient";
import { listLoaded, MAX_LOADED_MODELS, unloadAndConfirm } from "../src/service/loaded";
import { featuredLoaded, loadedDetail, QUICK_ASK_DEFAULT_MODEL, quickAskBlocker, quickAskModel, quickAskModelChoices } from "../src/core/widgets";
import { initialState, type AiState, type InstalledModel } from "../src/core/types";

const GB = 1024 ** 3;

describe("loaded models", () => {
    let fake: FakeOllama;
    let client: OllamaClient;
    beforeEach(() => {
        fake = startFakeOllama();
        client = new OllamaClient(fake.url);
    });
    afterEach(() => fake.stop());

    it("reads what Ollama holds in memory, GPU share capped at the total", async () => {
        fake.loaded = [
            { name: "tooly:latest", size: 5 * GB, size_vram: 4 * GB },
            { name: "odd:latest", size: 1 * GB, size_vram: 9 * GB },
        ];
        expect(await listLoaded(client)).toEqual([
            { name: "tooly:latest", sizeBytes: 5 * GB, vramBytes: 4 * GB, expiresAt: "2026-10-12T17:00:00Z" },
            { name: "odd:latest", sizeBytes: 1 * GB, vramBytes: 1 * GB, expiresAt: "2026-10-12T17:00:00Z" },
        ]);
    });

    it("reports nothing loaded as an empty list, and bounds a long one", async () => {
        expect(await listLoaded(client)).toEqual([]);
        fake.loaded = Array.from({ length: MAX_LOADED_MODELS + 5 }, (_, i) => ({ name: `m${i}`, size: 1, size_vram: 0 }));
        expect(await listLoaded(client)).toHaveLength(MAX_LOADED_MODELS);
    });

    it("unloads a model and resolves once Ollama no longer lists it", async () => {
        fake.loaded = [{ name: "tooly:latest", size: 5 * GB, size_vram: 5 * GB }];
        expect(await unloadAndConfirm(client, "tooly:latest")).toEqual([]);
        expect(fake.unloads).toEqual(["tooly:latest"]);
    });

    it("refuses a model that is not loaded, without asking Ollama to unload it", async () => {
        await expect(unloadAndConfirm(client, "tooly:latest")).rejects.toThrow("tooly:latest is not loaded.");
        expect(fake.unloads).toEqual([]);
    });

    it("fails when Ollama accepts the unload but keeps the model in memory", async () => {
        fake.loaded = [{ name: "tooly:latest", size: 5 * GB, size_vram: 5 * GB }];
        fake.ignoreUnload = true;
        await expect(unloadAndConfirm(client, "tooly:latest", 300)).rejects.toThrow("still in memory");
    });

    it("passes Ollama's own unload error through", async () => {
        fake.loaded = [{ name: "ghost:latest", size: 1, size_vram: 1 }];
        await expect(unloadAndConfirm(client, "ghost:latest")).rejects.toThrow("not found");
    });
});

const model = (name: string): InstalledModel => ({ name, provider: "ollama", sizeBytes: 1, capabilities: ["completion"] });

function ready(patch: Partial<AiState> = {}): AiState {
    const s = initialState();
    return {
        ...s,
        connections: [{ id: "ollama", kind: "ollama", label: "Ollama" }],
        runtime: { status: "ready", compute: [] },
        models: [model("qwen3:8b")],
        ...patch,
    };
}

describe("Quick ask's Model option", () => {
    it("offers the default first, then each downloaded model, and asks the one chosen", () => {
        const s = ready();
        expect(quickAskModelChoices(s)[0]).toEqual({ value: QUICK_ASK_DEFAULT_MODEL, label: "Default model" });
        expect(quickAskModelChoices(s).slice(1).map((c) => c.value)).toEqual(s.models.map((m) => m.name));
        expect(quickAskModel(s, QUICK_ASK_DEFAULT_MODEL)).toBe(quickAskModel(s));
        expect(quickAskModel(s, "other:1b")).toBe("other:1b");
        expect(quickAskBlocker(s, "gone:1b")).toEqual({ text: "gone:1b is not downloaded", recovery: "open" });
    });

    it("leaves coding agents out, since a widget can't pick their folder", () => {
        const s = ready({ models: [model("qwen3:8b"), { name: "Codex", provider: "agent-0123abcd", sizeBytes: 0, capabilities: ["agent"] }] });
        expect(quickAskModelChoices(s).slice(1).map((c) => c.value)).toEqual(["qwen3:8b"]);
    });
});

describe("Quick ask readiness", () => {
    it("can ask once set up, running and with a model", () => {
        expect(quickAskBlocker(ready())).toBeNull();
        // with no default, the first model, as a new chat in the panel
        expect(quickAskModel(ready())).toBe("qwen3:8b");
    });

    it("sends unconfigured setup and missing models to the panel", () => {
        expect(quickAskBlocker({ ...ready(), connections: [] })).toEqual({ text: "Set up AI to ask from here", recovery: "open" });
        expect(quickAskBlocker(ready({ models: [] }))).toEqual({ text: "Download a model in AI first", recovery: "open" });
        const s = ready();
        expect(quickAskBlocker({ ...s, settings: { ...s.settings, defaultModel: "gone:1b" } })).toEqual({ text: "gone:1b is not downloaded", recovery: "open" });
    });

    it("offers to start a stopped or failed Ollama, and waits while it starts", () => {
        expect(quickAskBlocker(ready({ runtime: { status: "stopped", compute: [] } }))?.recovery).toBe("start");
        expect(quickAskBlocker(ready({ runtime: { status: "error", error: "GPU crashed", compute: [] } }))).toEqual({ text: "Local AI stopped", detail: "GPU crashed", failed: true, recovery: "start" });
        expect(quickAskBlocker(ready({ runtime: { status: "starting", compute: [] } }))).toEqual({ text: "Local AI is starting…", recovery: null });
    });

    it("does not wait on Ollama for an endpoint's model, even with Ollama added", () => {
        const endpoint = { id: "api-0000000a", kind: "openai-compatible" as const, label: "Local", baseUrl: "http://127.0.0.1:1" };
        const s = ready({ runtime: { status: "stopped", compute: [] }, models: [{ ...model("local:7b"), provider: endpoint.id }] });
        expect(quickAskBlocker({ ...s, connections: [endpoint] })).toBeNull();
        expect(quickAskBlocker({ ...s, connections: [...s.connections, endpoint] })).toBeNull();
    });
});

describe("Loaded model view", () => {
    it("features the largest model and counts the rest", () => {
        const small = { name: "a", sizeBytes: 1 * GB, vramBytes: 0 };
        const big = { name: "b", sizeBytes: 6 * GB, vramBytes: 6 * GB };
        expect(featuredLoaded([small, big])).toEqual({ model: big, others: 1 });
        expect(featuredLoaded([])).toBeNull();
    });

    it("says where the memory is", () => {
        expect(loadedDetail({ name: "a", sizeBytes: 5 * GB, vramBytes: 5 * GB })).toBe("5.0 GB on GPU");
        expect(loadedDetail({ name: "a", sizeBytes: 5 * GB, vramBytes: 2 * GB })).toBe("5.0 GB, 40% GPU");
        expect(loadedDetail({ name: "a", sizeBytes: 5 * GB, vramBytes: 0 })).toBe("5.0 GB on CPU");
    });
});
