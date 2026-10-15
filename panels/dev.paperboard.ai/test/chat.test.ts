// The reply loop against a scripted Ollama over real HTTP, with a real
// conversation store on disk. Actions are recorded, never really run.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeOllama, type FakeOllama } from "./fakeOllama";
import { OllamaClient } from "../src/service/ollamaClient";
import { ConversationStore } from "../src/service/store";
import { askOnce, ChatEngine, MAX_ACTIVE_REPLIES } from "../src/service/chat";
import { MAX_TOOL_ROUNDS, systemPrompt } from "../src/core/conversation";
import type { AssistantMessage, ChatMessageEvent, ChatResetEvent, PendingApproval, Settings } from "../src/core/types";
import { DEFAULT_SETTINGS } from "../src/core/types";
import type { RegistryAction } from "../src/core/tools";

const registry: RegistryAction[] = [
    {
        panelId: "dev.paperboard.gameserver",
        action: "kick-player",
        schema: { name: "Kick Player", inputs: { player: { type: "string", label: "Player", required: true } } },
    },
    { panelId: "dev.paperboard.gameserver", action: "start-server", schema: { name: "Start Server" } },
];

let fake: FakeOllama;
let dir: string;
let store: ConversationStore;
let calls: { panelId: string; action: string; args: Record<string, unknown> }[];
let allowed: Set<string>;
let approvals: PendingApproval[];
let deltas: { seq: number; content: string }[];
let events: ChatMessageEvent[];
let resets: ChatResetEvent[];
let finished: { text: string }[];
let capabilities: Record<string, string[]>;
let actionResult: () => Promise<unknown>;
let settings: Settings;
let commands: string[];
let shellCwds: (string | undefined)[];

function engine(): ChatEngine {
    return new ChatEngine({
        ownPanelId: "dev.paperboard.ai",
        clientFor: () => new OllamaClient(fake.url),
        providerOf: () => "ollama",
        store,
        settings: () => settings,
        capabilities: (m) => capabilities[m],
        listActions: async () => registry,
        panelNames: async () => ({ "dev.paperboard.gameserver": "Game Server" }),
        callAction: async (panelId, action, args) => {
            calls.push({ panelId, action, args });
            return actionResult();
        },
        isAllowed: (key) => allowed.has(key),
        rememberAllowed: async (key) => {
            allowed.add(key);
        },
        // projects live under the test's own temp dir
        projectPath: async (project) => {
            const p = path.join(dir, "projects", project);
            if (!fs.existsSync(p)) throw new Error(`The project "${project}" no longer exists.`);
            return p;
        },
        runShell: async (command, _signal, cwd) => {
            commands.push(command);
            shellCwds.push(cwd);
            return { stdout: "hello", stderr: "", exitCode: 0 };
        },
        onDelta: (p) => deltas.push(p),
        onMessage: (p) => events.push(p),
        onReset: (p) => resets.push(p),
        onSummaries: () => {},
        onGenerating: () => {},
        onApprovals: (list) => (approvals = list),
        onSpeed: () => {},
        onReplyFinished: (p) => finished.push(p),
        agentConnection: () => undefined,
        agents: {
            openSession: async () => {
                throw new Error("no agents in these tests");
            },
            prompt: async () => {
                throw new Error("no agents in these tests");
            },
            forget: () => {},
        },
    });
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error("timed out waiting");
        await new Promise((r) => setTimeout(r, 5));
    }
}

beforeEach(async () => {
    fake = startFakeOllama();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-chat-"));
    store = new ConversationStore(dir);
    await store.load();
    calls = [];
    allowed = new Set();
    approvals = [];
    deltas = [];
    events = [];
    resets = [];
    finished = [];
    capabilities = { "tooly:latest": ["completion", "tools"], "plain:latest": ["completion"] };
    actionResult = async () => ({ kicked: true });
    // panel actions on and built-ins off, unless a test says otherwise
    settings = { defaultModel: "tooly:latest", contextLength: 4096, reasoning: "off", panelActions: true, shellCommands: false, forceCpu: false, promptStyle: "quirky", customPromptEnabled: false, customSystemPrompt: null };
    commands = [];
    shellCwds = [];
});

afterEach(async () => {
    await fake.stop();
    fs.rmSync(dir, { recursive: true, force: true });
});

