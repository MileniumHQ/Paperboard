import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { conversationRig, errors, said, settled, turnId, type Rig } from "./support/rig";
import { plan, release, SLOW } from "./support/host";

let rig: Rig | null = null;
afterEach(async () => {
    await rig?.close();
    rig = null;
});

// A turn's input is closed for argv harnesses.
describe("a turn's input", () => {
    test("Codex and Claude Code turns read the message from their input, closed after it, and finish", async () => {
        for (const harness of ["codex", "claude-code"] as const) {
            rig = await conversationRig({ harness });
            const { id } = rig.conversation.send("hello there");
            await settled(rig);
            expect(rig.host.startedAs(turnId).map((s) => s.stdin)).toEqual([undefined]);
            expect(rig.host.writes.filter((w) => w.id === turnId).map((w) => w.data).join("")).toBe(`[${id}] hello there`);
            expect(rig.host.inputsClosed).toEqual([turnId]);
            expect(said(rig)).toHaveLength(1);
            expect(errors(rig)).toEqual([]);
            await rig.close();
            rig = null;
        }
    }, SLOW);

    test("an OpenCode turn keeps its input open: it talks ACP over it", async () => {
        rig = await conversationRig({ harness: "opencode" });
        rig.conversation.send("hello there");
        await settled(rig);
        const [start] = rig.host.startedAs(turnId);
        expect(start!.args).toEqual(["acp"]);
        expect(start!.stdin).toBeUndefined();
        expect(said(rig)).toEqual(["ok from opencode"]);
        expect(rig.log().filter((e) => e.event === "acp").map((e) => e.method)).toEqual(["initialize", "session/new", "session/prompt"]);
    }, SLOW);
});

// Messages during a turn.
describe("messages during a turn", () => {
    test("a message sent mid-turn stops it with one SIGTERM, and the next turn resumes the thread with every queued message", async () => {
        rig = await conversationRig({ harness: "codex" });
        rig.conversation.send("first [[hold]]");
        await rig.host.printed(turnId, "fake.holding");
        const a = rig.conversation.send("second");
        const b = rig.conversation.send("third");
        expect(a.waiting).toBe(true);
        expect(b.waiting).toBe(true);
        await rig.states.until(() => rig!.turns().length === 2, "the next turn");
        await settled(rig);
        expect(rig.host.kills.filter((k) => k.id === turnId)).toEqual([{ id: turnId, signal: "SIGTERM" }]);
        const [first, next] = rig.turns();
        expect(rig.log().filter((e) => e.event === "sigterm")).toHaveLength(1);
        // the same thread, resumed, with both messages
        expect(next.thread).toBe(first.thread);
        expect(rig.host.startedAs(turnId)[1]!.args.filter((a) => a === "exec" || a === "resume")).toEqual(["exec", "resume"]);
        expect(next.message).toContain(`[${a.id}] second`);
        expect(next.message).toContain(`[${b.id}] third`);
        expect(rig.conversation.history().filter((e) => e.kind === "user").map((e) => (e as { text: string }).text)).toEqual(["first [[hold]]", "second", "third"]);
        expect(errors(rig)).toEqual([]);
    }, SLOW);

    test("a flow's message never interrupts the user's turn: it waits for a turn of its own", async () => {
        rig = await conversationRig({ harness: "codex" });
        rig.conversation.send("mine [[hold]]");
        await rig.host.printed(turnId, "fake.holding");
        const flow = rig.conversation.send("from a flow", null, [], { fromFlow: true });
        expect(flow.waiting).toBe(true);
        expect(rig.states.last()!.waiting.map((w) => w.text)).toEqual(["from a flow"]);
        release(rig.root);
        await rig.states.until(() => rig!.turns().length === 2, "the flow's turn");
        await settled(rig);
        expect(rig.host.kills).toEqual([]);
        const [mine, theirs] = rig.turns();
        expect(mine.message).not.toContain("from a flow");
        expect(theirs.message).toContain(`[${flow.id}] from a flow`);
        expect(said(rig)).toHaveLength(2);
    }, SLOW);
});

// Replies are texts: one typing session each, never plain output.
describe("replies", () => {
    test("answering is one typing session from the turn's start to the text, through the agent's work on the way", async () => {
        rig = await conversationRig({ harness: "claude-code" });
        rig.conversation.send("look it up [[work]]");
        await settled(rig);
        expect(said(rig)).toEqual(["ok"]);
        const typing = rig.states.items.map((s) => s.typing).filter((t, i, all) => i === 0 || t !== all[i - 1]);
        expect(typing).toEqual([false, true, false]);
    }, SLOW);

    test("a reply left as plain output is never shown: the agent is told once, in the same thread, to text it", async () => {
        rig = await conversationRig({ harness: "claude-code" });
        rig.conversation.send("hi [[plain]]");
        await settled(rig);
        expect(said(rig)).toEqual(["ok"]);
        expect(errors(rig)).toEqual([]);
        const [first, nudge] = rig.turns();
        expect(nudge.thread).toBe(first.thread);
        expect(nudge.message).toStartWith("[from Paperboard, not the user] Your turn ended without a send_message");
    }, SLOW);
});

