// Claude Code's built-in bridge, end to end over real stdio: a fake Claude
// Code (fixtures/fakeClaudeCode.mjs) speaks the headless stream-json mode,
// and the hub starts a process per chat, streams its replies as ACP updates,
// answers its permission prompts, interrupts it, and resumes its sessions.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeTranslator } from "../src/core/claudeCode";
import type { Connection } from "../src/core/providers";
import type { AgentSessionInfo, AgentState } from "../src/core/types";
import { AgentHub, type TurnHandlers } from "../src/service/agents";
import { MAX_CLAUDE_PROCESSES } from "../src/service/claudeCode";
import { ChildHost } from "./childHost";

const FAKE = path.join(import.meta.dir, "fixtures", "fakeClaudeCode.mjs");
const NODE = process.execPath;
const BASE = "dev.paperboard.ai.agent.agent-0000000c";

let host: ChildHost;
let dir: string;
let states: Record<string, AgentState | null>;
let infos: Record<string, AgentSessionInfo | null>;
let hub: AgentHub;
const c: Connection = { id: "agent-0000000c", kind: "agent", label: "Claude Code", agent: "claude-code" };

function makeHub(options: { idleMs?: number; cancelGraceMs?: number } = {}): AgentHub {
    return new AgentHub({
        host,
        procId: (id) => `dev.paperboard.ai.agent.${id}`,
        resolve: async () => ({ command: NODE, args: [FAKE, dir], pathEnv: process.env.PATH ?? "" }),
        workDir: dir,
        clientVersion: "0.0.0-test",
        onState: (id, s) => (states[id] = s),
        onSessionInfo: (id, info) => (infos[id] = info),
        idleMs: options.idleMs ?? 60_000,
        initTimeoutMs: 5_000,
        stopTimeoutMs: 2_000,
        cancelGraceMs: options.cancelGraceMs ?? 2_000,
    });
}

function collect(): { handlers: TurnHandlers; updates: Record<string, unknown>[]; text: () => string } {
    const updates: Record<string, unknown>[] = [];
    return {
        updates,
        handlers: { onUpdate: (u) => updates.push(u), requestPermission: async () => null },
        text: () =>
            updates
                .filter((u) => u.sessionUpdate === "agent_message_chunk")
                .map((u) => (u.content as { text: string }).text)
                .join(""),
    };
}

const text = (t: string) => [{ type: "text" as const, text: t }];
const starts = () =>
    fs
        .readFileSync(path.join(dir, "starts.log"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { flags: string[]; cwd: string });
const open = (conversationId: string, extra: { sessionId?: string; mode?: string } = {}) => hub.openSession({ conversationId, connection: c, cwd: dir, ...extra });

async function until(cond: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error("timed out waiting");
        await new Promise((r) => setTimeout(r, 10));
    }
}

beforeEach(() => {
    host = new ChildHost();
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pb-claude-")));
    states = {};
    infos = {};
    hub = makeHub();
});