const assistants = async (id: string) => (await store.get(id)).messages.filter((m): m is AssistantMessage => m.role === "assistant");

describe("replies", () => {
    it("sends the exact custom prompt over HTTP and restores personality when disabled", async () => {
        const chat = engine();
        const c = await chat.create("tooly:latest");
        settings.customPromptEnabled = true;
        settings.customSystemPrompt = "Reply like a pirate.\nOnly one sentence.";
        fake.script = [{ content: "Aye." }];
        await (await chat.send(c.id, "hi")).done;
        expect(fake.chatRequests[0].messages[0]).toEqual({ role: "system", content: settings.customSystemPrompt });
        settings.customPromptEnabled = false;
        await (await chat.send(c.id, "hello again")).done;
        expect(fake.chatRequests[1].messages[0]).toEqual({ role: "system", content: systemPrompt({
            style: "quirky", model: "tooly:latest", shellCommands: false, panelActions: true,
        }) });
        expect(settings.customSystemPrompt).toBe("Reply like a pirate.\nOnly one sentence.");
    });

    it("streams a plain answer, saves it, and fires reply-finished", async () => {
        fake.script = [{ content: "Hello there, friend." }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        const { done } = await chat.send(c.id, "hi");
        await done;
        const [reply] = await assistants(c.id);
        expect(reply).toMatchObject({ content: "Hello there, friend.", status: "done" });
        expect(reply!.stats?.tokensPerSecond).toBe(20);
        expect(deltas.at(-1)!.content).toBe("Hello there, friend.");
        expect(finished[0]!.text).toBe("Hello there, friend.");
        expect((await store.get(c.id)).title).toBe("hi");
        // the tool-capable model was offered the other panels' actions
        expect(fake.chatRequests[0].tools.map((t: any) => t.function.name)).toEqual(["gameserver__kick-player", "gameserver__start-server"]);
    });

    it("drops reasoning the model emits while the Think toggle is off", async () => {
        // deepseek-r1-style templates reason even for think:false; the user
        // asked not to see it, so it must not reach the message or history
        capabilities = { "tooly:latest": ["completion", "tools", "thinking"] };
        fake.script = [{ thinking: "secret reasoning", content: "visible answer" }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "hi", { reasoning: "off" })).done;
        const [reply] = await assistants(c.id);
        expect(reply).toMatchObject({ content: "visible answer", status: "done" });
        expect(reply!.thinking).toBeUndefined();
        expect(fake.chatRequests[0].think).toBe(false);
    });

    it("forces CPU inference only while the Force CPU setting is on", async () => {
        fake.script = [{ content: "gpu answer" }, { content: "cpu answer" }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "gpu first")).done;
        expect(fake.chatRequests[0].options).toMatchObject({ num_ctx: 4096 });
        expect(fake.chatRequests[0].options.num_gpu).toBeUndefined();
        settings.forceCpu = true;
        await (await chat.send(c.id, "cpu now")).done;
        expect(fake.chatRequests[1].options).toMatchObject({ num_ctx: 4096, num_gpu: 0 });
    });

    it("one-shot asks honor Force CPU", async () => {
        fake.script = [{ content: "answer" }];
        const text = await askOnce(
            new OllamaClient(fake.url),
            { model: "plain:latest", prompt: "hi", contextLength: 4096, forceCpu: true },
            3000,
        );
        expect(text).toBe("answer");
        expect(fake.chatRequests[0].options).toMatchObject({ num_ctx: 4096, num_gpu: 0 });
    });

    it("keeps reasoning when the Think toggle is on", async () => {
        capabilities = { "tooly:latest": ["completion", "tools", "thinking"] };
        fake.script = [{ thinking: "shown reasoning", content: "visible answer" }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "hi", { reasoning: "high" })).done;
        const [reply] = await assistants(c.id);
        expect(reply!.thinking).toBe("shown reasoning");
    });

    it("a model without tool support is sent no tools", async () => {
        fake.script = [{ content: "ok" }];
        const chat = engine();
        const c = await chat.create("plain:latest");
        await (await chat.send(c.id, "hi")).done;
        expect(fake.chatRequests[0].tools).toBeUndefined();
    });

    it("an Ollama error ends the reply as an error, not as success", async () => {
        fake.script = [{ error: "model requires more system memory (12 GiB) than is available (8 GiB)" }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "hi")).done;
        const [reply] = await assistants(c.id);
        expect(reply!.status).toBe("error");
        expect(reply!.error).toContain("more system memory");
        expect(finished).toHaveLength(0);
    });

    it("refuses models that are not installed and a second reply in one chat", async () => {
        const chat = engine();
        const missing = await chat.create("ghost:latest");
        await expect(chat.send(missing.id, "hi")).rejects.toThrow(/not available/);
        fake.script = [{ content: "slow reply here", chunkDelayMs: 30 }];
        const c = await chat.create("tooly:latest");
        const first = await chat.send(c.id, "one");
        await expect(chat.send(c.id, "two")).rejects.toThrow(/still replying/);
        await first.done;
    });

    it(`caps concurrent replies at ${MAX_ACTIVE_REPLIES}`, async () => {
        // hold the replies open so the cap is exercised regardless of timing:
        // with a fixed chunk delay a slow runner could finish one before the
        // extra send runs and free the slot
        fake.holdChats = true;
        fake.script = Array.from({ length: MAX_ACTIVE_REPLIES }, () => ({ content: "slow reply here" }));
        const chat = engine();
        const running = [];
        for (let i = 0; i < MAX_ACTIVE_REPLIES; i++) running.push(await chat.send((await chat.create("tooly:latest")).id, "go"));
        const extra = await chat.create("tooly:latest");
        await expect(chat.send(extra.id, "go")).rejects.toThrow(/at once/);
        fake.releaseChats();
        await Promise.all(running.map((r) => r.done));
    });
});

