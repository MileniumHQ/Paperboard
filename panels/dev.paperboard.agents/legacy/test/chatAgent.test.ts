// A coding agent's chat, end to end: the chat engine, a real agent hub, and
// the fake ACP agent over real stdio, with a real conversation store.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChatEngine } from "../src/service/chat";
import { ConversationStore } from "../src/service/store";
import { AgentHub, type SessionRequest } from "../src/service/agents";
import type { Connection } from "../src/core/providers";
import type { AgentSessionInfo, AssistantMessage, PendingApproval, Settings } from "../src/core/types";
import { DEFAULT_SETTINGS } from "../src/core/types";
import { ChildHost } from "./childHost";

const AGENT = path.join(import.meta.dir, "fixtures", "fakeAcpAgent.mjs");
const AGENT_CONNECTION: Connection = { id: "agent-0000000b", kind: "agent", label: "Fake", agent: "custom", command: process.execPath, args: [AGENT] };

let dir: string;
let store: ConversationStore;
let host: ChildHost;
let hub: AgentHub;
let approvals: PendingApproval[];
let finished: { text: string }[];
let infos: Record<string, AgentSessionInfo | null>;
const settings: Settings = { ...DEFAULT_SETTINGS };

/** the fake agent's model, as an agent that lists thinking levels would list it */
const FAKE_EFFORTS = { efforts: ["low", "high"], defaultEffort: "low" };

function engine(agents: Pick<AgentHub, "openSession" | "prompt" | "forget"> = hub): ChatEngine {
    return new ChatEngine({
        ownPanelId: "dev.paperboard.agents",
        clientFor: () => {
            throw new Error("an agent chat never asks for a model client");
        },
        providerOf: () => undefined,
        store,
        settings: () => settings,
        capabilities: () => undefined,
        efforts: (model) => (model === "Fake" ? FAKE_EFFORTS : undefined),
        listActions: async () => [],
        panelNames: async () => ({}),
        callAction: async () => undefined,
        isAllowed: () => false,
        rememberAllowed: async () => {},
        runShell: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        onDelta: () => {},
        onMessage: () => {},
        onReset: () => {},
        onSummaries: () => {},
        onGenerating: () => {},
        onApprovals: (list) => (approvals = list),
        onSpeed: () => {},
        onReplyFinished: (p) => finished.push(p),
        agentConnection: (id) => (id === AGENT_CONNECTION.id ? AGENT_CONNECTION : undefined),
        projectPath: async (project) => (project === "work" ? dir : Promise.reject(new Error(`The project "${project}" no longer exists.`))),
        agents,
        agentMode: (id) => infos[id]?.mode,
    });
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error("timed out waiting");
        await new Promise((r) => setTimeout(r, 5));
    }
}

const assistants = async (id: string) => (await store.get(id)).messages.filter((m): m is AssistantMessage => m.role === "assistant");

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-chat-"));
    store = new ConversationStore(dir);
    await store.load();
    host = new ChildHost();
    hub = new AgentHub({
        host,
        procId: (id) => `dev.paperboard.agents.agent.${id}`,
        resolve: async (c) => ({ command: c.command!, args: c.args!, pathEnv: process.env.PATH ?? "" }),
        workDir: dir,
        clientVersion: "0.0.0-test",
        onState: () => {},
        onSessionInfo: (id, info) => (infos[id] = info),
        stopTimeoutMs: 2_000,
    });
    approvals = [];
    finished = [];
    infos = {};
});