// Failures are shown, not swallowed (the conversation's part).
describe("failed turns", () => {
    test("a turn that fails, or ends without a reply, adds an error entry and never a text bubble", async () => {
        rig = await conversationRig({ harness: "codex" });
        rig.conversation.send("please [[fail]]");
        await settled(rig);
        rig.conversation.send("again [[silent]]");
        await settled(rig);
        expect(said(rig)).toEqual([]);
        expect(errors(rig).map((e) => (e as { text: string }).text)).toEqual([
            expect.stringContaining("the turn ended with exit 1: the brain fell over"),
            "the turn ended without a reply",
        ]);
    }, SLOW);

    test("Claude's own \"Not logged in\" reply is an error, not something the agent said", async () => {
        rig = await conversationRig({ harness: "claude-code" });
        rig.conversation.send("hi [[notloggedin]]");
        await settled(rig);
        expect(said(rig)).toEqual([]);
        expect(errors(rig).map((e) => (e as { text: string }).text)).toEqual(["Not logged in · Please run /login"]);
    }, SLOW);

    test("a brain that's missing or signed out fails with the way out, and no process is started", async () => {
        rig = await conversationRig({ harness: "codex", resolve: () => null });
        rig.conversation.send("hi");
        await settled(rig);
        expect(errors(rig).map((e) => (e as { text: string }).text)).toEqual(["Codex isn't installed. Install it in the agent's settings."]);
        expect(rig.host.started).toEqual([]);
        await rig.close();

        rig = await conversationRig({ harness: "codex", problem: () => "Codex isn't signed in. Sign in to it in the agent's settings." });
        rig.conversation.send("hi");
        await settled(rig);
        expect(errors(rig).map((e) => (e as { text: string }).text)).toEqual(["Codex isn't signed in. Sign in to it in the agent's settings."]);
        expect(rig.host.started).toEqual([]);
    }, SLOW);
});

// Compaction never loses context.
describe("compaction", () => {
    test("past the budget, the summary is written in the old thread and the next turn starts a fresh one seeded with it and the queued messages", async () => {
        rig = await conversationRig({ harness: "claude-code", contextBudget: 1000 });
        plan(rig.root, { holdSummary: true });
        rig.conversation.send("I love trains [[big]]");
        await rig.host.printed(turnId, "fake.holding");
        // the summary is being written: a message now waits for it rather than stopping it
        const queued = rig.conversation.send("what do I love?");
        expect(queued.waiting).toBe(true);
        plan(rig.root, {});
        release(rig.root);
        await rig.states.until(() => rig!.turns().length === 3, "the turn after the compaction");
        await settled(rig);
        const [first, summary, fresh] = rig.turns();
        expect(summary.thread).toBe(first.thread);
        expect(summary.resumed).toBe(true);
        expect(fresh.resumed).toBe(false);
        expect(fresh.thread).not.toBe(first.thread);
        expect(fresh.message).toContain("SUMMARY: the user likes trains");
        expect(fresh.message).toContain("The user: ");
        expect(fresh.message).toContain("I love trains");
        expect(fresh.message).toContain(`[${queued.id}] what do I love?`);
        expect(rig.host.kills).toEqual([]);
        // carried on: the carry is done with
        expect(fs.existsSync(path.join(rig.dir, "carry.json"))).toBe(false);
    }, SLOW);

    test("Codex's thread is measured from its rollout, and compacts the same way", async () => {
        rig = await conversationRig({ harness: "codex", contextBudget: 1000 });
        rig.conversation.send("I love trains [[big]]");
        await settled(rig);
        expect(JSON.parse(fs.readFileSync(path.join(rig.dir, "carry.json"), "utf8")).summary).toBe("SUMMARY: the user likes trains");
        rig.conversation.send("what do I love?");
        await settled(rig);
        const [first, summary, fresh] = rig.turns();
        expect(summary.thread).toBe(first.thread);
        expect(summary.resumed).toBe(true);
        expect(fresh.resumed).toBe(false);
        expect(fresh.message).toContain("SUMMARY: the user likes trains");
        expect(errors(rig)).toEqual([]);
        expect(fs.existsSync(path.join(rig.dir, "carry.json"))).toBe(false);
    }, SLOW);

    test("carry.json holds the carry-over until a turn from it succeeds", async () => {
        rig = await conversationRig({ harness: "claude-code", contextBudget: 1000 });
        rig.conversation.send("I love trains [[big]]");
        await settled(rig);
        const carry = path.join(rig.dir, "carry.json");
        expect(JSON.parse(fs.readFileSync(carry, "utf8")).summary).toBe("SUMMARY: the user likes trains");
        rig.conversation.send("this one breaks [[fail]]");
        await settled(rig);
        expect(fs.existsSync(carry)).toBe(true);
        // and a restart still has it
        await rig.conversation.shutdown();
        rig.restart();
        rig.conversation.send("and now?");
        await settled(rig);
        const last = rig.turns().at(-1);
        expect(last.resumed).toBe(false);
        expect(last.message).toContain("SUMMARY: the user likes trains");
        expect(fs.existsSync(carry)).toBe(false);
    }, SLOW);

    test("a summary that fails shows an error and the next turn resumes the old thread", async () => {
        rig = await conversationRig({ harness: "claude-code", contextBudget: 1000 });
        plan(rig.root, { summaryFails: true });
        rig.conversation.send("I love trains [[big]]");
        await settled(rig);
        expect(errors(rig).map((e) => (e as { title?: string }).title)).toEqual(["Conversation not compacted"]);
        expect(fs.existsSync(path.join(rig.dir, "carry.json"))).toBe(false);
        plan(rig.root, {});
        rig.conversation.send("still there?");
        await settled(rig);
        const [first, , next] = rig.turns();
        expect(next.resumed).toBe(true);
        expect(next.thread).toBe(first.thread);
        expect(next.message).not.toContain("SUMMARY");
    }, SLOW);
});
