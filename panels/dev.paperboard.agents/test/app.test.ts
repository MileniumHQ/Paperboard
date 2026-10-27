import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_STATE, type AiState, type Settings } from "../src/contract";
import { AiApp, parseSettings, type AppHost } from "../src/service/app";
import { CONTEXT_BUDGET, QUIET_MS, TURN_PROC_ID } from "../src/service/conversation";
import { FakeProcesses, until } from "./fakeHost";

describe("settings are validated by the service", () => {
    test("parseSettings", () => {
        expect(parseSettings({ name: " Pip ", harness: "codex", model: "default" })).toEqual({ name: "Pip", harness: "codex", model: null, compaction: "summarize" });
        expect(parseSettings({ name: "Pip", harness: "claude-code", model: "claude-opus-5-5", compaction: "forget" })).toEqual({ name: "Pip", harness: "claude-code", model: "claude-opus-5-5", compaction: "forget" });
        expect(parseSettings({ name: "Pip", harness: "codex", compaction: "shrink" })).toBeNull();
        expect(parseSettings({ name: "", harness: "codex" })).toBeNull();
        expect(parseSettings({ name: "x".repeat(33), harness: "codex" })).toBeNull();
        expect(parseSettings({ name: "Pip", harness: "ollama" })).toBeNull();
        // a model is one argv value, never flags or shell text
        expect(parseSettings({ name: "Pip", harness: "codex", model: "--dangerously-bypass" })).toBeNull();
        expect(parseSettings({ name: "Pip", harness: "codex", model: "a b" })).toBeNull();
    });

});