describe("a reply in flight", () => {
    it("is in the snapshot a reopened or reloaded chat loads, still streaming", async () => {
        fake.script = [{ content: "a long answer that streams slowly", chunkDelayMs: 25 }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        const { done } = await chat.send(c.id, "hi");
        await until(() => deltas.some((d) => d.content.length > 0));
        const { seq, conversation } = await chat.get(c.id);
        const reply = conversation.messages[1] as AssistantMessage;
        // the file has only the user's message until the round ends
        expect(reply.status).toBe("streaming");
        expect(reply.content.length).toBeGreaterThan(0);
        expect("a long answer that streams slowly".startsWith(reply.content)).toBe(true);
        // every later event is ordered after the snapshot
        await done;
        expect(deltas.at(-1)!.seq).toBeGreaterThan(seq);
        expect(events.at(-1)!.seq).toBeGreaterThan(seq);
        // the snapshot is a copy: the reply kept streaming into its own
        expect((await chat.get(c.id)).conversation.messages[1]).toMatchObject({ status: "done", content: "a long answer that streams slowly" });
        expect(reply.status).toBe("streaming");
    });

    it("keeps a rename made while it streams", async () => {
        fake.script = [{ content: "streaming along", chunkDelayMs: 25 }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        const { done } = await chat.send(c.id, "hi");
        await until(() => deltas.length > 0);
        await chat.rename(c.id, "Renamed mid-reply");
        await done;
        expect((await store.get(c.id)).title).toBe("Renamed mid-reply");
    });
});

describe("tool calls ask first", () => {
    it("waits for approval, then runs the action once with checked arguments", async () => {
        fake.script = [
            { toolCalls: [{ name: "gameserver__kick-player", arguments: { player: "Steve", ignored: 1 } }] },
            { content: "Kicked Steve." },
        ];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        const { done } = await chat.send(c.id, "kick steve");
        await until(() => approvals.length === 1);
        expect(approvals[0]).toMatchObject({ panelId: "dev.paperboard.gameserver", action: "kick-player", label: "Kick Player", arguments: { player: "Steve" } });
        expect(calls).toHaveLength(0); // nothing ran before the answer

        chat.resolveApproval(approvals[0]!.id, "once");
        await done;
        expect(calls).toEqual([{ panelId: "dev.paperboard.gameserver", action: "kick-player", args: { player: "Steve" } }]);
        expect(allowed.size).toBe(0);

        // the result went back to the model as a tool message
        const second = fake.chatRequests[1].messages;
        expect(second.at(-2).tool_calls[0].function.name).toBe("gameserver__kick-player");
        expect(second.at(-1)).toMatchObject({ role: "tool", tool_name: "gameserver__kick-player", content: '{\n  "kicked": true\n}' });
        const [round1, round2] = await assistants(c.id);
        expect(round1!.toolCalls![0]).toMatchObject({ status: "done", decision: "once" });
        expect(round2!.content).toBe("Kicked Steve.");
    });

    it("deny: the action never runs and the model is told why", async () => {
        fake.script = [{ toolCalls: [{ name: "gameserver__start-server", arguments: {} }] }, { content: "Okay, I won't." }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        const { done } = await chat.send(c.id, "start it");
        await until(() => approvals.length === 1);
        chat.resolveApproval(approvals[0]!.id, "deny");
        await done;
        expect(calls).toHaveLength(0);
        expect(fake.chatRequests[1].messages.at(-1).content).toMatch(/denied/);
        expect((await assistants(c.id))[0]!.toolCalls![0]!.status).toBe("denied");
    });

    it("always: remembered per panel and action, later calls skip the prompt", async () => {
        fake.script = [
            { toolCalls: [{ name: "gameserver__start-server", arguments: {} }] },
            { content: "Started." },
            { toolCalls: [{ name: "gameserver__start-server", arguments: {} }] },
            { content: "Started again." },
        ];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        const first = await chat.send(c.id, "start");
        await until(() => approvals.length === 1);
        chat.resolveApproval(approvals[0]!.id, "always");
        await first.done;
        expect(allowed.has("dev.paperboard.gameserver:start-server")).toBe(true);

        const second = await chat.send(c.id, "again");
        await second.done;
        expect(calls).toHaveLength(2);
        const rounds = await assistants(c.id);
        expect(rounds[2]!.toolCalls![0]!.decision).toBe("remembered");
    });

    it("a failing action is reported to the model as an error", async () => {
        actionResult = async () => {
            throw new Error("Server is already running");
        };
        allowed.add("dev.paperboard.gameserver:start-server");
        fake.script = [{ toolCalls: [{ name: "gameserver__start-server", arguments: {} }] }, { content: "It was already up." }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "start")).done;
        expect(fake.chatRequests[1].messages.at(-1).content).toBe("Error: Server is already running");
        expect((await assistants(c.id))[0]!.toolCalls![0]!.status).toBe("error");
    });

    it("unknown tools and bad arguments never reach an approval", async () => {
        fake.script = [
            {
                toolCalls: [
                    { name: "nope__nothing", arguments: {} },
                    { name: "gameserver__kick-player", arguments: {} },
                ],
            },
            { content: "Sorry." },
        ];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "do things")).done;
        expect(approvals).toHaveLength(0);
        expect(calls).toHaveLength(0);
        const results = fake.chatRequests[1].messages.filter((m: any) => m.role === "tool").map((m: any) => m.content);
        expect(results[0]).toMatch(/no tool named/);
        expect(results[1]).toMatch(/missing required argument "player"/);
    });

    it("stop while waiting: the call is cancelled, nothing runs, the reply is stopped", async () => {
        fake.script = [{ toolCalls: [{ name: "gameserver__start-server", arguments: {} }] }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        const { done } = await chat.send(c.id, "start");
        await until(() => approvals.length === 1);
        chat.stop(c.id);
        await done;
        expect(approvals).toHaveLength(0);
        expect(calls).toHaveLength(0);
        const [reply] = await assistants(c.id);
        expect(reply!.status).toBe("stopped");
        expect(reply!.toolCalls![0]!.status).toBe("error");
        expect(() => chat.resolveApproval("gone", "once")).toThrow(/no longer waiting/);
    });

    it(`a model that keeps calling tools is stopped after ${MAX_TOOL_ROUNDS} rounds`, async () => {
        allowed.add("dev.paperboard.gameserver:start-server");
        fake.script = Array.from({ length: MAX_TOOL_ROUNDS + 2 }, () => ({ toolCalls: [{ name: "gameserver__start-server", arguments: {} }] }));
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "loop")).done;
        expect(calls).toHaveLength(MAX_TOOL_ROUNDS);
        const last = (await assistants(c.id)).at(-1)!;
        expect(last.status).toBe("error");
        expect(last.error).toMatch(/Stopped after/);
    });
});

