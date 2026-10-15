// Regression: the service reports ready without waiting for Ollama to boot.
//
// The daemon gives a panel service 20 s to send `paperboard:service-ready`
// (papercrane/panelServices.ts) and abandons it after five failed restarts.
// `AiApp.init` used to await `startIfInstalled()`, so a slow or crashed
// Ollama (the Windows GTX 1650 report: a model load took the GPU down) kept
// onInit pending past that deadline and the panel never came back while the
// rest of the app was fine. init must resolve after history/settings, with
// the runtime still starting.
import { describe, it, expect, mock, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProcessHost } from "../src/service/runtime";
import type { AiState } from "../src/core/types";
import { QUICK_ASK_DEFAULT_MODEL } from "../src/core/widgets";

const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-ai-app-"));
const secrets = new Map<string, string>();
let savedConfig: unknown = null;

// mutable so the install test can control the package check and the download
let packageInstalled = true;
let downloadImpl: () => Promise<void> = async () => {};

mock.module("@mileniumhq/paperapi", () => ({
    config: { get: async () => savedConfig, set: async (value: unknown, _panelId: string) => { savedConfig = structuredClone(value); return true; } },
    secretsApi: {
        get: async (name: string) => ({ found: secrets.has(name), value: secrets.get(name) }),
        set: async (name: string, value: string) => {
            secrets.set(name, value);
        },
        delete: async (name: string) => {
            secrets.delete(name);
        },
        list: async () => [...secrets.keys()],
    },
    fileApi: { getPath: async () => filesDir },
    packageApi: {
        isInstalled: async () => packageInstalled,
        getPath: async () => "/fake/ollama",
        download: () => downloadImpl(),
    },
    panelsApi: { list: async () => [] },
    actionsApi: {
        list: async () => [],
        call: async () => undefined,
        emit: async () => {},
        emitTrigger: async () => {},
        register: async () => {},
        registerMultiple: async () => {},
    },
    systemApi: { getGpus: async () => ({ gpus: [], errors: [] }) },
    processApi: {},
    defineAction: (definition: unknown) => definition,
}));

const { AiApp } = await import("../src/service/app");
const { initialState } = await import("../src/core/types");
const { MAX_ACTIVE_REPLIES } = await import("../src/service/chat");

afterAll(() => {
    fs.rmSync(filesDir, { recursive: true, force: true });
});

// Ollama never reports its address and never exits on its own; a kill is
// observed through the exit event, so teardown stays fast.
class HangingHost implements ProcessHost {
    private exit?: (code?: number) => void;
    async start() {
        return { success: true };
    }
    async kill() {
        this.exit?.(1);
    }
    async exists() {
        return false;
    }
    onData() {
        return () => {};
    }
    onExit(_id: string, cb: (code?: number) => void) {
        this.exit = cb;
        return () => {};
    }
}

function makeCtx() {
    let state: AiState = initialState();
    return {
        get state() {
            return state;
        },
        setState(patch: Partial<AiState> | ((prev: AiState) => Partial<AiState>)) {
            state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
        },
        emit() {},
        emitTrigger() {},
    };
}

describe("custom prompt settings", () => {
    it("seeds the generated prompt, persists edits through reload, and bounds input", async () => {
        savedConfig = null;
        const app = new AiApp(new HangingHost(), { readyTimeoutMs: 100 });
        const ctx = makeCtx();
        await app.init(ctx as any);
        try {
            await Promise.all([app.updateSettings({ customPromptEnabled: true }), app.updateSettings({ promptStyle: "quirky" })]);
            expect(ctx.state.settings.promptStyle).toBe("quirky");
            expect(ctx.state.settings.customSystemPrompt).toContain("helpful expert friend");
            await app.updateSettings({ customSystemPrompt: "Custom instructions" });
            await app.updateSettings({ customPromptEnabled: false });
            await app.updateSettings({ customPromptEnabled: true });
            expect(ctx.state.settings.customSystemPrompt).toBe("Custom instructions");
            await expect(app.updateSettings({ customSystemPrompt: "x".repeat(32769) })).rejects.toThrow("at most");
            expect(ctx.state.settings.customSystemPrompt).toBe("Custom instructions");
            const reloaded = new AiApp(new HangingHost(), { readyTimeoutMs: 100 });
            const reloadedCtx = makeCtx();
            try {
                await reloaded.init(reloadedCtx as any);
                expect(reloadedCtx.state.settings.customSystemPrompt).toBe("Custom instructions");
                expect(reloadedCtx.state.settings.customPromptEnabled).toBe(true);
                // an empty editor is saved, but re-enabling the toggle with an
                // empty box repopulates it from the generated prompt
                await reloaded.updateSettings({ customSystemPrompt: "" });
                expect(reloadedCtx.state.settings.customSystemPrompt).toBe("");
                await reloaded.updateSettings({ customPromptEnabled: false });
                await reloaded.updateSettings({ customPromptEnabled: true });
                expect(reloadedCtx.state.settings.customSystemPrompt).toContain("running in Paperboard");
            } finally {
                await reloaded.stopRuntime();
            }
        } finally {
            await app.stopRuntime();
            savedConfig = null;
        }
    });
});

