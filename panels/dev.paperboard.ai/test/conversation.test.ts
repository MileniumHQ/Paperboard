import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LIMITS, type ChatEntry, type ChatState, type Settings } from "../src/contract";
import { Conversation, TURN_PROC_ID } from "../src/service/conversation";
import { messagesToolset } from "../src/service/messages";
import { FakeProcesses, until } from "./fakeHost";

const dirs: string[] = [];
const convs: Conversation[] = [];
afterEach(async () => {
    await Promise.all(convs.splice(0).map((c) => c.shutdown()));
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup(o: { settings?: Settings | null; dir?: string; installed?: boolean; turnMs?: number; onToolsListed?: (cb: () => void) => () => void } = {}) {
    const dir = o.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "ai-conv-"));
    if (!o.dir) dirs.push(dir);
    const host = new FakeProcesses();
    const emitted: ChatEntry[] = [];
    const states: ChatState[] = [];
    const settings = o.settings === undefined ? ({ name: "Pip", harness: "codex", model: null } as Settings) : o.settings;
    const conv = new Conversation({
        host,
        dir,
        settings: () => settings,
        resolve: () => (o.installed === false ? null : "/usr/bin/codex"),
        mcp: () => ({ url: "http://127.0.0.1:1/mcp", token: "secret-token", onToolsListed: o.onToolsListed ?? (() => () => {}) }),
        instructions: async () => ["a section"],
        emit: (e) => emitted.push(e),
        onState: (s) => states.push(s),
        turnMs: o.turnMs,
    });
    conv.init();
    convs.push(conv);
    return { conv, host, emitted, states, dir };
}

const reply = (text: string) => JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }) + "\n";
const busy = (states: ChatState[]) => states.at(-1)?.busy;

