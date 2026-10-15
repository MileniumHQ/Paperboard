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
import { ChildHost } from "./childHost";
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

/**
 * Local AI hangs as above; agents run for real, as child processes. A plain
 * object, like the daemon's processApi (the app spreads it).
 */
function agentRunHost() {
    const ollama = new HangingHost();
    const agents = new ChildHost();
    const isAgent = (id: string) => id.includes(".agent.");
    return {
        agents,
        start: (options: { id: string; command: string; args: string[]; cwd: string; env: Record<string, string> }) =>
            isAgent(options.id) ? agents.start(options) : ollama.start(),
        kill: (id: string, signal?: string) => (isAgent(id) ? agents.kill(id, signal) : ollama.kill()),
        exists: (id: string) => (isAgent(id) ? agents.exists(id) : ollama.exists()),
        onData: (id: string, cb: (data: string) => void) => (isAgent(id) ? agents.onStdout(id, cb) : ollama.onData()),
        onExit: (id: string, cb: (code?: number) => void) => (isAgent(id) ? agents.onExit(id, cb) : ollama.onExit(id, cb)),
        write: (id: string, data: string) => agents.write(id, data),
        onStdout: (id: string, cb: (data: string) => void) => agents.onStdout(id, cb),
        onStderr: (id: string, cb: (data: string) => void) => agents.onStderr(id, cb),
    };
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

    it("asks for a chat's model capabilities on the chat's own connection", async () => {
        await withApp(async (app) => {
            const a = await app.addConnection({ kind: "openai-compatible", baseUrl: "http://127.0.0.1:1" });
            const conversation = await app.newConversation("shared", a.id);
            const asked: unknown[][] = [];
            app.models.capabilities = (...args: Parameters<typeof app.models.capabilities>) => {
                asked.push(args);
                return undefined;
            };
            await expect(app.chat.send(conversation.id, "hi")).rejects.toThrow(/not available/);
            // the same name on another connection may differ (vision, tools)
            expect(asked).toEqual([["shared", a.id]]);
        });
    });

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
            await expect(app.unloadModel("local:7b")).rejects.toThrow("Only Local AI's models can be unloaded");
        });
    });

    it("reports a down Ollama as stopped, not as nothing loaded", async () => {
        packageInstalled = false;
        try {
            await withApp({ version: 2, connections: [{ id: "ollama", kind: "ollama", label: "Ollama" }] }, async (app, ctx) => {
                // an older version saved the runtime's own name; the panel shows its own
                expect(ctx.state.connections[0]!.label).toBe("Local AI");
                const report = await app.loadedModels();
                expect(report.status).toBe("stopped");
                await expect(app.unloadModel("qwen3:8b")).rejects.toThrow("Local AI is not running");
            });
        } finally {
            packageInstalled = true;
        }
    });
});