describe("AiApp connections", () => {
    async function withApp(run: (app: InstanceType<typeof AiApp>, ctx: ReturnType<typeof makeCtx>) => Promise<void>, stored: unknown = null) {
        savedConfig = stored;
        const app = new AiApp(new HangingHost(), { readyTimeoutMs: 100 });
        const ctx = makeCtx();
        const original = globalThis.fetch;
        // model listing dials the endpoint; these tests are about the key, not it
        globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as any;
        try {
            await app.init(ctx as any);
            await run(app, ctx);
        } finally {
            globalThis.fetch = original;
            savedConfig = null;
            await app.stopRuntime().catch((err) => console.debug("[ai] test teardown:", String(err)));
        }
    }

    it("keeps each endpoint's key under its own vault name, and drops it when the URL changes", async () => {
        secrets.clear();
        await withApp(async (app, ctx) => {
            const a = await app.addConnection({ kind: "openai-compatible", baseUrl: "https://api.example.com/v1", apiKey: "k1" });
            const b = await app.addConnection({ kind: "openai-compatible", baseUrl: "https://other.example.com/v1", apiKey: "k2", label: "Other" });
            expect(secrets.get(`api-key-${a.id}`)).toBe("k1");
            expect(secrets.get(`api-key-${b.id}`)).toBe("k2");
            expect(ctx.state.connections.map((c) => [c.label, c.hasApiKey])).toEqual([["api.example.com", true], ["Other", true]]);
            // a key belongs to the endpoint it was entered for
            await app.updateConnection({ id: a.id, baseUrl: "https://moved.example.com/v1" });
            expect(secrets.has(`api-key-${a.id}`)).toBe(false);
            expect(secrets.get(`api-key-${b.id}`)).toBe("k2");
            await app.removeConnection(b.id);
            expect(secrets.size).toBe(0);
            expect(ctx.state.connections.map((c) => c.id)).toEqual([a.id]);
            expect((savedConfig as any).connections.map((c: any) => c.id)).toEqual([a.id]);
        });
    });

    it("refuses to store a key for a plaintext non-loopback endpoint", async () => {
        secrets.clear();
        await withApp(async (app, ctx) => {
            await expect(app.addConnection({ kind: "openai-compatible", baseUrl: "http://10.0.0.5:1234", apiKey: "k1" })).rejects.toThrow(/plaintext/);
            expect(secrets.size).toBe(0);
            expect(ctx.state.connections).toEqual([]);
        });
    });

    it("tests with a stored key only against the URL it was saved for, never over plaintext", async () => {
        secrets.clear();
        await withApp(async (app) => {
            const a = await app.addConnection({ kind: "openai-compatible", baseUrl: "https://api.example.com/v1", apiKey: "k1" });
            await expect(app.testConnection({ id: a.id, baseUrl: "http://10.0.0.5:1234", apiKey: "k1" })).rejects.toThrow(/plaintext/);
            // without a typed key, a different URL is tested with no key at all
            expect(await app.testConnection({ id: a.id, baseUrl: "http://10.0.0.5:1234" })).toEqual({ models: 0 });
        });
    });

    it("adds Ollama once", async () => {
        await withApp(async (app, ctx) => {
            await app.addConnection({ kind: "ollama" });
            await expect(app.addConnection({ kind: "ollama" })).rejects.toThrow("already added");
            expect(ctx.state.connections.map((c) => c.id)).toEqual(["ollama"]);
        });
    });

    // TODO(remove after v0.3): with migrateSingleProvider
    it("migrates a 0.2 custom endpoint once, moving its key to the connection's own secret", async () => {
        secrets.clear();
        secrets.set("openai-api-key", "legacy");
        const legacy = { settings: { defaultModel: "local:7b" }, provider: { id: "custom", baseUrl: "https://api.example.com/v1" } };
        let id = "";
        await withApp(async (_app, ctx) => {
            expect(ctx.state.connections).toHaveLength(1);
            const [c] = ctx.state.connections;
            id = c!.id;
            expect(c).toMatchObject({ kind: "openai-compatible", baseUrl: "https://api.example.com/v1", hasApiKey: true });
            expect(secrets.get(`api-key-${id}`)).toBe("legacy");
            expect(secrets.has("openai-api-key")).toBe(false);
            expect(savedConfig).toMatchObject({ version: 2, settings: { defaultModel: "local:7b" } });
            expect((savedConfig as any).provider).toBeUndefined();
            // a second start reads the migrated document as it is
            const migrated = structuredClone(savedConfig);
            await withApp(async (_again, again) => {
                expect(again.state.connections.map((x) => x.id)).toEqual([id]);
            }, migrated);
        }, legacy);
    });

    // TODO(remove after v0.3): with migrateSingleProvider
    it("migrates a 0.2 Ollama choice, and an unfinished setup to no providers", async () => {
        await withApp(async (_app, ctx) => {
            expect(ctx.state.connections.map((c) => c.id)).toEqual(["ollama"]);
        }, { provider: { id: "ollama" } });
        await withApp(async (_app, ctx) => {
            expect(ctx.state.connections).toEqual([]);
        }, { settings: { reasoning: "off" } });
    });
});

