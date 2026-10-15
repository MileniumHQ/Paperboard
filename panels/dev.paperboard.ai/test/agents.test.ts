// Coding agents over ACP, end to end over real stdio: a fake agent process
// (fixtures/fakeAcpAgent.mjs) speaks JSON-RPC on its pipes, and the hub
// starts it, opens sessions, runs turns, answers permission requests, and
// observes every stop through the exit event.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import path from "node:path";
import { AgentAuthError, AgentHub, type TurnHandlers } from "../src/service/agents";
import type { Connection } from "../src/core/providers";
import { NO_SANDBOX_MODE } from "../src/core/permissionMode";
import type { AgentSessionInfo, AgentState } from "../src/core/types";
import { ChildHost } from "./childHost";

const AGENT = path.join(import.meta.dir, "fixtures", "fakeAcpAgent.mjs");
const NODE = process.execPath;

let host: ChildHost;
let states: Record<string, AgentState | null>;
let infos: Record<string, AgentSessionInfo | null>;
let hub: AgentHub;

function connection(args: string[] = [], id = "agent-0000000a"): Connection {
    return { id, kind: "agent", label: "Fake", agent: "custom", command: NODE, args: [AGENT, ...args] };
}

function makeHub(options: { idleMs?: number; cancelGraceMs?: number; resolve?: () => Promise<never> } = {}): AgentHub {
    return new AgentHub(makeHubDeps(options));
}

function makeHubDeps(options: { idleMs?: number; cancelGraceMs?: number; resolve?: () => Promise<never> } = {}): ConstructorParameters<typeof AgentHub>[0] {
    return {
        host,
        procId: (id) => `dev.paperboard.ai.agent.${id}`,
        resolve: options.resolve ?? (async (c) => ({ command: c.command!, args: c.args!, pathEnv: process.env.PATH ?? "" })),
        workDir: import.meta.dir,
        clientVersion: "0.0.0-test",
        onState: (id, s) => (states[id] = s),
        onSessionInfo: (id, info) => (infos[id] = info),
        idleMs: options.idleMs ?? 60_000,
        initTimeoutMs: 5_000,
        stopTimeoutMs: 2_000,
        cancelGraceMs: options.cancelGraceMs ?? 2_000,
    };
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

async function until(cond: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error("timed out waiting");
        await new Promise((r) => setTimeout(r, 10));
    }
}

beforeEach(() => {
    host = new ChildHost();
    states = {};
    infos = {};
    hub = makeHub();
});

afterEach(async () => {
    await hub.stopAll().catch(() => undefined);
    await host.stopAll();
});