describe("the conversation", () => {
    test("a message runs one turn: the token rides in env, never argv, and the reply joins the conversation", async () => {
        const { conv, host, emitted, states } = setup();
        conv.send("hello");
        await until(() => host.started.length === 1);
        const turn = host.started[0]!;
        expect(turn.id).toBe(TURN_PROC_ID);
        expect(turn.env).toEqual({ PAPERBOARD_COMPUTER_MCP_TOKEN: "secret-token" });
        expect(turn.args.join(" ")).not.toContain("secret-token");
        expect(busy(states)).toBe(true);

        host.stdout(TURN_PROC_ID, `{"type":"thread.started","thread_id":"t-1"}\n` + reply("hi there").slice(0, 20));
        host.stdout(TURN_PROC_ID, reply("hi there").slice(20));
        host.exit(TURN_PROC_ID, 0);
        await until(() => busy(states) === false);
        expect(emitted.map((e) => [e.kind, "text" in e ? e.text : ""])).toEqual([
            ["user", "hello"],
            ["agent", "hi there"],
        ]);
        expect(host.listenerCount()).toBe(0);
    });

    test("the typing bubble follows what the agent does: writing shows it, working with a tool hides it", async () => {
        const { conv, host, states } = setup({ settings: { name: "Pip", harness: "claude-code", model: null } });
        const typing = () => states.at(-1)?.typing;
        const block = (content_block: object) => JSON.stringify({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", content_block } }) + "\n";
        conv.send("book me a table");
        await until(() => host.started.length === 1);
        expect(typing()).toBe(true); // answering begins with writing back
        host.stdout(TURN_PROC_ID, block({ type: "tool_use", name: "mcp__paperboard__open_url" }));
        expect(typing()).toBe(false);
        expect(busy(states)).toBe(true); // still on it: its face shows that, not a typing bubble
        host.stdout(TURN_PROC_ID, block({ type: "tool_use", name: "mcp__paperboard__send_message" }));
        expect(typing()).toBe(true);
        conv.say("On it, looking now.");
        expect(typing()).toBe(false);
        host.stdout(TURN_PROC_ID, block({ type: "text" }));
        expect(typing()).toBe(true);
        conv.working(); // any other tool call through the service's endpoint
        expect(typing()).toBe(false);
        host.exit(TURN_PROC_ID, 0);
        await until(() => busy(states) === false);
        expect(typing()).toBe(false);
    });

    test("messages sent during a turn are read together on the next one, which continues the thread", async () => {
        const { conv, host, states } = setup();
        conv.send("one");
        await until(() => host.started.length === 1);
        const two = conv.send("two");
        const three = conv.send("three");
        expect(states.at(-1)).toEqual({ busy: true, typing: true, waiting: [expect.objectContaining({ text: "two" }), expect.objectContaining({ text: "three" })] });
        host.stdout(TURN_PROC_ID, `{"type":"thread.started","thread_id":"t-1"}\n` + reply("ok"));
        host.exit(TURN_PROC_ID, 0);
        await until(() => host.started.length === 2);
        const next = host.started[1]!.args;
        expect(next.slice(0, 2)).toEqual(["exec", "resume"]);
        expect(next.slice(-2)).toEqual(["t-1", `[${two.id}] two\n\n[${three.id}] three`]);
    });

    test("a turn that fails says so in the conversation", async () => {
        const { conv, host, emitted, states } = setup();
        conv.send("hi");
        await until(() => host.started.length === 1);
        host.stdout(TURN_PROC_ID, `{"type":"turn.failed","error":{"message":"usage limit reached"}}\n`);
        host.exit(TURN_PROC_ID, 1);
        await until(() => busy(states) === false);
        expect(emitted.at(-1)).toMatchObject({ kind: "error", text: "usage limit reached" });

        conv.send("again");
        await until(() => host.started.length === 2);
        host.exit(TURN_PROC_ID, 0);
        await until(() => emitted.at(-1)?.kind === "error" && emitted.length === 4);
        expect(emitted.at(-1)).toMatchObject({ kind: "error", text: "the turn ended without a reply" });
    });

    test("a harness that's gone is an error entry, not a silent nothing", async () => {
        const { conv, host, emitted } = setup({ installed: false });
        conv.send("hi");
        await until(() => emitted.length === 2);
        expect(host.started).toEqual([]);
        expect(emitted[1]).toMatchObject({ kind: "error", text: "Codex isn't installed on this computer anymore." });
    });

    test("stop ends the turn and drops what was waiting", async () => {
        const { conv, host, states, emitted } = setup();
        conv.send("long task");
        await until(() => host.started.length === 1);
        conv.send("and this");
        await conv.stop();
        await until(() => busy(states) === false);
        expect(host.killed[0]).toEqual({ id: TURN_PROC_ID, signal: "SIGTERM" });
        expect(states.at(-1)).toEqual({ busy: false, typing: false, waiting: [] });
        // never read, so never part of the conversation
        expect(emitted.filter((e) => e.kind === "user").map((e) => (e as { text: string }).text)).toEqual(["long task"]);
        expect(host.started.length).toBe(1);
        expect(emitted.some((e) => e.kind === "error")).toBe(false);
    });

    test("a waiting message joins the conversation only when read, and can be taken back before that", async () => {
        const { conv, host, emitted, states } = setup();
        conv.send("one");
        await until(() => host.started.length === 1);
        const two = conv.send("two");
        const three = conv.send("three");
        expect(two.waiting).toBe(true);
        const users = () => emitted.filter((e) => e.kind === "user").map((e) => (e as { text: string }).text);
        expect(users()).toEqual(["one"]);

        conv.unqueue(two.id);
        expect(states.at(-1)?.waiting).toEqual([{ id: three.id, text: "three" }]);
        expect(() => conv.unqueue(two.id)).toThrow(/isn't waiting/);

        host.stdout(TURN_PROC_ID, reply("ok"));
        host.exit(TURN_PROC_ID, 0);
        await until(() => host.started.length === 2);
        expect(host.started[1]!.args.at(-1)).toBe(`[${three.id}] three`);
        expect(users()).toEqual(["one", "three"]);
        expect(emitted.find((e) => e.kind === "user" && e.text === "three")?.id).toBe(three.id);
    });

    test("send now interrupts the turn quietly and reads what was waiting", async () => {
        const { conv, host, emitted } = setup();
        conv.send("long task");
        await until(() => host.started.length === 1);
        await expect(conv.sendNow()).rejects.toThrow(/no messages/);
        conv.send("actually, stop and do this");
        expect(await conv.sendNow()).toEqual({ interrupted: true });
        await until(() => host.started.length === 2);
        expect(host.started[1]!.args.at(-1)).toMatch(/^\[\w+\] actually, stop and do this$/);
        expect(emitted.some((e) => e.kind === "error")).toBe(false);
    });

    test("a stop with nothing running doesn't silence the next turn's failure", async () => {
        const { conv, host, emitted } = setup();
        await conv.stop();
        conv.send("hi");
        await until(() => host.started.length === 1);
        host.exit(TURN_PROC_ID, 1);
        await until(() => emitted.some((e) => e.kind === "error"));
    });

    test("starting over stops the turn and forgets the conversation and its thread, for good", async () => {
        const first = setup();
        first.conv.send("hi");
        await until(() => first.host.started.length === 1);
        first.host.stdout(TURN_PROC_ID, `{"type":"thread.started","thread_id":"t-1"}\n`);
        first.conv.send("waiting");
        await first.conv.clear();
        expect(first.host.killed[0]).toEqual({ id: TURN_PROC_ID, signal: "SIGTERM" });
        expect(first.conv.history()).toEqual([]);
        expect(first.states.at(-1)).toEqual({ busy: false, typing: false, waiting: [] });

        first.conv.send("hello again");
        await until(() => first.host.started.length === 2);
        expect(first.host.started[1]!.args.slice(0, 2)).not.toEqual(["exec", "resume"]);
        first.host.stdout(TURN_PROC_ID, reply("hey"));
        first.host.exit(TURN_PROC_ID, 0);
        await until(() => busy(first.states) === false);

        await first.conv.shutdown();
        const second = setup({ dir: first.dir });
        expect(second.conv.history().map((e) => (e as { text: string }).text)).toEqual(["hello again", "hey"]);
    });

    test("a new conversation puts the current one in the history with its thread; reopening it continues that thread", async () => {
        const first = setup();
        first.conv.send("plan my trip to Oslo");
        await until(() => first.host.started.length === 1);
        first.host.stdout(TURN_PROC_ID, `{"type":"thread.started","thread_id":"t-oslo"}\n` + reply("sure"));
        first.conv.send("waiting");
        await first.conv.newConversation();
        expect(first.host.killed[0]).toEqual({ id: TURN_PROC_ID, signal: "SIGTERM" });
        expect(first.conv.history()).toEqual([]);
        expect(first.states.at(-1)).toEqual({ busy: false, typing: false, waiting: [] });
        const [oslo] = first.conv.past();
        expect(oslo).toMatchObject({ title: "plan my trip to Oslo", messages: 2 });

        // the new one starts a new thread
        first.conv.send("what's 2+2");
        await until(() => first.host.started.length === 2);
        expect(first.host.started[1]!.args.slice(0, 2)).not.toEqual(["exec", "resume"]);
        first.host.stdout(TURN_PROC_ID, `{"type":"thread.started","thread_id":"t-math"}\n` + reply("4"));
        first.host.exit(TURN_PROC_ID, 0);
        await until(() => busy(first.states) === false);

        // reopening survives a restart, and swaps: Oslo is current again, the sum is in the history
        await first.conv.shutdown();
        const second = setup({ dir: first.dir });
        await second.conv.open(oslo!.id);
        expect(second.conv.history().map((e) => (e as { text: string }).text)).toEqual(["plan my trip to Oslo", "sure"]);
        expect(second.conv.past().map((p) => p.title)).toEqual(["what's 2+2"]);
        second.conv.send("and hotels?");
        await until(() => second.host.started.length === 1);
        expect(second.host.started[0]!.args.slice(0, 2)).toEqual(["exec", "resume"]);
        expect(second.host.started[0]!.args).toContain("t-oslo");
    });

    test("the history: an empty conversation isn't kept, ids are checked, deleting is for good, and it's bounded", async () => {
        const { conv, dir } = setup();
        await conv.newConversation();
        expect(conv.past()).toEqual([]);
        await expect(conv.open("../escape")).rejects.toThrow("isn't a conversation's id");
        expect(() => conv.deletePast("../../x")).toThrow("isn't a conversation's id");
        await expect(conv.open("0123456789ab")).rejects.toThrow("isn't in the history");

        conv.send("hi");
        await conv.stop();
        await conv.newConversation();
        const [p] = conv.past();
        expect(conv.deletePast(p!.id)).toEqual({ deleted: true });
        expect(conv.past()).toEqual([]);
        expect(fs.existsSync(path.join(dir, "past", p!.id))).toBe(false);

        // full: a new conversation asks for room rather than dropping an old one
        for (let i = 0; i < LIMITS.pastConversations; i++) {
            fs.mkdirSync(path.join(dir, "past", i.toString(16).padStart(12, "0")), { recursive: true });
        }
        conv.send("one more");
        await conv.stop();
        await expect(conv.newConversation()).rejects.toThrow("delete some");
        expect(conv.history()).toHaveLength(1);
    });

    test("a past conversation whose summary can't be read is reported, not hidden", async () => {
        const { conv, dir } = setup();
        fs.mkdirSync(path.join(dir, "past", "aaaaaaaaaaaa"), { recursive: true });
        fs.writeFileSync(path.join(dir, "past", "aaaaaaaaaaaa", "meta.json"), "{torn");
        expect(() => conv.past()).toThrow("can't be read");
    });

    test("a turn past its time is killed", async () => {
        const { conv, host, emitted } = setup({ turnMs: 30 });
        conv.send("hi");
        await until(() => host.killed.length > 0);
        await until(() => emitted.at(-1)?.kind === "error");
        expect(emitted.at(-1)).toMatchObject({ kind: "error" });
    });

    test("input is validated by the service", () => {
        const { conv } = setup();
        expect(() => conv.send("   ")).toThrow();
        expect(() => conv.send("x".repeat(16_001))).toThrow(/16000/);
        expect(() => setup({ settings: null }).conv.send("hi")).toThrow(/setting up/);
    });

    test("the transcript survives a restart; a changed entry keeps its latest copy; a torn last line is dropped", async () => {
        const first = setup();
        first.conv.send("hi");
        await until(() => first.host.started.length === 1);
        first.host.stdout(TURN_PROC_ID, reply("done"));
        first.host.exit(TURN_PROC_ID, 0);
        await until(() => first.states.at(-1)?.busy === false);
        const file = path.join(first.dir, "transcript.jsonl");
        const hi = first.conv.history()[0]!;
        fs.appendFileSync(file, JSON.stringify({ ...hi, text: "hi (edited)" }) + "\n" + `{"id":"torn","at":`);

        const second = setup({ dir: first.dir });
        const h = second.conv.history();
        expect(h.map((e) => e.kind)).toEqual(["user", "agent"]);
        expect(h[0]).toMatchObject({ text: "hi (edited)" });
    });

    test("tool-call entries from older transcripts are tolerated and not part of the conversation", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-conv-"));
        dirs.push(dir);
        const old = [
            { id: "a", at: 1, kind: "user", text: "hi" },
            { id: "t", at: 2, kind: "tool", tool: "shell", summary: "ls", status: "done", detail: "x" },
            { id: "s", at: 3, kind: "tool", tool: "search", summary: "cats", status: "done", detail: null },
            { id: "b", at: 4, kind: "agent", text: "hello" },
        ];
        fs.writeFileSync(path.join(dir, "transcript.jsonl"), old.map((e) => JSON.stringify(e)).join("\n") + "\n");
        const { conv } = setup({ dir });
        expect(conv.history().map((e) => e.id)).toEqual(["a", "b"]);
    });

    test("a sign-in request is kept in the transcript, and one still waiting at a restart reads as lapsed", () => {
        const first = setup();
        const at = Date.now();
        const asked = { id: "s1", at, kind: "sign-in", site: "github.com", fields: [{ label: "Password", secret: true }], status: "waiting" } as const;
        first.conv.post(asked);
        first.conv.post({ ...asked, id: "s2", at: at + 1, status: "submitted" });
        expect(first.emitted.map((e) => e.id)).toEqual(["s1", "s2"]);

        const second = setup({ dir: first.dir });
        expect(second.conv.history().map((e) => [e.id, e.kind === "sign-in" && e.status])).toEqual([
            ["s1", "expired"],
            ["s2", "submitted"],
        ]);
        // not a message: nothing can reply to it
        expect(() => second.conv.send("re", "s1")).toThrow("no message [s1]");
    });

    test("damage before the last line is refused, not read as an empty conversation", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-conv-"));
        dirs.push(dir);
        fs.writeFileSync(path.join(dir, "transcript.jsonl"), `garbage\n{"id":"a","at":1,"kind":"user","text":"hi"}\n`);
        expect(() => setup({ dir })).toThrow(/line 1 is unreadable/);
    });

    test("a turn left running by the last service generation is stopped", async () => {
        const host = new FakeProcesses();
        host.alive.add(TURN_PROC_ID);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-conv-"));
        dirs.push(dir);
        const conv = new Conversation({ host, dir, settings: () => null, resolve: () => null, mcp: () => ({ url: "", token: "", onToolsListed: () => () => {} }), instructions: async () => [], emit: () => {}, onState: () => {} });
        conv.init();
        await until(() => host.killed.length === 1);
        expect(host.killed[0]).toEqual({ id: TURN_PROC_ID, signal: "SIGKILL" });
    });
});

describe("texting", () => {
    // the toolset the agent has, over this conversation
    const texting = (conv: Conversation) => messagesToolset({ say: (t, r) => conv.say(t, r) });
    const send = (conv: Conversation, text: string, reply_to?: string) => texting(conv).call("send_message", { text, reply_to });
    const bubbles = (emitted: ChatEntry[]) => emitted.filter((e) => e.kind === "agent") as Extract<ChatEntry, { kind: "agent" }>[];

    test("send_message adds an agent bubble at once, mid-turn, and the model can see the user's message ids", async () => {
        const { conv, host, emitted } = setup();
        const hi = conv.send("hi");
        await until(() => host.started.length === 1);
        // the harness is handed the message with its id
        expect(host.started[0]!.args.at(-1)).toBe(`[${hi.id}] hi`);
        expect(hi.id.length).toBeLessThanOrEqual(8);

        const r = await send(conv, "hey!", hi.id);
        expect(r.isError).toBeUndefined();
        // the turn answers only "hi", so quoting it would repeat the bubble right above: shown plain
        // (this test used to expect the quote; real models pass reply_to on nearly every bubble)
        expect(bubbles(emitted)).toMatchObject([{ text: "hey!" }]);
        expect(bubbles(emitted)[0]!.replyTo).toBeUndefined();
        expect(r.text).toBe(`sent [${bubbles(emitted)[0]!.id}]`);
        // the turn is still running: it was a bubble, not the end
        expect(conv.history().at(-1)).toMatchObject({ kind: "agent", text: "hey!" });
        host.exit(TURN_PROC_ID, 0);
        await until(() => !emitted.some((e) => e.kind === "error") && conv.history().length === 2);
    });

    test("a reply to one of several messages, or to an earlier one, keeps its quote", async () => {
        const { conv, host, emitted, states } = setup();
        const first = conv.send("hi");
        await until(() => host.started.length === 1);
        conv.send("what's 2+2?");
        const third = conv.send("and 3+3?");
        host.exit(TURN_PROC_ID, 0); // the first turn ends unanswered; the other two are read together
        await until(() => host.started.length === 2);
        expect((await send(conv, "6", third.id)).isError).toBeUndefined();
        expect((await send(conv, "hi back!", first.id)).isError).toBeUndefined();
        expect(bubbles(emitted).map((b) => [b.text, b.replyTo])).toEqual([
            ["6", third.id],
            ["hi back!", first.id],
        ]);
        host.exit(TURN_PROC_ID, 0);
        await until(() => busy(states) === false);
    });

    test("a reply_to that isn't a message is a tool error, and nothing is added", async () => {
        const { conv, host, emitted } = setup();
        conv.send("hi");
        await until(() => host.started.length === 1);
        const r = await send(conv, "hello", "nope");
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/no message \[nope\]/);
        expect((await send(conv, "   ")).isError).toBe(true);
        expect(bubbles(emitted)).toEqual([]);
        // an error entry isn't a message to reply to either
        host.exit(TURN_PROC_ID, 1);
        await until(() => emitted.some((e) => e.kind === "error"));
        expect((await send(conv, "x", emitted.find((e) => e.kind === "error")!.id)).isError).toBe(true);
    });

    test("send_message outside a turn is refused", async () => {
        const { conv } = setup();
        expect((await send(conv, "hello?")).isError).toBe(true);
        expect(conv.history()).toEqual([]);
    });

    test("the model can reply to its own earlier bubble, and to the user's reply", async () => {
        const { conv, host, emitted, states } = setup();
        conv.send("hi");
        await until(() => host.started.length === 1);
        const first = (await send(conv, "one sec")).text.slice(6, -1);
        expect((await send(conv, "done!", first)).isError).toBeUndefined();
        host.exit(TURN_PROC_ID, 0);
        await until(() => busy(states) === false);

        // the user replies to the agent's bubble; the next turn quotes what it answers
        conv.send("thanks", first);
        await until(() => host.started.length === 2);
        expect(host.started[1]!.args.at(-1)).toMatch(new RegExp(`^\\[\\w+\\] \\(replying to \\[${first}\\] “one sec”\\) thanks$`));
        expect(emitted.find((e) => e.kind === "user" && e.text === "thanks")).toMatchObject({ replyTo: first });
    });

    test("the user's replyTo is validated by the service", () => {
        const { conv } = setup();
        expect(() => conv.send("hi", "ghost")).toThrow(/no message \[ghost\]/);
        expect(conv.history()).toEqual([]);
    });

    test("text the model wrote instead of calling send_message still shows, once", async () => {
        const { conv, host, emitted, states } = setup();
        conv.send("hi");
        await until(() => host.started.length === 1);
        host.stdout(TURN_PROC_ID, reply("just plain text"));
        host.exit(TURN_PROC_ID, 0);
        await until(() => busy(states) === false);
        expect(bubbles(emitted).map((b) => b.text)).toEqual(["just plain text"]);
        expect(emitted.some((e) => e.kind === "error")).toBe(false);
    });

    // This used to show plain output that didn't repeat a sent text. A real Claude turn ends with a recap of
    // its texts ("I sent you two messages…"), which then showed up as a bubble, so a turn that texted shows none.
    test("once the agent has texted, its plain output (a recap) isn't shown", async () => {
        const { conv, host, emitted, states } = setup();
        conv.send("hi");
        await until(() => host.started.length === 1);
        await send(conv, "All done, the file is ready.");
        host.stdout(TURN_PROC_ID, reply("All done,  the file is ready.") + reply("I sent you a message saying it's done."));
        host.exit(TURN_PROC_ID, 0);
        await until(() => busy(states) === false);
        expect(bubbles(emitted).map((b) => b.text)).toEqual(["All done, the file is ready."]);
    });

    test("a turn that only used send_message counts as a reply", async () => {
        const { conv, host, emitted, states } = setup();
        conv.send("hi");
        await until(() => host.started.length === 1);
        await send(conv, "hey");
        host.exit(TURN_PROC_ID, 0);
        await until(() => busy(states) === false);
        expect(emitted.some((e) => e.kind === "error")).toBe(false);
    });
});