describe("AiApp readiness", () => {
    it("resolves init while Ollama is still starting, not after its boot timeout", async () => {
        const readyTimeoutMs = 1500;
        const app = new AiApp(new HangingHost(), { readyTimeoutMs });
        const ctx = makeCtx();
        const started = Date.now();
        try {
            await app.init(ctx as any);
            expect(Date.now() - started).toBeLessThan(readyTimeoutMs / 3);
            expect(app.runtime.api).toBeNull();
            expect(ctx.state.runtime.status).not.toBe("ready");
        } finally {
            await app.stopRuntime().catch((err) => console.debug("[ai] test teardown:", String(err)));
        }
    });
});

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error("waitFor timeout");
        await new Promise((r) => setTimeout(r, 5));
    }
}

describe("AiApp installRuntime", () => {
    it("acknowledges before the download finishes and reports through state", async () => {
        packageInstalled = false;
        let downloadStarted = false;
        let finishDownload: (() => void) | null = null;
        downloadImpl = () => {
            downloadStarted = true;
            return new Promise<void>((resolve) => {
                finishDownload = resolve;
            });
        };
        const app = new AiApp(new HangingHost(), { readyTimeoutMs: 150 });
        const ctx = makeCtx();
        try {
            await app.init(ctx as any);
            await waitFor(() => ctx.state.runtime.status === "missing");
            const started = Date.now();
            await app.installRuntime();
            // the action call returns while the download is still in flight
            expect(Date.now() - started).toBeLessThan(200);
            expect(ctx.state.runtime.status).toBe("installing");
            await waitFor(() => downloadStarted);
            finishDownload!();
            // download done, boot attempted; the hanging host times out and
            // the failure surfaces in state, never as a rejected action call
            await waitFor(() => ctx.state.runtime.status === "error");
        } finally {
            packageInstalled = true;
            downloadImpl = async () => {};
            await app.stopRuntime().catch((err) => console.debug("[ai] test teardown:", String(err)));
        }
    });
});

