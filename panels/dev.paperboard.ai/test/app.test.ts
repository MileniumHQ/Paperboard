import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_STATE, type AiState, type Settings } from "../src/contract";
import { AiApp, parseBudget, parseSettings, type AppHost } from "../src/service/app";
import { FakeProcesses } from "./fakeHost";

describe("settings and budget are validated by the service", () => {
    test("parseSettings", () => {
        expect(parseSettings({ name: " Pip ", harness: "codex", model: "default" })).toEqual({ name: "Pip", harness: "codex", model: null });
        expect(parseSettings({ name: "Pip", harness: "claude-code", model: "claude-opus-5-5" })).toEqual({ name: "Pip", harness: "claude-code", model: "claude-opus-5-5" });
        expect(parseSettings({ name: "", harness: "codex" })).toBeNull();
        expect(parseSettings({ name: "x".repeat(33), harness: "codex" })).toBeNull();
        expect(parseSettings({ name: "Pip", harness: "ollama" })).toBeNull();
        // a model is one argv value, never flags or shell text
        expect(parseSettings({ name: "Pip", harness: "codex", model: "--dangerously-bypass" })).toBeNull();
        expect(parseSettings({ name: "Pip", harness: "codex", model: "a b" })).toBeNull();
    });

    test("parseBudget", () => {
        expect(parseBudget({ memoryGb: 4, diskGb: 32 })).toEqual({ memoryGb: 4, diskGb: 32 });
        expect(() => parseBudget({ memoryGb: 1, diskGb: 32 })).toThrow(/memory/);
        expect(() => parseBudget({ memoryGb: 4, diskGb: 4096 })).toThrow(/storage/);
        expect(() => parseBudget({ memoryGb: 4.5, diskGb: 32 })).toThrow();
        expect(() => parseBudget(undefined)).toThrow();
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

    async function start(installed: string[], saved: unknown = null, readSettings?: () => Promise<unknown>, legacy: unknown = null) {
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
            download: async () => {
                throw new Error("no network in tests");
            },
            getSecret: async () => null,
            setSecret: async () => {},
            storageDir: async () => dir,
            readSettings: readSettings ?? (async () => saved),
            writeSettings: async (s) => void writes.push(s),
            readLegacySettings: async () => legacy,
            harnessHomes: { claude: "/nonexistent/claude", codex: "/nonexistent/codex" },
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
        return { app, writes, vault, toolDocs, state: () => state };
    }

    test("hydrates saved settings, and an invalid saved document is no settings", async () => {
        expect((await start(["codex"], { name: "Pip", harness: "codex", model: null })).state().settings).toEqual({ name: "Pip", harness: "codex", model: null });
        await app!.shutdown();
        app = null;
        expect((await start(["codex"], { name: "Pip", harness: "nope" })).state().settings).toBeNull();
    });

    test("settings from before, in agent.json, move once into the panel's config; the config wins after that", async () => {
        const pip = { name: "Pip", harness: "codex", model: null };
        const moved = await start(["codex"], null, undefined, pip);
        expect(moved.state().settings).toEqual(pip);
        expect(moved.writes).toEqual([pip]);
        await app!.shutdown();
        app = null;
        const after = await start(["codex"], { ...pip, name: "Pop" }, undefined, pip);
        expect(after.state().settings?.name).toBe("Pop");
        expect(after.writes).toEqual([]);
        await app!.shutdown();
        app = null;
        expect((await start(["codex"])).writes).toEqual([]); // a fresh install has nothing to move
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
        expect(writes).toEqual([{ name: "Pip", harness: "claude-code", model: null }]);
        expect(state().settings).toEqual({ name: "Pip", harness: "claude-code", model: null });
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

    test("installComputer validates the budget before accepting", async () => {
        const { app } = await start(["codex"]);
        expect(() => app.installComputer({ budget: { memoryGb: 64, diskGb: 32 } })).toThrow(/memory/);
    });
});