describe("notices (a routine is due)", () => {
    const say = (conv: Conversation, text: string) => messagesToolset({ say: (t, r) => conv.say(t, r) }).call("send_message", { text });
    const agentTexts = (emitted: ChatEntry[]) => emitted.filter((e) => e.kind === "agent").map((e) => ("text" in e ? e.text : ""));

    test("a notice runs a turn that isn't the user's: no bubble for it, no typing, and its texts show", async () => {
        const { conv, host, emitted, states } = setup();
        conv.notice("Your routine [abc123] is due: text a flag fact.");
        await until(() => host.started.length === 1);
        expect(host.started[0]!.args.at(-1)).toBe("[from Paperboard, not the user] Your routine [abc123] is due: text a flag fact.");
        expect(emitted.some((e) => e.kind === "user")).toBe(false);
        expect(states.some((s) => s.busy || s.typing)).toBe(false);
        expect((await say(conv, "Nepal's flag has 5 sides!")).isError).toBeUndefined();
        host.exit(TURN_PROC_ID, 0);
        // the next message gets its own turn once this one is over
        conv.send("cool");
        await until(() => host.started.length === 2);
        expect(agentTexts(emitted)).toEqual(["Nepal's flag has 5 sides!"]);
        expect(emitted.some((e) => e.kind === "error")).toBe(false);
    });

    test("a notice turn may end without a text; its plain output is a note to itself, not a bubble", async () => {
        const { conv, host, emitted } = setup();
        conv.notice("Your routine [abc123] is due: check the forum.");
        await until(() => host.started.length === 1);
        host.stdout(TURN_PROC_ID, reply("Nothing new on the forum, no need to text."));
        host.exit(TURN_PROC_ID, 0);
        conv.send("hi");
        await until(() => host.started.length === 2);
        expect(agentTexts(emitted)).toEqual([]);
        expect(emitted.some((e) => e.kind === "error")).toBe(false);
    });

    test("a notice waits for the running turn, and is read with the user's messages", async () => {
        const { conv, host, states } = setup();
        conv.send("first");
        await until(() => host.started.length === 1);
        conv.notice("routine due");
        const second = conv.send("second");
        host.exit(TURN_PROC_ID, 0);
        await until(() => host.started.length === 2);
        expect(host.started[1]!.args.at(-1)).toBe(`[${second.id}] second\n\n[from Paperboard, not the user] routine due`);
        // the user's message is in this turn, so the agent is typing
        expect(busy(states)).toBe(true);
    });

    test("there's no notice before the agent is set up", () => {
        const { conv } = setup({ settings: null });
        expect(() => conv.notice("routine due")).toThrow(/isn't set up/);
    });
});

describe("files in the conversation", () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const attach = (conv: Conversation, name = "cat.png") => {
        const { id } = conv.attachments.begin(name, PNG.length);
        conv.attachments.put(id, 0, PNG.toString("base64"));
        return conv.attachments.finish(id);
    };

    test("a message carries its files: the bubble lists them and the agent reads which they are", async () => {
        const { conv, host, emitted } = setup();
        const cat = attach(conv);
        conv.send("", null, [cat.id]);
        await until(() => host.started.length === 1);
        expect(emitted[0]).toMatchObject({ kind: "user", text: "", attachments: [cat] });
        expect(host.started[0]!.args.at(-1)).toBe(`[${emitted[0]!.id}] \n(attached: [file ${cat.id}] cat.png, image, 11 B)`);
        expect(() => conv.send("", null, [])).toThrow("say something first");
        expect(() => conv.send("x", null, ["0123456789ab"])).toThrow("no file");
        expect(() => conv.send("x", null, [cat.id, cat.id])).toThrow("attached twice");
        expect(() => conv.send("x", null, "nope")).toThrow("a list of file ids");
    });

    test("the agent shows only files the conversation has", async () => {
        const { conv, host } = setup();
        const cat = attach(conv);
        conv.send("show me");
        await until(() => host.started.length === 1);
        expect(() => conv.say("here ![a dog](attachment:0123456789ab)")).toThrow("no file [0123456789ab]");
        expect(() => conv.say("here ![a dog](attachment:../x)")).toThrow("isn't a file's id");
        expect(conv.say(`here ![a cat](attachment:${cat.id})`).id).toBeString();
    });

    test("files move with their conversation into the history and back; starting over forgets them", async () => {
        const { conv, host } = setup();
        const cat = attach(conv);
        conv.send("look", null, [cat.id]);
        await until(() => host.started.length === 1);
        host.exit(TURN_PROC_ID, 0);
        await conv.newConversation();
        expect(() => conv.attachments.get(cat.id)).toThrow("no file");
        const [past] = conv.past();
        // an upload never sent doesn't follow a conversation that's reopened
        const stray = attach(conv, "stray.png");
        await conv.open(past!.id);
        expect(conv.attachments.get(cat.id)).toEqual(cat);
        expect(() => conv.attachments.get(stray.id)).toThrow("no file");
        await conv.clear();
        expect(() => conv.attachments.get(cat.id)).toThrow("no file");
    });
});