describe("attachments", () => {
    const image = {
        id: "i",
        name: "shot.png",
        kind: "image" as const,
        mime: "image/png",
        sizeBytes: 4,
        dataUrl: "data:image/png;base64,AAAA",
    };

    it("refuses an image for a model that cannot see", async () => {
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await expect(chat.send(c.id, "look", { attachments: [image] })).rejects.toThrow(/cannot see images/);
    });

    it("sends an image to a vision model and stores it on the message", async () => {
        capabilities = { "tooly:latest": ["completion", "vision"] };
        fake.script = [{ content: "A tiny PNG." }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "look", { attachments: [image] })).done;
        expect(fake.chatRequests[0].messages.at(-1).images).toEqual(["AAAA"]);
        const saved = await store.get(c.id);
        expect(saved.messages[0]).toMatchObject({ role: "user", attachments: [image] });
    });
});

describe("built-in tools", () => {
    const toolNames = (i: number) => (fake.chatRequests[i].tools ?? []).map((t: any) => t.function.name);

    it("offers built-ins first, and panel actions only when that setting is on", async () => {
        settings = { ...settings, shellCommands: true, panelActions: false };
        fake.script = [{ content: "hi" }, { content: "hi again" }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "hi")).done;
        expect(toolNames(0)).toEqual(["run_shell_command"]);
        expect(fake.chatRequests[0].messages[0].content).toContain("run_shell_command");

        settings = { ...settings, shellCommands: false, panelActions: true };
        await (await chat.send(c.id, "again")).done;
        expect(toolNames(1)).toEqual(["gameserver__kick-player", "gameserver__start-server"]);
        expect(fake.chatRequests[1].messages[0].content).not.toContain("run_shell_command");
    });

    it("web search is gone: never offered, and a model calling it gets an unknown tool", async () => {
        // the defaults used to switch search on
        settings = { ...DEFAULT_SETTINGS, defaultModel: "tooly:latest", panelActions: true };
        fake.script = [{ toolCalls: [{ name: "web_search", arguments: { query: "x" } }] }, { content: "ok" }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "search")).done;
        expect(toolNames(0)).not.toContain("web_search");
        expect(fake.chatRequests[0].messages[0].content).not.toContain("web_search");
        expect((await assistants(c.id))[0]!.toolCalls![0]).toMatchObject({ status: "error", result: 'Error: there is no tool named "web_search".' });
    });

    it("a shell command asks every time and can never be allowed always", async () => {
        settings = { ...settings, shellCommands: true };
        fake.script = [
            { toolCalls: [{ name: "run_shell_command", arguments: { command: "echo hello" } }] },
            { toolCalls: [{ name: "run_shell_command", arguments: { command: "echo hello" } }] },
            { content: "Said hello twice." },
        ];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        const { done } = await chat.send(c.id, "say hello");
        await until(() => approvals.length === 1);
        expect(approvals[0]).toMatchObject({ builtin: "run_shell_command", arguments: { command: "echo hello" } });
        expect(commands).toHaveLength(0);
        expect(() => chat.resolveApproval(approvals[0]!.id, "always")).toThrow(/asks every time/);
        chat.resolveApproval(approvals[0]!.id, "once");

        // the same command again still asks
        await until(() => approvals.length === 1 && commands.length === 1);
        chat.resolveApproval(approvals[0]!.id, "once");
        await done;
        expect(commands).toEqual(["echo hello", "echo hello"]);
        expect(allowed.size).toBe(0);
        expect(fake.chatRequests[1].messages.at(-1).content).toContain("Exit code: 0");
    });
});