describe("coding agent connections", () => {
    // the registry's Claude adapter is installed too, but Claude Code itself is
    // the built-in; Gemini CLI is installed but retired
    const installed = new Set(["claude", "claude-agent-acp", "qwen", "codex-acp", "gemini"]);
    // every installed agent is the fake ACP agent, offering two models
    const FAKE_AGENT = path.join(import.meta.dir, "fixtures", "fakeAcpAgent.mjs");
    const findAgent = async (command: string) =>
        installed.has(command) ? { command: process.execPath, args: [FAKE_AGENT, "--models", "config"], pathEnv: process.env.PATH ?? "" } : null;
    let host: ReturnType<typeof agentRunHost>;

    async function withApp(run: (app: InstanceType<typeof AiApp>, ctx: ReturnType<typeof makeCtx>) => Promise<void>, config: Record<string, unknown> = { connections: [] }) {
        savedConfig = config;
        host = agentRunHost();
        const app = new AiApp(host as any, { readyTimeoutMs: 100, findAgent });
        const ctx = makeCtx();
        await app.init(ctx as any);
        try {
            await run(app, ctx);
        } finally {
            await app.shutdown();
            await host.agents.stopAll();
            savedConfig = null;
        }
    }

    it("lists the agents found on this computer, most used first, with Claude Code bridged in place of the adapter", async () => {
        await withApp(async (app) => {
            expect(await app.installedAgents()).toEqual(["codex-acp", "claude-code", "qwen-code"]);
        });
    });

    it("refuses to add a retired agent, but keeps one added before", async () => {
        await withApp(
            async (app) => {
                await expect(app.addConnection({ kind: "agent", agent: "gemini" })).rejects.toThrow("Gemini CLI was retired by its maker");
                await app.checkAgent("agent-0000aa01");
            },
            { version: 2, connections: [{ id: "agent-0000aa01", kind: "agent", label: "Gemini CLI", agent: "gemini" }] },
        );
    });

    it("adds an installed agent once, listed by the models it offers, which are saved and listed without starting it", async () => {
        let saved: Record<string, unknown> = {};
        await withApp(async (app, ctx) => {
            const added = await app.addConnection({ kind: "agent", agent: "qwen-code" });
            expect(added).toMatchObject({ kind: "agent", agent: "qwen-code", label: "Qwen Code" });
            expect(ctx.state.models.filter((m) => m.provider === added.id)).toEqual([
                expect.objectContaining({ name: "big", label: "Big Model", description: "Thinks hard", capabilities: ["agent"] }),
                expect.objectContaining({ name: "small", label: "Small Model", capabilities: ["agent"] }),
                expect.objectContaining({ name: "auto", label: "Auto", capabilities: ["agent"] }),
            ]);
            await expect(app.addConnection({ kind: "agent", agent: "qwen-code" })).rejects.toThrow("Qwen Code is already added.");
            const deadline = Date.now() + 3000;
            while (!(savedConfig as { agentModels?: object }).agentModels && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
            expect((savedConfig as { agentModels: Record<string, unknown> }).agentModels[added.id]).toEqual([
                { id: "big", name: "Big Model", description: "Thinks hard" },
                { id: "small", name: "Small Model" },
                { id: "auto", name: "Auto" },
            ]);
            saved = JSON.parse(JSON.stringify(savedConfig));
        });
        await withApp(async (_app, ctx) => {
            // init lists in the background
            const deadline = Date.now() + 3000;
            while (ctx.state.models.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
            expect(ctx.state.models.map((m) => m.label)).toEqual(["Big Model", "Small Model", "Auto"]);
            expect(host.agents.starts).toHaveLength(0);
        }, saved);
    });

    it("explains how to install an agent that isn't on this computer", async () => {
        await withApp(async (app, ctx) => {
            const added = await app.addConnection({ kind: "agent", agent: "cline" });
            expect(ctx.state.modelErrors[added.id]).toBe("Cline isn't installed on this computer. Install it with: npm install -g cline");
        });
    });

    it("saves a custom agent's argv and refuses a relative command", async () => {
        await withApp(async (app) => {
            await expect(app.addConnection({ kind: "agent", agent: "custom", command: "./agent" })).rejects.toThrow("must be a command name or an absolute path");
            const added = await app.addConnection({ kind: "agent", agent: "custom", command: "/opt/my agent/run", args: ["--acp"] });
            expect(added).toMatchObject({ label: "run", command: "/opt/my agent/run", args: ["--acp"] });
        });
    });

    it("works in projects inside its own files, remembers the last, and starts the next agent chat there", async () => {
        try {
            await withApp(async (app, ctx) => {
                const agent = await app.addConnection({ kind: "agent", agent: "qwen-code" });
                const c = await app.newConversation("Qwen Code", agent.id);
                expect(c.project).toBeUndefined();
                await expect(app.createProject("../escape")).rejects.toThrow("Use letters, numbers");
                await expect(app.setConversationProject(c.id, "missing")).rejects.toThrow('The project "missing" no longer exists.');
                expect(await app.createProject(" My App ")).toBe("My App");
                expect(fs.statSync(path.join(filesDir, "agent", "My App")).isDirectory()).toBe(true);
                expect(ctx.state.projects).toEqual(["My App"]);
                await expect(app.createProject("My App")).rejects.toThrow("already exists");
                // a symlink in the projects folder is not a project
                fs.symlinkSync(os.tmpdir(), path.join(filesDir, "agent", "link"));
                await expect(app.setConversationProject(c.id, "link")).rejects.toThrow("is not a project folder");
                expect(await app.setConversationProject(c.id, "My App")).toBe("My App");
                expect((savedConfig as { lastProject: string }).lastProject).toBe("My App");
                expect((await app.newConversation("Qwen Code", agent.id)).project).toBe("My App");
            });
        } finally {
            fs.rmSync(path.join(filesDir, "agent"), { recursive: true, force: true });
        }
    });

    it("a Local AI chat may work in a project and leave it, and takes only Local AI's modes", async () => {
        try {
            await withApp(async (app) => {
                const agent = await app.addConnection({ kind: "agent", agent: "qwen-code" });
                const local = await app.newConversation("qwen3:8b");
                // a Local AI chat starts as a plain chat
                expect(local.project).toBeUndefined();
                await app.createProject("site");
                expect(await app.setConversationProject(local.id, "site")).toBe("site");
                expect((await app.getConversation(local.id)).conversation.project).toBe("site");
                expect(await app.setConversationProject(local.id, null)).toBeNull();
                expect((await app.getConversation(local.id)).conversation.project).toBeUndefined();

                await app.setAgentMode(local.id, "accept-edits");
                expect((await app.getConversation(local.id)).conversation.mode).toBe("accept-edits");
                await expect(app.setAgentMode(local.id, "bypassPermissions")).rejects.toThrow("Local AI does not offer that mode.");
                expect((await app.getConversation(local.id)).conversation.mode).toBe("accept-edits");

                // an agent can't leave its project
                const agentChat = await app.newConversation("Qwen Code", agent.id);
                await app.setConversationProject(agentChat.id, "site");
                await expect(app.setConversationProject(agentChat.id, null)).rejects.toThrow("Qwen Code needs a project to work in.");
                expect((await app.getConversation(agentChat.id)).conversation.project).toBe("site");
            });
        } finally {
            fs.rmSync(path.join(filesDir, "agent"), { recursive: true, force: true });
        }
    });
});

// Ask AI for flows: memory keys carry a conversation between calls, on disk.
describe("Ask AI memory", () => {
    const enc = new TextEncoder();
    const bodies: { messages: { role: string; content: string }[] }[] = [];
    let fail = false;
    const endpoint = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "local:7b" }] });
            if (url.pathname === "/v1/chat/completions") {
                if (fail) return new Response("model crashed", { status: 500 });
                bodies.push(await req.json());
                const answer = `answer ${bodies.length}`;
                return new Response(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`,
                    { headers: { "Content-Type": "text/event-stream" } },
                );
            }
            return new Response("not found", { status: 404 });
        },
    });
    afterAll(() => endpoint.stop(true));
    const memoryFile = () => path.join(filesDir, "ask-memory.json");

    async function withApp(run: (app: InstanceType<typeof AiApp>) => Promise<void>) {
        savedConfig = {
            version: 2,
            settings: { defaultModel: "local:7b", defaultProvider: "api-0000000b" },
            connections: [{ id: "api-0000000b", kind: "openai-compatible", label: "Local", baseUrl: `http://127.0.0.1:${endpoint.port}` }],
        };
        const app = new AiApp(new HangingHost(), { readyTimeoutMs: 100 });
        const ctx = makeCtx();
        await app.init(ctx as any);
        try {
            const start = Date.now();
            while (ctx.state.models.length === 0) {
                if (Date.now() - start > 3000) throw new Error("the endpoint's models never listed");
                await new Promise((r) => setTimeout(r, 10));
            }
            await run(app);
        } finally {
            savedConfig = null;
            await app.stopRuntime().catch((err) => console.debug("[ai] test teardown:", String(err)));
        }
    }
    const turns = (i: number) => bodies[i]!.messages.filter((m) => m.role !== "system").map((m) => m.content);

    it("continues a conversation per key, across a restart, until it is forgotten", async () => {
        bodies.length = 0;
        fs.rmSync(memoryFile(), { force: true });
        try {
            await withApp(async (app) => {
                expect(await app.ask("hi", undefined, undefined, undefined, "room-1")).toBe("answer 1");
                await app.ask("and you?", undefined, undefined, undefined, "room-1");
                expect(turns(1)).toEqual(["hi", "answer 1", "and you?"]);
                await app.ask("other", undefined, undefined, undefined, "room-2");
                expect(turns(2)).toEqual(["other"]);
                await app.ask("no memory");
                expect(turns(3)).toEqual(["no memory"]);
            });
            await withApp(async (app) => {
                await app.ask("still there?", undefined, undefined, undefined, "room-1");
                expect(turns(4)).toEqual(["hi", "answer 1", "and you?", "answer 2", "still there?"]);
                expect(await app.forgetMemory("room-1")).toBe(true);
                expect(await app.forgetMemory("room-1")).toBe(false);
                await app.ask("fresh", undefined, undefined, undefined, "room-1");
                expect(turns(5)).toEqual(["fresh"]);
            });
        } finally {
            fs.rmSync(memoryFile(), { force: true });
        }
    });

    it("puts the caller's instructions in the system prompt", async () => {
        bodies.length = 0;
        await withApp(async (app) => {
            await app.ask("hi", undefined, "You are Mochi.");
            expect(bodies[0]!.messages[0]!.role).toBe("system");
            expect(bodies[0]!.messages[0]!.content.endsWith("You are Mochi.")).toBe(true);
        });
    });

    it("remembers nothing from a failed ask", async () => {
        bodies.length = 0;
        fs.rmSync(memoryFile(), { force: true });
        try {
            await withApp(async (app) => {
                fail = true;
                await expect(app.ask("lost", undefined, undefined, undefined, "room-3")).rejects.toThrow("model crashed");
                fail = false;
                await app.ask("next", undefined, undefined, undefined, "room-3");
                expect(turns(0)).toEqual(["next"]);
            });
        } finally {
            fail = false;
            fs.rmSync(memoryFile(), { force: true });
        }
    });

    it("refuses memory, without overwriting it, when the memory file is unreadable", async () => {
        bodies.length = 0;
        fs.writeFileSync(memoryFile(), "{not json");
        try {
            await withApp(async (app) => {
                await expect(app.ask("hi", undefined, undefined, undefined, "room-4")).rejects.toThrow("memory file could not be read");
                await expect(app.forgetMemory("room-4")).rejects.toThrow("memory file could not be read");
                // asking without memory still works
                expect(await app.ask("hi")).toBe("answer 1");
            });
            expect(fs.readFileSync(memoryFile(), "utf8")).toBe("{not json");
        } finally {
            fs.rmSync(memoryFile(), { force: true });
        }
    });

    it("lists the models a flow can ask", async () => {
        await withApp(async (app) => {
            expect(await app.flowModels()).toEqual(["local:7b"]);
        });
    });
});
