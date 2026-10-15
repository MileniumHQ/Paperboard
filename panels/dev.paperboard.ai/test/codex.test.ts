// Codex's built-in bridge, end to end over real stdio: a fake Codex
// (fixtures/fakeCodex.mjs) speaks the app server's JSON-RPC, and the hub
// starts one process for every chat, streams replies as ACP updates,
// answers approvals, interrupts turns, and resumes threads.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexTranslator, codexPermissionOptions, hunksOf } from "../src/core/codex";
import { AGENT_REGISTRY, registryAgent } from "../src/core/agents";
import type { Connection } from "../src/core/providers";
import type { AgentSessionInfo, AgentState } from "../src/core/types";
import { AgentHub, type TurnHandlers } from "../src/service/agents";
import { MAX_CODEX_THREADS } from "../src/service/codex";
import { ChildHost } from "./childHost";

const FAKE = path.join(import.meta.dir, "fixtures", "fakeCodex.mjs");
const NODE = process.execPath;
const PROC = "dev.paperboard.ai.agent.agent-0000000d";

let host: ChildHost;
let dir: string;
let project: string;
let states: Record<string, AgentState | null>;
let infos: Record<string, AgentSessionInfo | null>;
let hub: AgentHub;
const c: Connection = { id: "agent-0000000d", kind: "agent", label: "Codex", agent: "codex" };

function makeHubDeps(options: { idleMs?: number; cancelGraceMs?: number } = {}): ConstructorParameters<typeof AgentHub>[0] {
    return {
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
    };
}

function collect(): { handlers: TurnHandlers; updates: Record<string, unknown>[]; text: () => string; thoughts: () => string } {
    const updates: Record<string, unknown>[] = [];
    const join = (kind: string) =>
        updates
            .filter((u) => u.sessionUpdate === kind)
            .map((u) => (u.content as { text: string }).text)
            .join("");
    return {
        updates,
        handlers: { onUpdate: (u) => updates.push(u), requestPermission: async () => null },
        text: () => join("agent_message_chunk"),
        thoughts: () => join("agent_thought_chunk"),
    };
}

const text = (t: string) => [{ type: "text" as const, text: t }];
const logged = (name: string) =>
    fs.existsSync(path.join(dir, name))
        ? fs
              .readFileSync(path.join(dir, name), "utf8")
              .trim()
              .split("\n")
              .map((l) => JSON.parse(l))
        : [];
const requests = (method: string) => logged("requests.log").filter((r: { method: string }) => r.method === method);
const open = (conversationId: string, extra: { sessionId?: string; mode?: string; model?: string } = {}) => hub.openSession({ conversationId, connection: c, cwd: project, ...extra });
const send = (sessionId: string, t: string, turn = collect(), signal = new AbortController().signal) => hub.prompt(c, sessionId, text(t), turn.handlers, signal);

async function until(cond: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error("timed out waiting");
        await new Promise((r) => setTimeout(r, 10));
    }
}

beforeEach(() => {
    host = new ChildHost();
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pb-codex-")));
    project = path.join(dir, "project");
    fs.mkdirSync(project);
    states = {};
    infos = {};
    hub = new AgentHub(makeHubDeps());
});