describe("stats and rewind", () => {
    it("records the prompt tokens and the context window a round ran with", async () => {
        fake.script = [{ content: "hi" }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "hi")).done;
        expect((await assistants(c.id))[0]!.stats).toMatchObject({ tokens: 40, promptTokens: 120, contextLength: 4096 });
    });

    it("erases a user message and everything after it", async () => {
        fake.script = [{ content: "one" }, { content: "two" }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "first")).done;
        await (await chat.send(c.id, "second")).done;
        const second = (await store.get(c.id)).messages[2]!;
        expect(second).toMatchObject({ role: "user", content: "second" });

        const after = await chat.rewind(c.id, second.id);
        expect(after.messages.map((m) => m.content)).toEqual(["first", "one"]);
        expect((await store.get(c.id)).messages).toHaveLength(2);
        // windows that have this chat open are told to reload it
        expect(resets.map((r) => r.conversationId)).toEqual([c.id]);
    });

    it("stops a reply in flight before rewinding, so it cannot save over the rewind", async () => {
        settings = { ...settings, shellCommands: true, panelActions: false };
        fake.script = [{ toolCalls: [{ name: "run_shell_command", arguments: { command: "echo hi" } }] }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        const { done } = await chat.send(c.id, "run it");
        await until(() => approvals.length === 1);
        const first = (await store.get(c.id)).messages[0]!;
        await chat.rewind(c.id, first.id);
        await done;
        expect(commands).toHaveLength(0);
        expect((await store.get(c.id)).messages).toHaveLength(0);
    });

    it("refuses to rewind to a reply or an unknown message", async () => {
        fake.script = [{ content: "one" }];
        const chat = engine();
        const c = await chat.create("tooly:latest");
        await (await chat.send(c.id, "first")).done;
        const reply = (await store.get(c.id)).messages[1]!;
        await expect(chat.rewind(c.id, reply.id)).rejects.toThrow(/not in this chat/);
        await expect(chat.rewind(c.id, "nope")).rejects.toThrow(/not in this chat/);
    });
});