// Quick ask (Home widget): starts a chat the panel then opens, and leaves no
// chat behind when it is refused. Loaded model reports "unsupported" for a
// URL endpoint and "stopped" for a down Ollama, never an empty list.
describe("AiApp widget actions", () => {
    let holdReplies = false;
    const held: (() => void)[] = [];
    const release = () => held.splice(0).forEach((r) => r());
    const enc = new TextEncoder();
    const endpoint = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "local:7b" }, { id: "local:9b" }] });
            if (url.pathname === "/v1/chat/completions") {
                const wait = holdReplies ? new Promise<void>((r) => held.push(r)) : Promise.resolve();
                return new Response(
                    new ReadableStream({
                        async start(controller) {
                            await wait;
                            controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hi." } }] })}\n\n`));
                            controller.enqueue(enc.encode("data: [DONE]\n\n"));
                            controller.close();
                        },
                    }),
                    { headers: { "Content-Type": "text/event-stream" } },
                );
            }
            return new Response("not found", { status: 404 });
        },
    });
    afterAll(() => endpoint.stop(true));

    async function withApp(stored: unknown, run: (app: InstanceType<typeof AiApp>, ctx: ReturnType<typeof makeCtx>) => Promise<void>) {
        savedConfig = stored;
        const app = new AiApp(new HangingHost(), { readyTimeoutMs: 100 });
        const ctx = makeCtx();
        await app.init(ctx as any);
        try {
            await run(app, ctx);
        } finally {
            holdReplies = false;
            release();
            savedConfig = null;
            await app.stopRuntime().catch((err) => console.debug("[ai] test teardown:", String(err)));
            await app.deleteAllConversations();
        }
    }
    const custom = () => ({
        version: 2,
        connections: [{ id: "api-0000000a", kind: "openai-compatible", label: "Local", baseUrl: `http://127.0.0.1:${endpoint.port}` }],
    });
    async function modelsListed(ctx: ReturnType<typeof makeCtx>) {
        const start = Date.now();
        while (ctx.state.models.length === 0) {
            if (Date.now() - start > 3000) throw new Error("the endpoint's models never listed");
            await new Promise((r) => setTimeout(r, 10));
        }
    }

    it("starts a chat with the question and hands it to one panel window", async () => {
        await withApp(custom(), async (app, ctx) => {
            await modelsListed(ctx);
            const { conversationId } = await app.quickAsk("  What is a panel?  ");
            const snapshot = await app.getConversation(conversationId);
            expect(snapshot.conversation.model).toBe("local:7b");
            expect(snapshot.conversation.messages[0]).toMatchObject({ role: "user", content: "What is a panel?" });
            expect(ctx.state.openRequest).toBe(conversationId);
            expect(app.takeOpenRequest()).toBe(conversationId);
            // taken once: a second window (or a reload) does not jump to it
            expect(app.takeOpenRequest()).toBeNull();
            expect(ctx.state.openRequest).toBeNull();
        });
    });

    it("asks the model the widget's Model option names, or the default", async () => {
        await withApp(custom(), async (app, ctx) => {
            await modelsListed(ctx);
            const chosen = await app.quickAsk("hi", "local:9b");
            expect((await app.getConversation(chosen.conversationId)).conversation.model).toBe("local:9b");
            const followed = await app.quickAsk("hi", QUICK_ASK_DEFAULT_MODEL);
            expect((await app.getConversation(followed.conversationId)).conversation.model).toBe("local:7b");
            const before = ctx.state.conversations.length;
            await expect(app.quickAsk("hi", "gone:1b")).rejects.toThrow("gone:1b is not downloaded.");
            expect(ctx.state.conversations).toHaveLength(before);
        });
    });

    it("refuses before creating a chat: blank, unconfigured, nothing downloaded", async () => {
        await withApp(null, async (app, ctx) => {
            await expect(app.quickAsk("   ")).rejects.toThrow("Type a question first.");
            await expect(app.quickAsk("hi")).rejects.toThrow("Set up AI first.");
            expect(ctx.state.conversations).toEqual([]);
            expect(ctx.state.openRequest).toBeNull();
        });
        await withApp({ ...custom(), settings: { defaultModel: "gone:1b" } }, async (app, ctx) => {
            await modelsListed(ctx);
            await expect(app.quickAsk("hi")).rejects.toThrow("gone:1b is not downloaded.");
            expect(ctx.state.conversations).toEqual([]);
        });
    });

    it("removes the chat it created when the message is refused", async () => {
        await withApp(custom(), async (app, ctx) => {
            await modelsListed(ctx);
            holdReplies = true;
            for (let i = 0; i < MAX_ACTIVE_REPLIES; i++) await app.quickAsk(`question ${i}`);
            const before = ctx.state.conversations.map((c) => c.id);
            const pending = ctx.state.openRequest;
            await expect(app.quickAsk("one too many")).rejects.toThrow(`Only ${MAX_ACTIVE_REPLIES} chats can reply at once.`);
            expect(ctx.state.conversations.map((c) => c.id)).toEqual(before);
            expect(ctx.state.openRequest).toBe(pending);
        });
    });

    it("reports memory as unsupported for a URL endpoint and refuses to unload there", async () => {
        await withApp(custom(), async (app) => {
            expect(await app.loadedModels()).toEqual({ status: "unsupported", provider: "Your providers" });
            await expect(app.unloadModel("local:7b")).rejects.toThrow("Only Ollama's models can be unloaded");
        });
    });

    it("reports a down Ollama as stopped, not as nothing loaded", async () => {
        packageInstalled = false;
        try {
            await withApp({ version: 2, connections: [{ id: "ollama", kind: "ollama", label: "Ollama" }] }, async (app) => {
                const report = await app.loadedModels();
                expect(report.status).toBe("stopped");
                await expect(app.unloadModel("qwen3:8b")).rejects.toThrow("Ollama is not running");
            });
        } finally {
            packageInstalled = true;
        }
    });
});