afterEach(async () => {
    await hub.stopAll().catch(() => undefined);
    await host.stopAll();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("Codex bridge", () => {
    it("is the built-in Codex, listed first in place of the registry's adapter", () => {
        expect(AGENT_REGISTRY[0]).toMatchObject({ id: "codex", name: "Codex", command: "codex", install: { kind: "npm", package: "@openai/codex" } });
        expect(registryAgent("codex-acp")).toBeUndefined();
    });

    it("runs every chat's thread in one app server and streams each reply once", async () => {
        const opened = await open("c1");
        expect(opened).toMatchObject({ resumed: false, capabilities: { image: true, embeddedContext: true } });
        expect(states[c.id]).toMatchObject({ status: "ready", name: "Codex", version: "9.9.9" });
        expect(host.starts[0]).toMatchObject({ id: PROC, cwd: dir });
        expect(logged("starts.log")[0].flags).toEqual(["app-server"]);
        // initialize, then initialized, before anything else
        expect(logged("requests.log").slice(0, 2).map((r: { method: string }) => r.method)).toEqual(["initialize", "initialized"]);
        expect(requests("initialize")[0].params.capabilities.optOutNotificationMethods).toContain("account/rateLimits/updated");
        expect(requests("thread/start")[0].params).toMatchObject({ cwd: project, approvalPolicy: "untrusted", sandbox: "workspace-write" });
        expect(infos.c1).toEqual({ modes: expect.arrayContaining([expect.objectContaining({ id: "plan" })]), mode: "default", commands: [] });

        const turn = collect();
        expect(await send(opened.sessionId, "hello", turn)).toBe("end_turn");
        expect(turn.text()).toBe("Hello\n\nBye");
        expect(turn.thoughts()).toBe("Thinking");

        const other = await open("c2");
        expect(other.sessionId).not.toBe(opened.sessionId);
        expect(host.starts).toHaveLength(1);
    });

    it("asks the chat before a file change, and keeps the edit's diff with its result", async () => {
        const opened = await open("c1");
        const asked: unknown[] = [];
        const turn = collect();
        turn.handlers.requestPermission = async (toolCall, options) => {
            asked.push({ id: toolCall.toolCallId, title: toolCall.title, options: options.map((o) => `${o.id}:${o.kind}`) });
            return "acceptForSession";
        };
        await send(opened.sessionId, "edit", turn);
        const file = path.join(project, "a.txt");
        expect(asked).toEqual([{ id: "fc-1", title: `Edit ${file}`, options: ["accept:allow_once", "acceptForSession:allow_always", "decline:reject_once"] }]);
        expect(logged("answers.log")).toEqual([{ decision: "acceptForSession" }]);
        expect(turn.updates.find((u) => u.sessionUpdate === "tool_call_update")).toMatchObject({
            toolCallId: "fc-1",
            status: "completed",
            content: [{ type: "diff", path: file, oldText: "one\ntwo\nthree", newText: "one\nTWO\nthree" }],
        });
        expect(turn.text()).toBe("Done");
    });

    it("offers the decisions Codex lists for a command, and sends a chosen amendment back as offered", async () => {
        const opened = await open("c1");
        const turn = collect();
        let offered: string[] = [];
        turn.handlers.requestPermission = async (toolCall, options) => {
            offered = options.map((o) => o.id);
            expect(toolCall).toMatchObject({ toolCallId: "cmd-1", title: "touch x", kind: "execute" });
            return "acceptWithExecpolicyAmendment";
        };
        await send(opened.sessionId, "run", turn);
        expect(offered).toEqual(["accept", "acceptWithExecpolicyAmendment", "cancel"]);
        expect(logged("answers.log")).toEqual([{ decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["touch", "x"] } } }]);
        expect(turn.updates.find((u) => u.sessionUpdate === "tool_call_update")).toMatchObject({ status: "completed", content: [{ type: "content", content: { type: "text", text: "ran" } }] });
    });

    it("rejects with the one way Codex offers to say no", async () => {
        const opened = await open("c1");
        const turn = collect();
        turn.handlers.requestPermission = async () => "cancel";
        expect(await send(opened.sessionId, "run", turn)).toBe("cancelled");
        expect(logged("answers.log")).toEqual([{ decision: "cancel" }]);
        expect(turn.updates.find((u) => u.sessionUpdate === "tool_call_update")).toMatchObject({ status: "failed" });
    });

    it("in Accept edits, applies edits inside the project without asking and still asks for others", async () => {
        const opened = await open("c1", { mode: "acceptEdits" });
        const turn = collect();
        const asked: string[] = [];
        turn.handlers.requestPermission = async (toolCall) => {
            asked.push(toolCall.title as string);
            return "decline";
        };
        await send(opened.sessionId, "edit", turn);
        expect(asked).toEqual([]);
        await send(opened.sessionId, "outside", turn);
        expect(asked).toEqual(["Edit /elsewhere/a.txt"]);
        expect(logged("answers.log")).toEqual([{ decision: "accept" }, { decision: "decline" }]);
    });

    it("runs Plan read-only and switches a thread's policy from its next turn", async () => {
        const opened = await open("c1", { mode: "plan" });
        expect(requests("thread/start")[0].params).toMatchObject({ approvalPolicy: "never", sandbox: "read-only" });
        expect(infos.c1?.mode).toBe("plan");
        await hub.setMode(c, "c1", "default");
        expect(infos.c1?.mode).toBe("default");
        const turn = collect();
        await send(opened.sessionId, "policy", turn);
        expect(JSON.parse(turn.text())).toEqual({ approvalPolicy: "untrusted", sandbox: { type: "workspaceWrite" } });
        // unchanged since, so the next turn sends no policy
        await send(opened.sessionId, "policy");
        expect(requests("turn/start")[1].params.approvalPolicy).toBeUndefined();
        await expect(hub.setMode(c, "c1", "yolo")).rejects.toThrow('no mode "yolo"');
    });

    it("runs No sandbox with nothing asked and nothing fenced", async () => {
        const opened = await open("c1", { mode: "no-sandbox" });
        expect(requests("thread/start")[0].params).toMatchObject({ approvalPolicy: "never", sandbox: "danger-full-access" });
        await hub.setMode(c, "c1", "default");
        await hub.setMode(c, "c1", "no-sandbox");
        const turn = collect();
        await send(opened.sessionId, "policy", turn);
        expect(JSON.parse(turn.text())).toEqual({ approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } });
    });

    it("shows Codex's plan", async () => {
        const opened = await open("c1");
        const turn = collect();
        await send(opened.sessionId, "plan", turn);
        expect(turn.updates).toContainEqual({ sessionUpdate: "plan", entries: [{ content: "Read", status: "completed" }, { content: "Write", status: "in_progress" }] });
    });

    it("sends a message larger than one process write, whole", async () => {
        const opened = await open("c1");
        const big = "x".repeat(200_000);
        const turn = collect();
        await send(opened.sessionId, `echo ${big}`, turn);
        expect(JSON.parse(turn.text())[0]).toEqual({ type: "text", text: `echo ${big}`, text_elements: [] });
        expect(Math.max(...host.writes.map((w) => w.length))).toBeLessThanOrEqual(65536);
    });

    it("interrupts a turn the chat stops", async () => {
        const opened = await open("c1");
        const stop = new AbortController();
        const reply = send(opened.sessionId, "hang", collect(), stop.signal);
        setTimeout(() => stop.abort(), 50);
        expect(await reply).toBe("cancelled");
        expect(requests("turn/interrupt")).toHaveLength(1);
        expect(host.children.size).toBe(1);
    });

    it("stops a Codex that ignores the interrupt, and observes its exit", async () => {
        hub = new AgentHub(makeHubDeps({ cancelGraceMs: 100 }));
        const opened = await open("c1");
        const stop = new AbortController();
        const reply = send(opened.sessionId, "deaf", collect(), stop.signal);
        setTimeout(() => stop.abort(), 50);
        await expect(reply).rejects.toThrow("Codex was stopped.");
        expect(host.children.size).toBe(0);
        expect(states[c.id]?.status).toBe("stopped");
        expect(infos.c1).toBeNull();
    });

    it("reports a crash with what Codex printed", async () => {
        const opened = await open("c1");
        await expect(send(opened.sessionId, "crash")).rejects.toThrow("Codex stopped (exit code 3): boom: codex fell over");
        expect(states[c.id]).toMatchObject({ status: "error", errorDetail: "boom: codex fell over" });
    });

    it("fails a turn in Codex's own words, not its retries", async () => {
        const opened = await open("c1");
        await expect(send(opened.sessionId, "overloaded")).rejects.toThrow("The model is overloaded.");
    });

    it("says how to sign in when nobody is signed in to Codex", async () => {
        fs.writeFileSync(path.join(dir, "signed-out"), "");
        await expect(open("c1")).rejects.toThrow('Codex is not signed in. Run "codex login" in a terminal, then try again.');
        expect(states[c.id]).toMatchObject({ status: "auth-required", error: expect.stringContaining("codex login") });
        expect(requests("thread/start")).toHaveLength(0);

        fs.rmSync(path.join(dir, "signed-out"));
        const opened = await open("c1");
        expect(states[c.id]?.status).toBe("ready");
        // a sign-in that lapses shows the same way
        await expect(send(opened.sessionId, "unauthorized")).rejects.toThrow("codex login");
        expect(states[c.id]?.status).toBe("auth-required");
    });

    it("resumes the chat's thread in a new process, or starts fresh when the thread is gone", async () => {
        const first = await open("c1");
        await hub.stop(c.id);
        expect(host.children.size).toBe(0);
        const again = await open("c1", { sessionId: first.sessionId });
        expect(again).toMatchObject({ sessionId: first.sessionId, resumed: true });
        expect(requests("thread/resume")[0].params).toMatchObject({ threadId: first.sessionId, cwd: project, excludeTurns: true });

        await hub.stop(c.id);
        const gone = await open("c2", { sessionId: "01a13eea-0000-7000-8000-000000000000" });
        expect(gone.resumed).toBe(false);
        expect(gone.sessionId).not.toBe("01a13eea-0000-7000-8000-000000000000");
    });

    it("lists Codex's models across pages, and runs a chat on its model", async () => {
        const told: unknown[] = [];
        hub = new AgentHub({ ...makeHubDeps(), onModels: (_id, models) => told.push(models) });
        const offered = [
            { id: "gpt-test", name: "GPT-Test", description: "The default" },
            { id: "gpt-mini", name: "GPT-Mini", description: "Fast" },
        ];
        expect(await hub.models(c)).toEqual(offered);
        expect(told).toEqual([offered]);

        const opened = await open("c1", { model: "gpt-mini" });
        expect(requests("thread/start")[0].params.model).toBe("gpt-mini");
        const turn = collect();
        await send(opened.sessionId, "model", turn);
        expect(turn.text()).toBe("gpt-mini");
        await open("c1", { model: "gpt-test" });
        const again = collect();
        await send(opened.sessionId, "model", again);
        expect(again.text()).toBe("gpt-test");
        // a chat made before models were listed names the agent, which is not a model
        await open("c1", { model: "Codex" });
        await send(opened.sessionId, "model");
        expect(requests("turn/start")[2].params.model).toBe("gpt-test");
    });

    it("keeps a bounded number of threads open, letting go of the one idle longest", async () => {
        const first = await open("c0");
        for (let i = 1; i <= MAX_CODEX_THREADS; i++) await open(`c${i}`);
        expect(infos.c0).toBeNull();
        await until(() => requests("thread/unsubscribe").length === 1);
        expect(requests("thread/unsubscribe")[0].params).toEqual({ threadId: first.sessionId });
        expect(host.starts).toHaveLength(1);
    });

    it("stops an idle app server and observes the exit", async () => {
        hub = new AgentHub(makeHubDeps({ idleMs: 50 }));
        const opened = await open("c1");
        await send(opened.sessionId, "hello");
        await until(() => states[c.id]?.status === "stopped");
        expect(host.children.size).toBe(0);
    });

    it("stops an app server an earlier service run left", async () => {
        await host.start({ id: PROC, command: NODE, args: [FAKE, dir], cwd: dir, env: {} });
        await hub.stopLeftovers([c]);
        expect(host.children.size).toBe(0);
    });

    it("checks Codex and its sign-in without a chat", async () => {
        await hub.check(c);
        expect(states[c.id]).toMatchObject({ status: "ready" });
        expect(requests("account/read")).toHaveLength(1);
        expect(requests("thread/start")).toHaveLength(0);
    });
});