describe("Local AI in a project", () => {
    const toolNames = (i: number) => (fake.chatRequests[i].tools ?? []).map((t: any) => t.function.name);
    let project: string;
    const inProject = (rel: string) => path.join(project, rel);

    beforeEach(() => {
        project = path.join(dir, "projects", "app");
        fs.mkdirSync(project, { recursive: true });
        settings = { ...settings, shellCommands: true, panelActions: false };
    });

    it("offers file tools only in a project, and runs commands in the project folder", async () => {
        fake.script = [{ content: "plain" }, { toolCalls: [{ name: "run_shell_command", arguments: { command: "ls" } }] }, { content: "listed" }];
        const chat = engine();
        const plain = await chat.create("tooly:latest");
        await (await chat.send(plain.id, "hi")).done;
        expect(toolNames(0)).toEqual(["run_shell_command"]);

        const c = await chat.create("tooly:latest", undefined, "app");
        const { done } = await chat.send(c.id, "list it");
        await until(() => approvals.length === 1);
        expect(toolNames(1)).toEqual(["read_file", "list_directory", "search_files", "write_file", "edit_file", "run_shell_command"]);
        expect(fake.chatRequests[1].messages[0].content).toContain("project folder");
        chat.resolveApproval(approvals[0]!.id, "once");
        await done;
        expect(shellCwds).toEqual([fs.realpathSync(project)]);
    });

    it("a model without tools in a project chat is a plain chat", async () => {
        fake.script = [{ content: "ok" }];
        const chat = engine();
        const c = await chat.create("plain:latest", undefined, "app");
        await (await chat.send(c.id, "hi")).done;
        expect(fake.chatRequests[0].tools).toBeUndefined();
    });

    it("refuses to send when the chat's project is gone", async () => {
        const chat = engine();
        const c = await chat.create("tooly:latest", undefined, "missing");
        await expect(chat.send(c.id, "hi")).rejects.toThrow('The project "missing" no longer exists.');
        expect((await store.get(c.id)).messages).toHaveLength(0);
    });

    it("reads without asking, and a path outside the project goes back to the model as an error", async () => {
        fs.writeFileSync(inProject("notes.txt"), "remember the milk");
        fs.writeFileSync(path.join(dir, "secret.txt"), "top secret");
        fake.script = [
            {
                toolCalls: [
                    { name: "read_file", arguments: { path: "notes.txt" } },
                    { name: "read_file", arguments: { path: "../../secret.txt" } },
                    { name: "write_file", arguments: { path: "../../secret.txt", content: "pwned" } },
                ],
            },
            { content: "done" },
        ];
        const chat = engine();
        const c = await chat.create("tooly:latest", undefined, "app");
        // nothing is approved here: a call that asked would hang the reply
        await (await chat.send(c.id, "read")).done;
        const [round] = await assistants(c.id);
        expect(round!.toolCalls!.map((t) => t.status)).toEqual(["done", "error", "error"]);
        expect(round!.toolCalls![0]!.result).toContain("remember the milk");
        expect(round!.toolCalls![1]!.result).toContain("outside the project");
        expect(round!.toolCalls![2]!.result).toContain("outside the project");
        expect(fs.readFileSync(path.join(dir, "secret.txt"), "utf8")).toBe("top secret");
    });

    it("Ask: a file change waits for approval with its diff, and can't be allowed always", async () => {
        fs.writeFileSync(inProject("a.txt"), "hello world");
        fake.script = [{ toolCalls: [{ name: "edit_file", arguments: { path: "a.txt", old_text: "world", new_text: "there" } }] }, { content: "edited" }];
        const chat = engine();
        const c = await chat.create("tooly:latest", undefined, "app");
        const { done } = await chat.send(c.id, "edit");
        await until(() => approvals.length === 1);
        expect(approvals[0]).toMatchObject({ builtin: "edit_file", arguments: { path: "a.txt", old_text: "world", new_text: "there" } });
        const waiting = (await chat.get(c.id)).conversation.messages.at(-1) as AssistantMessage;
        expect(waiting.toolCalls![0]!.agent).toEqual({ kind: "edit", locations: ["a.txt"], diffs: [{ path: "a.txt", oldText: "hello world", newText: "hello there" }] });
        expect(fs.readFileSync(inProject("a.txt"), "utf8")).toBe("hello world");
        expect(() => chat.resolveApproval(approvals[0]!.id, "always")).toThrow(/asks every time/);
        chat.resolveApproval(approvals[0]!.id, "once");
        await done;
        expect(fs.readFileSync(inProject("a.txt"), "utf8")).toBe("hello there");
        expect(fake.chatRequests[1].messages.at(-1).content).toBe("Edited a.txt: replaced 1 occurrence.");
    });

    it("Ask: a denied write writes nothing", async () => {
        fake.script = [{ toolCalls: [{ name: "write_file", arguments: { path: "new.txt", content: "x" } }] }, { content: "ok" }];
        const chat = engine();
        const c = await chat.create("tooly:latest", undefined, "app");
        const { done } = await chat.send(c.id, "write");
        await until(() => approvals.length === 1);
        chat.resolveApproval(approvals[0]!.id, "deny");
        await done;
        expect(fs.existsSync(inProject("new.txt"))).toBe(false);
    });

    it("Accept edits: file changes apply without asking; commands still ask", async () => {
        fake.script = [
            {
                toolCalls: [
                    { name: "write_file", arguments: { path: "src/new.txt", content: "one two" } },
                    { name: "edit_file", arguments: { path: "src/new.txt", old_text: "two", new_text: "three" } },
                    { name: "run_shell_command", arguments: { command: "cat src/new.txt" } },
                ],
            },
            { content: "done" },
        ];
        const chat = engine();
        const c = await chat.create("tooly:latest", undefined, "app");
        await chat.setMode(c.id, "accept-edits");
        const { done } = await chat.send(c.id, "go");
        await until(() => approvals.length === 1);
        expect(approvals[0]).toMatchObject({ builtin: "run_shell_command" });
        expect(fs.readFileSync(inProject("src/new.txt"), "utf8")).toBe("one three");
        expect(commands).toHaveLength(0);
        chat.resolveApproval(approvals[0]!.id, "once");
        await done;
        expect(commands).toEqual(["cat src/new.txt"]);
        const [round] = await assistants(c.id);
        expect(round!.toolCalls!.map((t) => [t.status, t.decision])).toEqual([["done", undefined], ["done", undefined], ["done", "once"]]);
    });

    it("a mode switched mid-reply applies from the next call, and the reply's save keeps it", async () => {
        fake.script = [
            { toolCalls: [{ name: "write_file", arguments: { path: "a.txt", content: "a" } }] },
            { toolCalls: [{ name: "write_file", arguments: { path: "b.txt", content: "b" } }] },
            { content: "done" },
        ];
        const chat = engine();
        const c = await chat.create("tooly:latest", undefined, "app");
        const { done } = await chat.send(c.id, "go");
        await until(() => approvals.length === 1);
        await chat.setMode(c.id, "accept-edits");
        chat.resolveApproval(approvals[0]!.id, "once");
        // the second write did not ask: the reply finishes without another approval
        await done;
        expect(fs.readFileSync(inProject("b.txt"), "utf8")).toBe("b");
        expect((await store.get(c.id)).mode).toBe("accept-edits");
    });
});