describe("agent hub", () => {
    it("starts the agent, opens a session in the chat's folder and streams a reply", async () => {
        const c = connection();
        const opened = await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" });
        expect(opened).toEqual({ sessionId: "s1", resumed: false, capabilities: { image: false, embeddedContext: true } });
        expect(states[c.id]).toMatchObject({ status: "ready", name: "Fake Agent", version: "1.2.3" });
        expect(host.starts[0]).toMatchObject({ id: "dev.paperboard.ai.agent.agent-0000000a", command: NODE, args: [AGENT] });

        const turn = collect();
        expect(await hub.prompt(c, "s1", text("hello"), turn.handlers, new AbortController().signal)).toBe("end_turn");
        expect(turn.text()).toBe("Hi there");
        // modes from session/new and commands from the agent's notification
        await until(() => (infos.c1?.commands.length ?? 0) > 0);
        // the panel's No sandbox follows the agent's own modes
        expect(infos.c1).toEqual({ modes: [{ id: "ask", name: "Ask" }, { id: "code", name: "Code", description: "Edits files" }, NO_SANDBOX_MODE], mode: "ask", commands: [{ name: "review", description: "Review changes" }] });
    });

    it("sends a message larger than one process write, whole", async () => {
        const c = connection();
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" });
        const big = "x".repeat(200_000);
        const turn = collect();
        await hub.prompt(c, "s1", text(`echo ${big}`), turn.handlers, new AbortController().signal);
        expect(JSON.parse(turn.text())[0].text).toBe(`echo ${big}`);
        expect(Math.max(...host.writes.map((w) => w.length))).toBeLessThanOrEqual(65536);
    });

    it("asks the chat for permission and returns the chosen option", async () => {
        const c = connection();
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" });
        const asked: unknown[] = [];
        const turn = collect();
        turn.handlers.requestPermission = async (toolCall, options) => {
            asked.push({ toolCall, options });
            return "yes";
        };
        await hub.prompt(c, "s1", text("edit"), turn.handlers, new AbortController().signal);
        expect(asked).toEqual([
            {
                toolCall: { toolCallId: "t1" },
                options: [
                    { id: "yes", name: "Allow", kind: "allow_once" },
                    { id: "no", name: "Reject", kind: "reject_once" },
                ],
            },
        ]);
        expect(turn.text()).toBe("Edited");
        expect(turn.updates.map((u) => u.sessionUpdate)).toEqual(["agent_thought_chunk", "tool_call", "tool_call_update", "agent_message_chunk"]);
    });

    it("cancels a turn when the chat stops it", async () => {
        const c = connection();
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" });
        const stop = new AbortController();
        const reply = hub.prompt(c, "s1", text("hang"), collect().handlers, stop.signal);
        setTimeout(() => stop.abort(), 50);
        expect(await reply).toBe("cancelled");
        expect(states[c.id]?.status).toBe("ready");
    });

    it("restarts an agent that ignores cancel, and observes its exit", async () => {
        hub = makeHub({ cancelGraceMs: 100 });
        const c = connection();
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" });
        const stop = new AbortController();
        const reply = hub.prompt(c, "s1", text("deaf"), collect().handlers, stop.signal);
        setTimeout(() => stop.abort(), 50);
        await expect(reply).rejects.toThrow("Fake was stopped.");
        expect(host.children.size).toBe(0);
        expect(states[c.id]?.status).toBe("stopped");
        expect(infos.c1).toBeNull();
    });

    it("reports a crash with what the agent printed, and starts fresh next time", async () => {
        const c = connection();
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" });
        await expect(hub.prompt(c, "s1", text("crash"), collect().handlers, new AbortController().signal)).rejects.toThrow(
            "Fake stopped unexpectedly (exit code 3).",
        );
        expect(states[c.id]).toMatchObject({ status: "error", errorDetail: "boom: the agent fell over" });
        const again = await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" });
        expect(again.resumed).toBe(false);
        expect(host.starts).toHaveLength(2);
    });

    it("resumes a chat's earlier session after the agent restarts", async () => {
        const c = connection();
        const first = await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" });
        await hub.stop(c.id);
        expect(host.children.size).toBe(0);
        const again = await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w", sessionId: first.sessionId });
        expect(again).toMatchObject({ sessionId: first.sessionId, resumed: true });
    });

    it("needs a sign-in before a session, and opens one after", async () => {
        const c = connection(["--auth"]);
        await expect(hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" })).rejects.toBeInstanceOf(AgentAuthError);
        expect(states[c.id]).toMatchObject({ status: "auth-required", authMethods: [{ id: "login", name: "Log in", description: "Opens a browser" }] });
        await expect(hub.authenticate(c, "other")).rejects.toThrow("That sign-in method is not offered.");
        await hub.authenticate(c, "login");
        expect(states[c.id]?.status).toBe("ready");
        expect((await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" })).sessionId).toBe("s1");
    });

    it("applies a chat's saved mode when its session opens", async () => {
        const c = connection();
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w", mode: "code" });
        expect(infos.c1?.mode).toBe("code");
    });

    it("offers No sandbox after the agent's modes, and keeps the agent's own mode under it", async () => {
        const c = connection();
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w", mode: "no-sandbox" });
        expect(infos.c1?.modes.map((m) => m.id)).toEqual(["ask", "code", "no-sandbox"]);
        // the fake agent refuses a mode it does not offer: the panel's own is never sent
        expect(infos.c1?.mode).toBe("no-sandbox");
        await hub.setMode(c, "c1", "code");
        expect(infos.c1?.mode).toBe("code");
        await hub.setMode(c, "c1", "no-sandbox");
        expect(infos.c1?.mode).toBe("no-sandbox");
    });

    it("stops an idle agent and observes the exit", async () => {
        hub = makeHub({ idleMs: 50 });
        const c = connection();
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" });
        await hub.prompt(c, "s1", text("hello"), collect().handlers, new AbortController().signal);
        await until(() => states[c.id]?.status === "stopped");
        expect(host.children.size).toBe(0);
    });

    it("shows why an agent can't be started without running anything", async () => {
        hub = makeHub({ resolve: async () => Promise.reject(new Error("Fake isn't installed on this computer.")) });
        const c = connection();
        await expect(hub.check(c)).rejects.toThrow("Fake isn't installed on this computer.");
        expect(states[c.id]).toMatchObject({ status: "error", error: "Fake isn't installed on this computer." });
        expect(host.starts).toHaveLength(0);
    });

    it("stops a process an earlier service run left behind before starting its own", async () => {
        const c = connection();
        await host.start({ id: "dev.paperboard.ai.agent.agent-0000000a", command: NODE, args: [AGENT], cwd: import.meta.dir, env: {} });
        await hub.stopLeftovers([c]);
        expect(host.children.size).toBe(0);
    });

    it("lists the agent's models and switches a chat's session to its model", async () => {
        const told: unknown[] = [];
        hub = new AgentHub({ ...makeHubDeps(), onModels: (id, models) => told.push({ id, models }) });
        const c = connection(["--models", "config"]);
        // grouped options are one list
        const offered = [
            { id: "big", name: "Big Model", description: "Thinks hard" },
            { id: "small", name: "Small Model" },
            { id: "auto", name: "Auto" },
        ];
        expect(await hub.models(c)).toEqual(offered);
        expect(told).toEqual([{ id: c.id, models: offered }]);

        const opened = await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w", model: "small" });
        const turn = collect();
        await hub.prompt(c, opened.sessionId, text("model"), turn.handlers, new AbortController().signal);
        expect(turn.text()).toBe("small");
        // the open session follows a model change on its next message
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w", model: "big" });
        const again = collect();
        await hub.prompt(c, opened.sessionId, text("model"), again.handlers, new AbortController().signal);
        expect(again.text()).toBe("big");
        // a model the agent does not offer is not sent
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w", model: "Fake" });
        expect(told).toHaveLength(1);
    });

    it("switches models the older draft's way too", async () => {
        const c = connection(["--models", "legacy"]);
        expect((await hub.models(c)).map((m) => m.id)).toEqual(["big", "small", "auto"]);
        const opened = await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w", model: "small" });
        const turn = collect();
        await hub.prompt(c, opened.sessionId, text("model"), turn.handlers, new AbortController().signal);
        expect(turn.text()).toBe("small");
    });

    it("lists no models for an agent that picks its own", async () => {
        expect(await hub.models(connection())).toEqual([]);
    });

    it("refuses to stop an agent mid-reply", async () => {
        const c = connection();
        await hub.openSession({ conversationId: "c1", connection: c, cwd: "/w" });
        const stop = new AbortController();
        const reply = hub.prompt(c, "s1", text("hang"), collect().handlers, stop.signal);
        await expect(hub.stop(c.id)).rejects.toThrow("Fake is replying. Stop it first.");
        stop.abort();
        expect(await reply).toBe("cancelled");
    });
});