describe("Codex translation", () => {
    it("reads an edit's hunks as before and after", () => {
        expect(hunksOf("@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n@@ -9 +9,2 @@\n-x\n+y\n+z\n")).toEqual([
            { oldText: "a\nb", newText: "a\nB" },
            { oldText: "x", newText: "y\nz" },
        ]);
    });

    it("shows a new file whole and a deleted one by name", () => {
        const t = new CodexTranslator();
        const item = {
            type: "fileChange",
            id: "f",
            status: "inProgress",
            changes: [
                { path: "/p/new.txt", kind: { type: "add" }, diff: "a\nb\n" },
                { path: "/p/old.txt", kind: { type: "delete" }, diff: "" },
            ],
        };
        expect(t.updates("item/started", { item })).toEqual([
            {
                sessionUpdate: "tool_call",
                toolCallId: "f",
                status: "in_progress",
                title: "Edit 2 files",
                kind: "edit",
                content: [{ type: "diff", path: "/p/new.txt", oldText: null, newText: "a\nb\n" }],
                locations: [{ path: "/p/new.txt" }, { path: "/p/old.txt" }],
            },
        ]);
    });

    it("offers allow, allow for this chat and reject when Codex lists no decisions", () => {
        expect(codexPermissionOptions({}).map((o) => o.kind)).toEqual(["allow_once", "allow_always", "reject_once"]);
    });
});