describe("the service's agent", () => {
    let dir = "";
    let app: AiApp | null = null;
    afterEach(async () => {
        await app?.shutdown();
        app = null;
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    async function start(installed: string[], saved: unknown = null, readSettings?: () => Promise<unknown>) {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-app-"));
        const procs = new FakeProcesses();
        const writes: Settings[] = [];
        const vault = new Map<string, string>();
        const toolDocs: unknown[] = [];
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
            readSettings: readSettings ?? (async () => saved),
            writeSettings: async (s) => void writes.push(s),
            harnessHomes: { claude: "/nonexistent/claude", codex: path.join(dir, "codex") },
            which: (c) => (installed.includes(c) ? `/usr/bin/${c}` : null),
            tools: {
                write: async () => {},
                readTools: async () => null,
                writeTools: async (c) => void toolDocs.push(c),
                vault: {
                    get: async (n) => vault.get(n) ?? null,
                    set: async (n, v) => void vault.set(n, v),
                    delete: async (n) => vault.delete(n),
                    list: async () => [...vault.keys()],
                },
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
        });
        return { app, procs, writes, vault, toolDocs, state: () => state };
    }

    test("hydrates saved settings, and an invalid saved document is no settings", async () => {
        expect((await start(["codex"], { name: "Pip", harness: "codex", model: null })).state().settings).toEqual({ name: "Pip", harness: "codex", model: null, compaction: "summarize" });
        await app!.shutdown();
        app = null;
        expect((await start(["codex"], { name: "Pip", harness: "nope" })).state().settings).toBeNull();
    });

    test("a fresh install starts with no settings and writes none", async () => {
        const fresh = await start(["codex"]);
        expect(fresh.state().settings).toBeNull();
        expect(fresh.writes).toEqual([]);
    });

    test("a service that fails to start fails its actions instead of leaving them waiting", async () => {
        const failing = start(["codex"], null, async () => {
            throw new Error('Invalid config path: "agent"');
        });
        await expect(failing).rejects.toThrow("Invalid config path");
        await expect(app!.ready()).rejects.toThrow(/didn't start: Invalid config path/);
        app = null;
    });

    test("detect reports what's installed", async () => {
        const { app } = await start(["claude"]);
        expect(app.detect()).toEqual([
            { id: "codex", installed: false, version: null },
            { id: "claude-code", installed: true, version: null },
            { id: "opencode", installed: false, version: null },
        ]);
    });

    test("setup saves only valid settings for a harness that's installed", async () => {
        const { app, writes, state } = await start(["claude"]);
        await expect(app.setup({ settings: { name: "Pip", harness: "codex", model: null } })).rejects.toThrow(/Codex isn't installed/);
        await expect(app.setup({ settings: { name: "", harness: "claude-code" } })).rejects.toThrow(/required/);
        expect(writes).toEqual([]);
        await app.setup({ settings: { name: "Pip", harness: "claude-code", model: "default" } });
        expect(writes).toEqual([{ name: "Pip", harness: "claude-code", model: null, compaction: "summarize" }]);
        expect(state().settings).toEqual({ name: "Pip", harness: "claude-code", model: null, compaction: "summarize" });
    });

    test("a tool server's secret goes to the vault under this panel; the saved config only names it", async () => {
        const { app, vault, toolDocs } = await start(["codex"]);
        expect((await app.toolsView()).config).toEqual({ actions: true, servers: [] });
        await app.toolsSave({ server: { name: "github", transport: "stdio", command: "npx", args: ["-y", "gh-mcp"], env: { GITHUB_TOKEN: { secret: "github-token" } } } });
        const view = await app.toolsSetSecret({ server: "github", name: "github-token", value: "ghp_realvalue" });
        expect([...vault.entries()]).toEqual([["mcp.github.github-token", "ghp_realvalue"]]);
        expect(JSON.stringify(toolDocs)).not.toContain("ghp_realvalue");
        // the view the UI gets lists names, never values
        expect(JSON.stringify(view)).not.toContain("ghp_realvalue");
        expect(view.secrets).toEqual({ github: ["github-token"] });
        await app.toolsSetActions({ on: false });
        expect((await app.toolsView()).config.actions).toBe(false);
        await app.toolsRemove({ name: "github" });
        expect(vault.size).toBe(0);
    });

    test("a message sent mid-turn reaches the agent with its next tool's result, and that turn answers it", async () => {
        const { app, procs, state } = await start(["codex"], { name: "Pip", harness: "codex", model: null });
        app.conversation.send("find me a flight to Oslo");
        await until(() => procs.started.length === 1);
        const turn = procs.started[0]!;
        const url = JSON.parse(turn.args.find((a) => a.startsWith("mcp_servers.paperboard.url="))!.split("=").slice(1).join("="));
        const call = async (text: string) => {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${turn.env!.PAPERBOARD_COMPUTER_MCP_TOKEN}` },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_message", arguments: { text } } }),
            });
            return ((await res.json()) as { result: { content: { text: string }[] } }).result.content[0]!.text;
        };

        const train = app.conversation.send("actually, make it a train");
        expect(train.waiting).toBe(true);
        expect(state().chat.waiting.map((m) => m.text)).toEqual(["actually, make it a train"]);
        // the user may still be typing: it's held for them to finish
        expect(await call("Looking")).toMatch(/^sent \[\w+\]$/);
        await new Promise((r) => setTimeout(r, QUIET_MS));

        const read = await call("On it, looking for flights");
        expect(read).toMatch(/^sent \[\w+\]\n\n\[new messages from the user, sent while you were working\]\n/);
        expect(read).toEndWith(`[${train.id}] actually, make it a train`);
        // read now: no longer waiting, and part of the conversation
        expect(state().chat.waiting).toEqual([]);
        expect(app.conversation.history().map((e) => (e.kind === "user" || e.kind === "agent" ? e.text : e.kind))).toEqual([
            "find me a flight to Oslo",
            "Looking",
            "On it, looking for flights",
            "actually, make it a train",
        ]);
        // read once: the next result carries nothing new
        expect(await call("Trains it is!")).toMatch(/^sent \[\w+\]$/);

        procs.exit(TURN_PROC_ID, 0);
        await until(() => state().chat.busy === false);
        // it was answered in that turn: no second turn, no error
        expect(procs.started.length).toBe(1);
        expect(app.conversation.history().some((e) => e.kind === "error")).toBe(false);
    });

    test("while it summarizes the conversation, the agent's tools are refused: it writes from what it knows", async () => {
        const { app, procs, state } = await start(["codex"], { name: "Pip", harness: "codex", model: null });
        app.conversation.send("hi");
        await until(() => procs.started.length === 1);
        procs.stdout(TURN_PROC_ID, `{"type":"thread.started","thread_id":"t-1"}\n` + JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hey" } }) + "\n");
        // Codex's rollout says the thread is past the budget
        const day = path.join(dir, "codex", "sessions", "2026", "10", "26");
        fs.mkdirSync(day, { recursive: true });
        const count = { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: CONTEXT_BUDGET }, model_context_window: 1_000_000 } } };
        fs.writeFileSync(path.join(day, "rollout-2026-10-26T10-00-00-t-1.jsonl"), JSON.stringify(count) + "\n");
        procs.exit(TURN_PROC_ID, 0);
        await until(() => procs.started.length === 2);
        expect(state().chat.compacting).toBe(true);
        const turn = procs.started[1]!;
        const url = JSON.parse(turn.args.find((a) => a.startsWith("mcp_servers.paperboard.url="))!.split("=").slice(1).join("="));
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${turn.env!.PAPERBOARD_COMPUTER_MCP_TOKEN}` },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_message", arguments: { text: "brb" } } }),
        });
        const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
        expect(body.result.isError).toBe(true);
        expect(body.result.content[0]!.text).toContain("You're writing a summary of the conversation");
        expect(app.conversation.history().map((e) => (e.kind === "agent" ? e.text : e.kind))).toEqual(["user", "hey"]);
    });
});