describe("an OpenCode turn", () => {
    test("goes over ACP, prompts once OpenCode has the panel's tools, ends when answered, and resumes its session next time", async () => {
        const listeners = new Set<() => void>();
        const { conv, host, emitted, states } = setup({
            settings: { name: "Pip", harness: "opencode", model: "vertex/gemini-3-flash" } as Settings,
            onToolsListed: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
        });
        const sent = () => host.written.map((w) => JSON.parse(w.data));
        const out = (msg: unknown) => host.stdout(TURN_PROC_ID, JSON.stringify({ jsonrpc: "2.0", ...(msg as object) }) + "\n");
        const answer = async (n: number, method: string, result: unknown) => {
            await until(() => sent().length === n + 1);
            expect(sent()[n].method).toBe(method);
            out({ id: sent()[n].id, result });
            return sent()[n].params;
        };

        conv.send("hi");
        await until(() => host.started.length === 1);
        expect(host.started[0]!.args).toEqual(["acp"]);
        await answer(0, "initialize", {});
        await answer(1, "session/new", { sessionId: "ses_1" });
        expect(await answer(2, "session/set_config_option", {})).toMatchObject({ sessionId: "ses_1", configId: "model", value: "vertex/gemini-3-flash" });
        await new Promise((r) => setTimeout(r, 400));
        expect(sent().length).toBe(3); // no prompt while OpenCode can't use the panel's tools yet
        for (const cb of listeners) cb();
        await until(() => sent().length === 4);
        expect(sent()[3].method).toBe("session/prompt");
        expect(sent()[3].params.prompt[0].text).toContain("hi");
        out({ method: "session/update", params: { sessionId: "ses_1", update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "hel" } } } });
        out({ method: "session/update", params: { sessionId: "ses_1", update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "lo" } } } });
        out({ id: sent()[3].id, result: { stopReason: "end_turn" } });

        await until(() => busy(states) === false);
        // answered: OpenCode is stopped, and its exit by signal isn't a failure
        expect(host.killed).toContainEqual({ id: TURN_PROC_ID, signal: "SIGTERM" });
        expect(emitted.filter((e) => e.kind === "agent").map((e) => (e as { text: string }).text)).toEqual(["hello"]);
        expect(emitted.some((e) => e.kind === "error")).toBe(false);
        expect(listeners.size).toBe(0);

        host.written.length = 0;
        conv.send("again");
        await until(() => host.started.length === 2);
        await answer(0, "initialize", {});
        expect(await answer(1, "session/resume", {})).toMatchObject({ sessionId: "ses_1" });
        await conv.stop();
    });
});
