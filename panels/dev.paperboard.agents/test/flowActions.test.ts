import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ActionDefinition } from "@mileniumhq/paperapi";
import { ACTION_IDS, DEFAULT_STATE, TRIGGER_IDS, type AiState, type Settings } from "../src/contract";
import { AiApp, type AppHost } from "../src/service/app";
import { ASK_MS, Asker } from "../src/service/ask";
import { TURN_PROC_ID } from "../src/service/conversation";
import type { MessageReceived } from "../src/service/flowActions";
import { FakeProcesses, until } from "./fakeHost";

const PIP: Settings = { name: "Pip", harness: "codex", model: null, compaction: "summarize" };
const codexSays = (text: string) => JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }) + "\n";

let dir = "";
let app: AiApp | null = null;
afterEach(async () => {
    await app?.shutdown();
    app = null;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = "";
});

async function start(settings: Settings | null = PIP) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flows-"));
    const procs = new FakeProcesses();
    const registered: ActionDefinition[] = [];
    const triggers: { id: string; payload: unknown }[] = [];
    let state: AiState = structuredClone(DEFAULT_STATE);
    const host: AppHost = {
        start: procs.start,
        kill: procs.kill,
        exists: procs.exists,
        onExit: procs.onExit,
        onStdout: procs.onStdout,
        onStderr: procs.onStderr,
        exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        packages: {
            isInstalled: async () => false,
            download: async () => {
                throw new Error("no network in tests");
            },
            getPath: async (name) => path.join(dir, "packages", name),
        },
        storageDir: async () => dir,
        readSettings: async () => settings,
        writeSettings: async () => {},
        harnessHomes: { claude: "/nonexistent/claude", codex: path.join(dir, "codex") },
        which: (c) => `/usr/bin/${c}`,
        registerAction: async (def) => void registered.push(def),
        tools: {
            write: procs.write,
            readTools: async () => null,
            writeTools: async () => {},
            vault: { get: async () => null, set: async () => {}, delete: async () => false, list: async () => [] },
            actions: { list: async () => [], call: async () => null },
        },
    };
    app = new AiApp(host);
    await app.init({
        get state() {
            return state;
        },
        setState: (patch) => (state = { ...state, ...patch }),
        emit: () => {},
        trigger: (id, payload) => triggers.push({ id, payload }),
    });
    await app.publish();
    const action = (id: string) => {
        // what flows get is the latest registration
        const def = registered.findLast((d) => d.id === id);
        if (!def) throw new Error(`${id} was never registered`);
        return def;
    };
    const call = (id: string, inputs: unknown) => action(id).run!({}, inputs);
    const dropdown = () => action(ACTION_IDS.switchConversation).inputs!.conversation!.options!.map((o) => o.label);
    return { app, procs, registered, triggers, action, call, dropdown, state: () => state };
}

/** Play one turn of the conversation to its end: the agent texts back. */
async function answer(procs: FakeProcesses, text: string) {
    await until(() => procs.alive.has(TURN_PROC_ID));
    procs.stdout(TURN_PROC_ID, codexSays(text));
    procs.exit(TURN_PROC_ID, 0);
}