afterEach(async () => {
    await hub.stopAll().catch(() => undefined);
    await host.stopAll();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("Claude Code bridge", () => {
    it("runs the chat's session in its project and streams the reply once", async () => {
        const opened = await open("c1");
        expect(opened).toMatchObject({ resumed: false, capabilities: { image: true, embeddedContext: true } });
        expect(states[c.id]).toMatchObject({ status: "ready", name: "Claude Code", version: "9.9.9" });
        expect(host.starts[0]).toMatchObject({ id: `${BASE}.0`, cwd: dir });
        const [start] = starts();
        expect(start!.flags).toEqual(expect.arrayContaining(["--input-format", "stream-json", "--permission-prompt-tool", "stdio", "--session-id", opened.sessionId]));
        expect(infos.c1).toEqual({
            modes: expect.arrayContaining([expect.objectContaining({ id: "plan" })]),
            mode: "default",
            commands: [{ name: "review", description: "Review a PR", hint: "<pr>" }],
        });

        const turn = collect();
        expect(await hub.prompt(c, opened.sessionId, text("hello"), turn.handlers, new AbortController().signal)).toBe("end_turn");
        // streamed deltas only: the whole message repeats them, and a subagent's text is not the reply
        expect(turn.text()).toBe("Hello");
    });

    it("asks the chat before a tool runs, and keeps the edit's diff with its result", async () => {
        const opened = await open("c1");
        const asked: unknown[] = [];
        const turn = collect();
        turn.handlers.requestPermission = async (toolCall, options) => {
            asked.push({ id: toolCall.toolCallId, title: toolCall.title, options: options.map((o) => o.kind) });
            return "always";
        };
        await hub.prompt(c, opened.sessionId, text("edit"), turn.handlers, new AbortController().signal);
        expect(asked).toEqual([{ id: "toolu_1", title: "Edit /w/a.txt", options: ["allow_once", "allow_always", "reject_once"] }]);
        const answers = fs.readFileSync(path.join(dir, "answers.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
        expect(answers).toEqual([{ behavior: "allow", updatedInput: { file_path: "/w/a.txt", old_string: "a", new_string: "b" }, updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] }]);
        const done = turn.updates.find((u) => u.sessionUpdate === "tool_call_update")!;
        expect(done).toMatchObject({
            toolCallId: "toolu_1",
            status: "completed",
            content: [
                { type: "diff", path: "/w/a.txt", oldText: "a", newText: "b" },
                { type: "content", content: { type: "text", text: "Edited a.txt" } },
            ],
        });
        expect(turn.text()).toBe("Done");
    });

    it("tells Claude Code a rejected tool was declined", async () => {
        const opened = await open("c1");
        const turn = collect();
        turn.handlers.requestPermission = async () => "reject";
        await hub.prompt(c, opened.sessionId, text("edit"), turn.handlers, new AbortController().signal);
        expect(JSON.parse(fs.readFileSync(path.join(dir, "answers.log"), "utf8"))).toEqual({ behavior: "deny", message: "The user declined this." });
        expect(turn.updates.find((u) => u.sessionUpdate === "tool_call_update")).toMatchObject({ status: "failed" });
    });

    it("sends a message larger than one process write, whole", async () => {
        const opened = await open("c1");
        const big = "x".repeat(200_000);
        const turn = collect();
        await hub.prompt(c, opened.sessionId, text(`echo ${big}`), turn.handlers, new AbortController().signal);
        expect(JSON.parse(turn.text())[0].text).toBe(`echo ${big}`);
        expect(Math.max(...host.writes.map((w) => w.length))).toBeLessThanOrEqual(65536);
    });

    it("interrupts a turn the chat stops", async () => {
        const opened = await open("c1");
        const stop = new AbortController();
        const reply = hub.prompt(c, opened.sessionId, text("hang"), collect().handlers, stop.signal);
        setTimeout(() => stop.abort(), 50);
        expect(await reply).toBe("cancelled");
        expect(host.children.size).toBe(1);
    });

    it("stops a Claude Code that ignores the interrupt, and observes its exit", async () => {
        hub = makeHub({ cancelGraceMs: 100 });
        const opened = await open("c1");
        const stop = new AbortController();
        const reply = hub.prompt(c, opened.sessionId, text("deaf"), collect().handlers, stop.signal);
        setTimeout(() => stop.abort(), 50);
        await expect(reply).rejects.toThrow("Claude Code was stopped.");
        expect(host.children.size).toBe(0);
        expect(states[c.id]?.status).toBe("stopped");
        expect(infos.c1).toBeNull();
    });

    it("reports a crash with what Claude Code printed", async () => {
        const opened = await open("c1");
        await expect(hub.prompt(c, opened.sessionId, text("crash"), collect().handlers, new AbortController().signal)).rejects.toThrow(
            "Claude Code stopped (exit code 3): boom: claude fell over",
        );
        expect(states[c.id]).toMatchObject({ status: "error", errorDetail: "boom: claude fell over" });
    });

    it("fails a turn in Claude Code's own words, shown once", async () => {
        const opened = await open("c1");
        const turn = collect();
        await expect(hub.prompt(c, opened.sessionId, text("login"), turn.handlers, new AbortController().signal)).rejects.toThrow("Invalid API key · Please run /login");
        expect(turn.text()).toBe("Invalid API key · Please run /login");
    });

    it("resumes the chat's session in a new process, or says it starts fresh when the session is gone", async () => {
        const first = await open("c1");
        await hub.stop(c.id);
        expect(host.children.size).toBe(0);
        const again = await open("c1", { sessionId: first.sessionId });
        expect(again).toMatchObject({ sessionId: first.sessionId, resumed: true });
        expect(starts()[1]!.flags).toEqual(expect.arrayContaining(["--resume", first.sessionId]));

        await hub.stop(c.id);
        const gone = await open("c2", { sessionId: "11111111-2222-4333-8444-555555555555" });
        expect(gone.resumed).toBe(false);
        expect(gone.sessionId).not.toBe("11111111-2222-4333-8444-555555555555");
    });

    it("applies and switches the chat's permission mode", async () => {
        await open("c1", { mode: "plan" });
        expect(starts()[0]!.flags).toEqual(expect.arrayContaining(["--permission-mode", "plan"]));
        expect(infos.c1?.mode).toBe("plan");
        await hub.setMode(c, "c1", "acceptEdits");
        expect(infos.c1?.mode).toBe("acceptEdits");
        await expect(hub.setMode(c, "c1", "bypassPermissions")).rejects.toThrow('no mode "bypassPermissions"');
    });

    it("runs a bounded number of chats at once, stopping the one idle longest", async () => {
        const opened = [];
        for (let i = 0; i < MAX_CLAUDE_PROCESSES; i++) opened.push(await open(`c${i}`));
        expect(host.children.size).toBe(MAX_CLAUDE_PROCESSES);
        await open("extra");
        expect(host.children.size).toBe(MAX_CLAUDE_PROCESSES);
        expect(infos.c0).toBeNull();
        // the slot ids are fixed, so a later service run can find what this one left
        expect(new Set(host.starts.map((s) => s.id))).toEqual(new Set(Array.from({ length: MAX_CLAUDE_PROCESSES }, (_, i) => `${BASE}.${i}`)));
    });

    it("gives chats opening at once a slot each", async () => {
        await Promise.all([open("a"), open("b"), open("c")]);
        expect(new Set(host.starts.map((s) => s.id)).size).toBe(3);
        expect(host.children.size).toBe(3);
    });

    it("refuses a chat when every slot is mid-reply", async () => {
        const replies = [];
        const stops = [];
        for (let i = 0; i < MAX_CLAUDE_PROCESSES; i++) {
            const opened = await open(`c${i}`);
            const stop = new AbortController();
            stops.push(stop);
            replies.push(hub.prompt(c, opened.sessionId, text("hang"), collect().handlers, stop.signal));
        }
        await expect(open("extra")).rejects.toThrow(`Claude Code is already busy in ${MAX_CLAUDE_PROCESSES} chats.`);
        for (const s of stops) s.abort();
        expect(await Promise.all(replies)).toEqual(Array(MAX_CLAUDE_PROCESSES).fill("cancelled"));
    });

    it("stops an idle process and observes the exit", async () => {
        hub = makeHub({ idleMs: 50 });
        const opened = await open("c1");
        await hub.prompt(c, opened.sessionId, text("hello"), collect().handlers, new AbortController().signal);
        await until(() => states[c.id]?.status === "stopped");
        expect(host.children.size).toBe(0);
    });

    it("stops processes an earlier service run left in its slots", async () => {
        await host.start({ id: `${BASE}.2`, command: NODE, args: [FAKE, dir], cwd: dir, env: {} });
        await hub.stopLeftovers([c]);
        expect(host.children.size).toBe(0);
    });

    it("checks Claude Code without leaving it running", async () => {
        await hub.check(c);
        expect(host.starts).toHaveLength(1);
        expect(starts()[0]!.flags).not.toContain("--session-id");
        await until(() => host.children.size === 0);
        expect(states[c.id]).toMatchObject({ status: "stopped" });
    });
});

describe("Claude Code translation", () => {
    it("shows text Claude Code wrote without streaming it, and its todo list as the plan", () => {
        const t = new ClaudeTranslator();
        expect(t.updates({ type: "assistant", parent_tool_use_id: null, message: { id: "x", content: [{ type: "text", text: "API Error" }] } })).toEqual([
            { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "API Error" } },
        ]);
        const todos = { todos: [{ content: "Read", status: "completed" }, { content: "Write", status: "bogus" }] };
        expect(t.updates({ type: "assistant", parent_tool_use_id: null, message: { id: "y", content: [{ type: "tool_use", id: "t", name: "TodoWrite", input: todos }] } })).toEqual([
            { sessionUpdate: "plan", entries: [{ content: "Read", status: "completed" }, { content: "Write", status: "pending" }] },
        ]);
    });
});