afterEach(async () => {
    await hub.stopAll().catch(() => undefined);
    await host.stopAll();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("agent chats", () => {
    it("needs a project before the agent starts", async () => {
        const chat = engine();
        const c = await chat.create("Fake", AGENT_CONNECTION.id);
        await expect(chat.send(c.id, "hello")).rejects.toThrow("Choose a project for Fake to work in first.");
        expect(host.starts).toHaveLength(0);
    });

    it("keeps the chat's thinking level and opens every turn with it", async () => {
        const opened: SessionRequest[] = [];
        const chat = engine({
            openSession: (request) => {
                opened.push(request);
                return hub.openSession(request);
            },
            prompt: (...a) => hub.prompt(...a),
            forget: (...a) => hub.forget(...a),
        });
        const c = await chat.create("Fake", AGENT_CONNECTION.id, "work");
        // none picked: the model's default
        await (await chat.send(c.id, "hello")).done;
        expect(opened[0]!.effort).toBe("low");
        await expect(chat.setEffort(c.id, "ultra")).rejects.toThrow("doesn't offer that thinking level");
        await chat.setEffort(c.id, "high");
        expect((await store.get(c.id)).effort).toBe("high");
        await (await chat.send(c.id, "hello")).done;
        expect(opened[1]!.effort).toBe("high");
    });

    it("streams the agent's reply into the chat and keeps its session", async () => {
        const chat = engine();
        const c = await chat.create("Fake", AGENT_CONNECTION.id, "work");
        await (await chat.send(c.id, "hello")).done;
        const [reply] = await assistants(c.id);
        expect(reply).toMatchObject({ content: "Hi there", status: "done" });
        expect(finished[0]!.text).toBe("Hi there");
        expect((await store.get(c.id)).sessionId).toBe("s1");
        await (await chat.send(c.id, "again")).done;
        expect((await assistants(c.id))[1]).toMatchObject({ content: "you said again" });
        expect(host.starts).toHaveLength(1);
    });

    it("waits for the user's answer to a permission request, then shows the edit as done", async () => {
        const chat = engine();
        const c = await chat.create("Fake", AGENT_CONNECTION.id, "work");
        const { done } = await chat.send(c.id, "edit");
        await until(() => approvals.length === 1);
        expect(approvals[0]!.options).toEqual([
            { id: "yes", name: "Allow", kind: "allow_once" },
            { id: "no", name: "Reject", kind: "reject_once" },
        ]);
        expect(() => chat.resolveApproval(approvals[0]!.id, "once")).toThrow("Choose one of the answers the agent offered.");
        chat.resolveApproval(approvals[0]!.id, "once", "yes");
        await done;
        const rounds = await assistants(c.id);
        // the tool call's round, then the text after it
        expect(rounds).toHaveLength(2);
        expect(rounds[0]).toMatchObject({ thinking: "I should edit", status: "done" });
        expect(rounds[0]!.toolCalls![0]).toMatchObject({
            label: "Edit a.txt",
            status: "done",
            decision: "once",
            agent: { kind: "edit", diffs: [{ path: "/w/a.txt", oldText: "one\ntwo", newText: "one\n2" }] },
        });
        expect(rounds[1]).toMatchObject({ content: "Edited", status: "done" });
    });

    it("a No sandbox chat allows the agent's request without asking", async () => {
        const chat = engine();
        const c = await chat.create("Fake", AGENT_CONNECTION.id, "work");
        await chat.setMode(c.id, "no-sandbox");
        const { done } = await chat.send(c.id, "edit");
        await done;
        expect(approvals).toEqual([]);
        const rounds = await assistants(c.id);
        expect(rounds[0]!.toolCalls![0]).toMatchObject({ label: "Edit a.txt", status: "done" });
        expect(rounds[1]).toMatchObject({ content: "Edited", status: "done" });
    });

    it("turning No sandbox on answers a request already waiting", async () => {
        const chat = engine();
        const c = await chat.create("Fake", AGENT_CONNECTION.id, "work");
        const { done } = await chat.send(c.id, "edit");
        await until(() => approvals.length === 1);
        await hub.setMode(AGENT_CONNECTION, c.id, "no-sandbox");
        await chat.setMode(c.id, "no-sandbox");
        await done;
        expect(approvals).toEqual([]);
        expect((await assistants(c.id))[1]!.content).toBe("Edited");
        // saved on the reply's working copy: the reply's last save keeps it
        expect((await store.get(c.id)).mode).toBe("no-sandbox");
    });

    it("records a rejected request as denied", async () => {
        const chat = engine();
        const c = await chat.create("Fake", AGENT_CONNECTION.id, "work");
        const { done } = await chat.send(c.id, "edit");
        await until(() => approvals.length === 1);
        chat.resolveApproval(approvals[0]!.id, "deny", "no");
        await done;
        const rounds = await assistants(c.id);
        expect(rounds[0]!.toolCalls![0]).toMatchObject({ status: "denied", decision: "deny" });
        expect(rounds[1]!.content).toBe("Skipped");
    });

    it("stopping a reply cancels the agent's turn and an open request", async () => {
        const chat = engine();
        const c = await chat.create("Fake", AGENT_CONNECTION.id, "work");
        const { done } = await chat.send(c.id, "edit");
        await until(() => approvals.length === 1);
        chat.stop(c.id);
        await done;
        expect(approvals).toEqual([]);
        const rounds = await assistants(c.id);
        expect(rounds.at(-1)!.status).toBe("stopped");
        expect(rounds[0]!.toolCalls![0]).toMatchObject({ status: "error", result: "Stopped before you answered." });
    });

    it("shows the agent's plan and a crash as a failed reply", async () => {
        const chat = engine();
        const c = await chat.create("Fake", AGENT_CONNECTION.id, "work");
        await (await chat.send(c.id, "plan")).done;
        expect((await assistants(c.id))[0]!.plan).toEqual([
            { content: "Read", status: "completed" },
            { content: "Write", status: "in_progress" },
        ]);
        await (await chat.send(c.id, "crash")).done;
        expect((await assistants(c.id)).at(-1)).toMatchObject({ status: "error", error: "Fake stopped unexpectedly (exit code 3)." });
    });

    it("says so when a chat's earlier session can't be resumed", async () => {
        const chat = engine();
        const c = await chat.create("Fake", AGENT_CONNECTION.id, "work");
        await (await chat.send(c.id, "hello")).done;
        const saved = await store.get(c.id);
        saved.sessionId = "lost-session";
        await store.save(saved);
        await hub.stop(AGENT_CONNECTION.id);
        await (await chat.send(c.id, "hello")).done;
        const last = (await assistants(c.id)).at(-1)!;
        expect(last.notice).toBe("Fake started a new session here: it doesn't remember this chat's earlier messages.");
        expect((await store.get(c.id)).sessionId).toBe("s1");
    });

    it("turns the agent's refusal into a failed reply", async () => {
        const chat = engine();
        const c = await chat.create("Fake", AGENT_CONNECTION.id, "work");
        await (await chat.send(c.id, "refuse")).done;
        expect((await assistants(c.id))[0]).toMatchObject({ status: "error", error: "Fake declined to continue." });
    });
});