describe("the agent's actions in flows", () => {
    test("the library offers the four, with the history as the conversation dropdown and New conversation as its empty entry", async () => {
        const { action } = await start();
        const ids = [ACTION_IDS.switchConversation, ACTION_IDS.sendMessage, ACTION_IDS.getAnswer, TRIGGER_IDS.messageReceived];
        for (const id of ids) expect(action(id).internal).toBeFalsy();
        const pick = action(ACTION_IDS.switchConversation).inputs!.conversation!;
        expect(pick.allowEmpty).toBe(true);
        expect(pick.emptyLabel).toBe("New conversation");
        expect(pick.options).toEqual([]);
        // an event: flows start from it, never call it
        expect(action(TRIGGER_IDS.messageReceived).run).toBeUndefined();
    });

    test("Send Message texts the agent as the user would, and When Agent Replies fires with its text", async () => {
        const { app, procs, call, triggers, state } = await start();
        const id = (await call(ACTION_IDS.sendMessage, { text: "  is it raining in Oslo?  " })) as string;
        expect(typeof id).toBe("string");
        await answer(procs, "Yep, bring an umbrella.");
        await until(() => state().chat.busy === false);
        const [user, agent] = app.conversation.history();
        expect(user).toMatchObject({ id, kind: "user", text: "is it raining in Oslo?" });
        expect(triggers).toEqual([
            {
                id: TRIGGER_IDS.messageReceived,
                payload: { text: "Yep, bring an umbrella.", attachments: [], messageId: agent!.id, conversationId: app.conversation.id(), replyTo: "" } satisfies MessageReceived,
            },
        ]);
        await expect(call(ACTION_IDS.sendMessage, { text: "   " })).rejects.toThrow("say something first");
    });

    test("Switch Conversation follows the history: the dropdown lists it, and a conversation keeps its id when it's reopened and put away again", async () => {
        const { app, procs, call, dropdown, state } = await start();
        await call(ACTION_IDS.sendMessage, { text: "plan a trip to Oslo" });
        await answer(procs, "On it.");
        await until(() => state().chat.busy === false);
        await app.publish();
        expect(dropdown()).toEqual(["plan a trip to Oslo"]);
        const oslo = app.conversation.id();

        // empty: a new conversation; Oslo goes into the history under the id flows already know it by
        const fresh = (await call(ACTION_IDS.switchConversation, { conversation: "" })) as string;
        expect(fresh).not.toBe(oslo);
        expect(app.conversation.past().map((p) => p.id)).toEqual([oslo]);
        await call(ACTION_IDS.sendMessage, { text: "what's 2+2" });
        await answer(procs, "4");
        await until(() => state().chat.busy === false);
        await app.publish();
        expect(dropdown()).toEqual(["what's 2+2", "plan a trip to Oslo"]);

        expect(await call(ACTION_IDS.switchConversation, { conversation: oslo })).toBe(oslo);
        expect(app.conversation.history().map((e) => e.kind === "user" && e.text).filter(Boolean)).toEqual(["plan a trip to Oslo"]);
        // the current one again is no change
        expect(await call(ACTION_IDS.switchConversation, { conversation: oslo })).toBe(oslo);
        // put away again, it's still the id the flow saved
        await call(ACTION_IDS.switchConversation, { conversation: fresh });
        expect(app.conversation.past().map((p) => p.id)).toEqual([oslo]);
        await app.publish();
        expect(dropdown()).toEqual(["what's 2+2", "plan a trip to Oslo"]);

        await expect(call(ACTION_IDS.switchConversation, { conversation: "0123456789ab" })).rejects.toThrow("isn't in the history");
    });

    test("Get Answer runs the brain once on its own: no conversation, no tools server, no saved session, and its last message is the answer", async () => {
        const { app, procs, call } = await start();
        const asked = call(ACTION_IDS.getAnswer, { question: "--version: what's the capital of Norway?" });
        await until(() => procs.started.length === 1);
        const run = procs.started[0]!;
        expect(run.id).not.toBe(TURN_PROC_ID);
        expect(run.command).toBe("/usr/bin/codex");
        expect(run.args).toContain("--ephemeral");
        expect(run.args.join(" ")).not.toContain("mcp_servers");
        // a question that looks like a flag is still the question
        expect(run.args.slice(-2)).toEqual(["--", "--version: what's the capital of Norway?"]);
        procs.stdout(run.id, codexSays("Let me check."));
        procs.stdout(run.id, codexSays("Oslo"));
        procs.exit(run.id, 0);
        expect(await asked).toBe("Oslo");
        expect(app.conversation.history()).toEqual([]);
        expect(app.conversation.past()).toEqual([]);
    });

    test("Get Answer with Claude: web search only, no MCP server and no session kept", async () => {
        const { procs, call } = await start({ ...PIP, harness: "claude-code", model: "claude-sonnet-5-5" });
        const asked = call(ACTION_IDS.getAnswer, { question: "capital of Norway?" });
        await until(() => procs.started.length === 1);
        const run = procs.started[0]!;
        expect(run.args).toEqual(expect.arrayContaining(["--no-session-persistence", "--strict-mcp-config", "--model", "claude-sonnet-5-5"]));
        expect(run.args).not.toContain("--mcp-config");
        expect(run.args[run.args.indexOf("--tools") + 1]).toBe("WebSearch");
        procs.stdout(run.id, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Oslo" }] } }) + "\n");
        procs.stdout(run.id, JSON.stringify({ type: "result", is_error: false, result: "Oslo" }) + "\n");
        procs.exit(run.id, 0);
        expect(await asked).toBe("Oslo");
    });

    test("Get Answer fails out loud: the brain's error, a silent brain, and no setup", async () => {
        const { procs, call } = await start();
        const failed = call(ACTION_IDS.getAnswer, { question: "hi" });
        await until(() => procs.started.length === 1);
        procs.stdout(procs.started[0]!.id, JSON.stringify({ type: "turn.failed", error: { message: "You've hit your usage limit." } }) + "\n");
        procs.exit(procs.started[0]!.id, 1);
        await expect(failed).rejects.toThrow("You've hit your usage limit.");

        const silent = call(ACTION_IDS.getAnswer, { question: "hi" });
        await until(() => procs.started.length === 2);
        procs.exit(procs.started[1]!.id, 0);
        await expect(silent).rejects.toThrow("the agent gave no answer");
        await app!.shutdown();
        app = null;

        const { call: unset } = await start(null);
        await expect(unset(ACTION_IDS.getAnswer, { question: "hi" })).rejects.toThrow("set up the agent");
    });
});

/** The turn's own MCP endpoint, as its harness reaches it. */
function endpoint(turn: { args: string[]; env?: Record<string, string> }) {
    const url = JSON.parse(turn.args.find((a) => a.startsWith("mcp_servers.paperboard.url="))!.split("=").slice(1).join("="));
    return async (method: string, params?: unknown) => {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${turn.env!.PAPERBOARD_COMPUTER_MCP_TOKEN}` },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        return (await res.json()) as { result?: { tools?: { name: string; inputSchema: any }[]; content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
    };
}
const instructionsOf = (turn: { args: string[] }) => JSON.parse(turn.args.find((a) => a.startsWith("developer_instructions="))!.slice("developer_instructions=".length)) as string;

describe("a turn that answers a flow", () => {
    test("can't sign in or show apps, and its files go in a list beside the text, never inside it", async () => {
        const { app, procs, call, triggers, state } = await start();
        await call(ACTION_IDS.sendMessage, { text: "send me today's map" });
        await until(() => procs.started.length === 1);
        const turn = procs.started[0]!;
        const rpc = endpoint(turn);
        const tools = (await rpc("tools/list")).result!.tools!;
        const names = tools.map((t) => t.name);
        expect(names).not.toContain("show_app");
        expect(names).not.toContain("ask_to_sign_in");
        expect(names).toContain("start_app");
        expect(tools.find((t) => t.name === "send_message")!.inputSchema.properties.files).toBeDefined();
        expect((await rpc("tools/call", { name: "show_app", arguments: { app: "planner" } })).error?.message).toContain("unknown tool show_app");
        const told = instructionsOf(turn);
        expect(told).toContain("came from one of the user's Paperboard automations");
        expect(told).toContain("**No sign-ins:**");
        expect(told).toContain("**No showing apps:**");
        expect(told).not.toContain("ask_to_sign_in");
        expect(told).not.toContain("show_app");
        expect(told).not.toContain("](attachment:");

        const map = app.conversation.attachments.add("map.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
        const inline = (await rpc("tools/call", { name: "send_message", arguments: { text: `Here: ![map](attachment:${map.id})` } })).result!;
        expect(inline.isError).toBe(true);
        expect(inline.content![0]!.text).toContain("pass their ids in files");
        const sent = (await rpc("tools/call", { name: "send_message", arguments: { text: "Here's today's map.", files: [map.id] } })).result!;
        expect(sent.isError).toBe(false);
        procs.exit(TURN_PROC_ID, 0);
        await until(() => state().chat.busy === false);

        expect(triggers).toHaveLength(1);
        const reply = triggers[0]!.payload as MessageReceived;
        expect(reply.text).toBe("Here's today's map.");
        expect(reply.attachments).toEqual([{ name: "map.png", kind: "image", type: "image/png", bytes: map.bytes, path: expect.any(String) }]);
        expect(fs.readFileSync(reply.attachments[0]!.path)).toEqual(app.conversation.attachments.bytes(map.id));
        // the chat shows them too
        expect(app.conversation.history().at(-1)).toMatchObject({ kind: "agent", attachments: [{ id: map.id }] });

        // the user's own next message is answered as always
        app.conversation.send("thanks!");
        await until(() => procs.started.length === 2);
        const theirs = (await endpoint(procs.started[1]!)("tools/list")).result!.tools!.map((t) => t.name);
        expect(theirs).toContain("show_app");
        expect(theirs).toContain("ask_to_sign_in");
        expect(instructionsOf(procs.started[1]!)).not.toContain("came from one of the user's Paperboard automations");
    });

    test("a reply with no files has an empty list", async () => {
        const { procs, call, triggers, state } = await start();
        await call(ACTION_IDS.sendMessage, { text: "ping" });
        await answer(procs, "pong");
        await until(() => state().chat.busy === false);
        expect((triggers[0]!.payload as MessageReceived).attachments).toEqual([]);
    });

    test("a flow's message waits for the user's turn instead of cutting it off, and is answered in a turn of its own", async () => {
        const { app, procs, call, state } = await start();
        app.conversation.send("find me a train to Oslo");
        await until(() => procs.started.length === 1);
        await call(ACTION_IDS.sendMessage, { text: "daily summary please" });
        expect(procs.killed).toEqual([]);
        expect(state().chat.waiting.map((m) => m.text)).toEqual(["daily summary please"]);
        await answer(procs, "The 9:15 works.");
        await until(() => procs.started.length === 2);
        expect(instructionsOf(procs.started[1]!)).toContain("came from one of the user's Paperboard automations");
        expect(procs.started[1]!.args.at(-1)).toContain("daily summary please");

        // the user cuts a flow's turn off, as they would any other
        app.conversation.send("wait, make it 10:00");
        await until(() => procs.started.length === 3);
        expect(procs.killed.map((k) => k.id)).toEqual([TURN_PROC_ID]);
        expect(instructionsOf(procs.started[2]!)).not.toContain("came from one of the user's Paperboard automations");
    });
});

describe("the user's instructions for automations", () => {
    test("settings' instructions end a flow's turn and a question, and an action's own replace them; the user's chat never gets them", async () => {
        const { app, procs, call, state } = await start({ ...PIP, automationInstructions: "Answer in French." });
        await call(ACTION_IDS.sendMessage, { text: "weather?" });
        await until(() => procs.started.length === 1);
        expect(instructionsOf(procs.started[0]!)).toEndWith("**The user's instructions:**\nAnswer in French.");
        await answer(procs, "Il pleut.");
        await until(() => state().chat.busy === false);

        await call(ACTION_IDS.sendMessage, { text: "weather?", instructions: "  Answer in Norwegian.  " });
        await until(() => procs.started.length === 2);
        const told = instructionsOf(procs.started[1]!);
        expect(told).toEndWith("**The user's instructions:**\nAnswer in Norwegian.");
        expect(told).not.toContain("French");
        await answer(procs, "Det regner.");
        await until(() => state().chat.busy === false);

        app.conversation.send("hi");
        await until(() => procs.started.length === 3);
        expect(instructionsOf(procs.started[2]!)).not.toContain("The user's instructions");
        await answer(procs, "hey");
        await until(() => state().chat.busy === false);

        const asked = call(ACTION_IDS.getAnswer, { question: "2+2?" });
        await until(() => procs.started.length === 4);
        expect(instructionsOf(procs.started[3]!)).toEndWith("**The user's instructions:**\nAnswer in French.");
        procs.stdout(procs.started[3]!.id, codexSays("quatre"));
        procs.exit(procs.started[3]!.id, 0);
        await asked;
        const own = call(ACTION_IDS.getAnswer, { question: "2+2?", instructions: "Digits only." });
        await until(() => procs.started.length === 5);
        expect(instructionsOf(procs.started[4]!)).toEndWith("**The user's instructions:**\nDigits only.");
        procs.stdout(procs.started[4]!.id, codexSays("4"));
        procs.exit(procs.started[4]!.id, 0);
        expect(await own).toBe("4");
    });

    test("flow messages with different instructions are answered in turns of their own", async () => {
        const { procs, call, state } = await start();
        await call(ACTION_IDS.sendMessage, { text: "one", instructions: "A" });
        await until(() => procs.started.length === 1);
        await call(ACTION_IDS.sendMessage, { text: "two", instructions: "B" });
        await call(ACTION_IDS.sendMessage, { text: "three", instructions: "B" });
        await answer(procs, "1");
        await until(() => procs.started.length === 2);
        const second = procs.started[1]!;
        expect(instructionsOf(second)).toEndWith("\nB");
        expect(second.args.at(-1)).toContain("two");
        expect(second.args.at(-1)).toContain("three");
        await answer(procs, "2 and 3");
        await until(() => state().chat.busy === false);
    });

    test("settings keep them trimmed and refuse too many", async () => {
        const { app, state } = await start();
        await app.setup({ settings: { ...PIP, automationInstructions: "  Be brief.  " } });
        expect(state().settings!.automationInstructions).toBe("Be brief.");
        await app.setup({ settings: { ...PIP, automationInstructions: "   " } });
        expect(state().settings).toEqual(PIP);
        await expect(app.setup({ settings: { ...PIP, automationInstructions: "x".repeat(4001) } })).rejects.toThrow("limited to 4000 characters");
    });
});

describe("a question past its time", () => {
    test("is stopped and fails, so the flow says why instead of timing out", async () => {
        expect(ASK_MS).toBeLessThan(30_000);
        const procs = new FakeProcesses();
        const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-ask-"));
        dir = workdir;
        const asker = new Asker({ host: procs, settings: () => PIP, resolve: () => "/usr/bin/codex", workdir, askMs: 50 });
        await expect(asker.ask("think forever")).rejects.toThrow("didn't answer within");
        expect(procs.killed.map((k) => k.signal)).toEqual(["SIGKILL"]);
    });
});
