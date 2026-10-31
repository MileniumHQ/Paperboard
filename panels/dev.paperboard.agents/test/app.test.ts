import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_STATE, type AiState, type Settings } from "../src/contract";
import { AiApp, parseSettings, type AppHost } from "../src/service/app";
import { CONTEXT_BUDGET, TURN_PROC_ID } from "../src/service/conversation";
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

    // `installed` names the brains' programs that are installed (and signed in) as packages
    // `signedOut` names the installed brains that aren't signed in
    async function start(installed: string[], saved: unknown = null, readSettings?: () => Promise<unknown>, plant?: (storage: string) => void, signedOut: string[] = []) {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-app-"));
        plant?.(dir);
        const packageOf = (program: string) => (program === "claude" ? "claude-code" : program);
        for (const program of installed) {
            fs.mkdirSync(path.join(dir, "packages", packageOf(program), "bin"), { recursive: true });
            fs.writeFileSync(path.join(dir, "packages", packageOf(program), "bin", program), "#!/bin/sh\n", { mode: 0o755 });
        }
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
            // what the brains answer when asked who they're signed in as
            exec: async (command, args) => {
                const out = signedOut.some((p) => command.endsWith(p));
                if (args.join(" ") === "login status") return out ? { stdout: "Not logged in", stderr: "", exitCode: 1 } : { stdout: "Logged in using ChatGPT", stderr: "", exitCode: 0 };
                if (args.join(" ") === "auth status") return { stdout: JSON.stringify({ loggedIn: !out, email: "pip@example.com" }), stderr: "", exitCode: out ? 1 : 0 };
                if (args[0] === "auth" && args[1] === "list") return { stdout: "[]", stderr: "", exitCode: 0 };
                throw new Error(`unexpected command ${args.join(" ")}`);
            },
            packages: {
                isInstalled: async (name) => installed.map(packageOf).includes(name),
                download: async () => {
                    throw new Error("no network in tests");
                },
                getPath: async (name) => path.join(dir, "packages", name),
                version: async () => "1.2.3",
                updateWaiting: async () => false,
            },
            storageDir: async () => dir,
            readSettings: readSettings ?? (async () => saved),
            writeSettings: async (s) => void writes.push(s),
            which: (c) => (installed.includes(c) ? `/usr/bin/${c}` : null),
            registerAction: async () => {},
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
            trigger: () => {},
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

    test("the brains' state says what's installed and who is signed in, from the packages and their own status commands", async () => {
        const { state } = await start(["claude"]);
        const { brains } = state();
        expect(brains["codex"]).toMatchObject({ phase: "none", installed: false, signedIn: false });
        expect(brains["claude-code"]).toMatchObject({ phase: "ready", installed: true, signedIn: true, account: "pip@example.com", version: "1.2.3", error: null });
        expect(brains["opencode"]).toMatchObject({ phase: "none", installed: false });
    });

    test("setup saves only valid settings for a brain that's installed and signed in", async () => {
        const { app, writes, state } = await start(["claude"]);
        await expect(app.setup({ settings: { name: "Pip", harness: "codex", model: null } })).rejects.toThrow(/Codex isn't ready: install it first/);
        await expect(app.setup({ settings: { name: "", harness: "claude-code" } })).rejects.toThrow(/required/);
        expect(writes).toEqual([]);
        await app.setup({ settings: { name: "Pip", harness: "claude-code", model: "default" } });
        expect(writes).toEqual([{ name: "Pip", harness: "claude-code", model: null, compaction: "summarize" }]);
        expect(state().settings).toEqual({ name: "Pip", harness: "claude-code", model: null, compaction: "summarize" });
    });

    test("a brain that isn't signed in is refused before its turn starts, with the way out", async () => {
        const { app, procs, state } = await start(["codex"], { name: "Pip", harness: "codex", model: null }, undefined, undefined, ["codex"]);
        expect(state().brains["codex"].phase).toBe("installed");
        app.conversation.send("hi");
        await until(() => app.conversation.history().some((e) => e.kind === "error"));
        expect(app.conversation.history().find((e) => e.kind === "error")).toMatchObject({ text: "Codex isn't signed in. Sign in to it in the agent's settings." });
        expect(procs.started).toEqual([]);
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

    test("a message sent mid-turn stops the agent's work, and the next turn reads it at once", async () => {
        const { app, procs, state } = await start(["codex"], { name: "Pip", harness: "codex", model: null });
        app.conversation.send("find me a flight to Oslo");
        await until(() => procs.started.length === 1);

        const train = app.conversation.send("actually, make it a train");
        expect(train.waiting).toBe(true);
        await until(() => procs.started.length === 2);
        expect(procs.killed.map((k) => k.id)).toEqual([TURN_PROC_ID]);
        const next = procs.started[1]!.args;
        expect(next.at(-1)).toBe(`[${train.id}] actually, make it a train`);
        expect(state().chat.waiting).toEqual([]);
        expect(app.conversation.history().map((e) => (e.kind === "user" || e.kind === "agent" ? e.text : e.kind))).toEqual([
            "find me a flight to Oslo",
            "actually, make it a train",
        ]);

        procs.stdout(TURN_PROC_ID, JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Trains it is!" } }) + "\n");
        procs.exit(TURN_PROC_ID, 0);
        await until(() => state().chat.busy === false);
        // the stopped turn isn't an error
        expect(app.conversation.history().filter((e) => e.kind === "error")).toEqual([]);
    });

    test("the agent's files are a shell over its home folder, and a home folder kept in the browser's moves out", async () => {
        const plant = (storage: string) => {
            fs.mkdirSync(path.join(storage, "browser", "home", "Downloads"), { recursive: true });
            fs.writeFileSync(path.join(storage, "browser", "home", "Downloads", "ticket.txt"), "Oslo, seat 12A");
        };
        const { app, procs } = await start(["codex"], { name: "Pip", harness: "codex", model: null }, undefined, plant);
        expect(fs.existsSync(path.join(dir, "browser", "home"))).toBe(false);
        app.conversation.send("where am I sitting?");
        await until(() => procs.started.length === 1);
        const turn = procs.started[0]!;
        const url = JSON.parse(turn.args.find((a) => a.startsWith("mcp_servers.paperboard.url="))!.split("=").slice(1).join("="));
        const rpc = async (method: string, params?: unknown) => {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${turn.env!.PAPERBOARD_COMPUTER_MCP_TOKEN}` },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            });
            return ((await res.json()) as { result: { tools?: { name: string }[]; content?: { text: string }[] } }).result;
        };
        const names = (await rpc("tools/list")).tools!.map((t) => t.name);
        for (const tool of ["bash", "start_app", "add_package", "checkpoint", "checkpoints", "restore"]) expect(names).toContain(tool);
        expect(names).not.toContain("files");
        const read = await rpc("tools/call", { name: "bash", arguments: { command: "cat ~/Downloads/ticket.txt && echo noted > ~/seat.txt" } });
        expect(read.content![0]!.text).toBe("Oslo, seat 12A");
        expect(fs.readFileSync(path.join(dir, "home", "seat.txt"), "utf8")).toBe("noted\n");
        procs.exit(TURN_PROC_ID, 0);
    });

    test("while it summarizes the conversation, the agent's tools are refused: it writes from what it knows", async () => {
        const { app, procs, state } = await start(["codex"], { name: "Pip", harness: "codex", model: null });
        app.conversation.send("hi");
        await until(() => procs.started.length === 1);
        procs.stdout(TURN_PROC_ID, `{"type":"thread.started","thread_id":"t-1"}\n` + JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hey" } }) + "\n");
        // Codex's rollout says the thread is past the budget
        const day = path.join(dir, "brains", "codex", "sessions", "2026", "10", "26");
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
