import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { askClaudeModels, claudePickerModels, listModels, MAX_CATALOG_BYTES, openCodeModels, type AskClaude, type RunCommand } from "../src/service/models";
import type { TurnHost } from "../src/service/conversation";

// Each test makes its own fake harness homes; the real ~/.claude is never read.
const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function homes() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-models-"));
    dirs.push(root);
    return { claude: path.join(root, "claude"), codex: path.join(root, "codex") };
}
function write(file: string, data: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
}
const noRun: RunCommand = async () => {
    throw new Error("Claude's models come from its catalog, not a command");
};
const noAsk: AskClaude = async () => {
    throw new Error("Claude's catalog is there: Claude isn't asked");
};
const catalog = (fetchedAt: number, models: unknown[], surface = "cc") => ({ version: 1, fetchedAt, staleAt: fetchedAt + 1, catalog: { surface, config: { models } } });

describe("Claude's models", () => {
    test("from its newest Claude Code catalog, current ones first, the rest marked older", async () => {
        const h = homes();
        const dir = path.join(h.claude, "cache", "model-catalog");
        write(path.join(dir, "old-cc.json"), catalog(1, [{ id: "stale", name: "Stale", section: "main" }]));
        write(
            path.join(dir, "new-cc.json"),
            catalog(2, [
                { id: "a", name: "Alpha", description: "first", section: "main" },
                { id: "z", name: "Zeta", section: "overflow" },
                { id: "b", name: "Beta", section: "main" },
            ]),
        );
        // another surface's catalog, even a newer one, isn't Claude Code's picker
        write(path.join(dir, "new-web.json"), catalog(3, [{ id: "web", name: "Web", section: "main" }], "web"));
        expect(await listModels("claude-code", h, noRun, noAsk)).toEqual([
            { id: "a", name: "Alpha", description: "first", older: false },
            { id: "b", name: "Beta", description: null, older: false },
            { id: "z", name: "Zeta", description: null, older: true },
        ]);
    });

    test("no catalog yet (signed in, never used): Claude is asked for the models its picker offers", async () => {
        const asked: string[] = [];
        const picker = [
            { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)", description: "Opus 5.5 · Best for everyday, complex tasks" },
            { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus", description: "Opus 5.5 · Best for everyday, complex tasks" },
            { value: "claude-fable-5-1[1m]", resolvedModel: "claude-fable-5-1", displayName: "Fable", description: "Fable 5.1 · Most capable for your hardest tasks" },
            { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku", description: "Haiku 5.5 · Fastest for quick answers" },
        ];
        const models = await listModels("claude-code", homes(), noRun, async () => {
            asked.push("initialize");
            return picker;
        });
        expect(asked).toEqual(["initialize"]);
        // named by the model each runs, as the catalog names them; the default is the panel's own choice
        expect(models).toEqual([
            { id: "claude-opus-5-5", name: "Opus 5.5", description: "Best for everyday, complex tasks", older: false },
            { id: "claude-fable-5-1", name: "Fable 5.1", description: "Most capable for your hardest tasks", older: false },
            { id: "claude-haiku-5-5", name: "Haiku 5.5", description: "Fastest for quick answers", older: false },
        ]);
    });

    test("an answer that isn't a model list is an error, never an empty list", () => {
        expect(() => claudePickerModels(undefined)).toThrow("isn't a list");
        expect(() => claudePickerModels([{ value: "default", resolvedModel: "x" }])).toThrow("empty");
        expect(claudePickerModels([{ value: "m", resolvedModel: "m", displayName: "M" }])).toEqual([{ id: "m", name: "M", description: null, older: false }]);
    });

    test("a malformed catalog is an error", async () => {
        const h = homes();
        write(path.join(h.claude, "cache", "model-catalog", "x-cc.json"), "{not json");
        await expect(listModels("claude-code", h, noRun, noAsk)).rejects.toThrow();
        write(path.join(h.claude, "cache", "model-catalog", "x-cc.json"), { fetchedAt: 1, catalog: { surface: "cc", config: {} } });
        await expect(listModels("claude-code", h, noRun, noAsk)).rejects.toThrow("isn't a model list");
    });

    test("an oversized catalog is refused unread", async () => {
        const h = homes();
        write(path.join(h.claude, "cache", "model-catalog", "x-cc.json"), " ".repeat(MAX_CATALOG_BYTES + 1));
        await expect(listModels("claude-code", h, noRun, noAsk)).rejects.toThrow("too big");
    });
});

describe("Codex's models", () => {
    const codexOut = (models: unknown, exitCode = 0, stderr = ""): RunCommand => async () => ({ stdout: JSON.stringify({ models }), stderr, exitCode });

    test("the listed ones in priority order; hidden ones left out, from `codex debug models`", async () => {
        const runs: [string, string[]][] = [];
        const run: RunCommand = async (command, args, o) => {
            runs.push([command, args]);
            return codexOut([
                { slug: "second", display_name: "Second", visibility: "list", priority: 2 },
                { slug: "internal", display_name: "Internal", visibility: "hide", priority: 0 },
                { slug: "first", display_name: "First", description: "best", visibility: "list", priority: 1 },
            ])(command, args, o);
        };
        expect(await listModels("codex", homes(), run, noAsk)).toEqual([
            { id: "first", name: "First", description: "best", older: false },
            { id: "second", name: "Second", description: null, older: false },
        ]);
        expect(runs).toEqual([["codex", ["debug", "models"]]]);
    });

    test("a failed command, something that isn't a list, or nothing listed is an error", async () => {
        await expect(listModels("codex", homes(), codexOut([], 1, "boom"), noAsk)).rejects.toThrow("boom");
        await expect(listModels("codex", homes(), async () => ({ stdout: "not json", stderr: "", exitCode: 0 }), noAsk)).rejects.toThrow("isn't JSON");
        await expect(listModels("codex", homes(), async () => ({ stdout: "{}", stderr: "", exitCode: 0 }), noAsk)).rejects.toThrow("isn't a list");
        await expect(listModels("codex", homes(), codexOut([{ slug: "x", visibility: "hide" }]), noAsk)).rejects.toThrow("empty");
    });
});

describe("OpenCode's models", () => {
    test("from `opencode models --standalone`: the model as the name, its provider as the description", async () => {
        const runs: [string, string[]][] = [];
        const run: RunCommand = async (command, args) => (runs.push([command, args]), { stdout: "opencode/big-pickle\nvertex/gemini-3-flash\n\nsome log line\n", stderr: "", exitCode: 0 });
        expect(await listModels("opencode", homes(), run, noAsk)).toEqual([
            { id: "opencode/big-pickle", name: "big-pickle", description: "opencode", older: false },
            { id: "vertex/gemini-3-flash", name: "gemini-3-flash", description: "vertex", older: false },
        ]);
        expect(runs).toEqual([["opencode", ["models", "--standalone"]]]);
    });

    test("a failed or empty listing is an error, never an empty list", () => {
        expect(() => openCodeModels({ stdout: "", stderr: "boom", exitCode: 1 })).toThrow("boom");
        expect(() => openCodeModels({ stdout: "\n", stderr: "", exitCode: 0 })).toThrow("no models");
    });
});

// A real child process behind the daemon's process API, so asking Claude is tested over real pipes.
function realHost(): TurnHost & { children: Map<string, ChildProcess> } {
    const children = new Map<string, ChildProcess>();
    const listeners = new Map<string, { stdout: Set<(d: string) => void>; stderr: Set<(d: string) => void>; exit: Set<(c?: number) => void> }>();
    const of = (id: string) => {
        let l = listeners.get(id);
        if (!l) listeners.set(id, (l = { stdout: new Set(), stderr: new Set(), exit: new Set() }));
        return l;
    };
    const on = <K extends "stdout" | "stderr" | "exit">(kind: K, id: string, cb: any) => {
        of(id)[kind].add(cb);
        return () => void of(id)[kind].delete(cb);
    };
    return {
        children,
        start: async (o) => {
            const child = spawn(o.command, o.args, { cwd: o.cwd, env: { ...process.env, ...o.env }, stdio: [o.stdin === false ? "ignore" : "pipe", "pipe", "pipe"] });
            children.set(o.id, child);
            child.stdout!.on("data", (d) => of(o.id).stdout.forEach((cb) => cb(String(d))));
            child.stderr!.on("data", (d) => of(o.id).stderr.forEach((cb) => cb(String(d))));
            child.on("exit", (code) => {
                children.delete(o.id);
                of(o.id).exit.forEach((cb) => cb(code ?? undefined));
            });
        },
        write: async (id, data) => {
            const child = children.get(id);
            if (!child) throw new Error(`${id} isn't running`);
            child.stdin!.write(data);
        },
        kill: async (id, signal) => void children.get(id)?.kill((signal as NodeJS.Signals) ?? "SIGTERM"),
        exists: async (id) => children.has(id),
        onStdout: (id, cb) => on("stdout", id, cb),
        onStderr: (id, cb) => on("stderr", id, cb),
        onExit: (id, cb) => on("exit", id, cb),
    };
}

/** a stand-in `claude` that speaks the control protocol: it answers initialize and then waits, as Claude does */
function fakeClaude(script: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-fake-claude-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "claude.js"), script);
    const bin = path.join(dir, "claude");
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, "claude.js")}" "$@"\n`, { mode: 0o755 });
    return bin;
}

describe("asking Claude for its models", () => {
    test("Claude started in stream-json mode answers initialize; its models come back and it's stopped", async () => {
        const host = realHost();
        const claude = fakeClaude(`
            const args = process.argv.slice(2).join(" ");
            if (args !== "-p --input-format stream-json --output-format stream-json --verbose") { console.error("unexpected args: " + args); process.exit(2); }
            let buf = "";
            process.stdin.on("data", (d) => {
                buf += d;
                for (let i = buf.indexOf("\\n"); i >= 0; i = buf.indexOf("\\n")) {
                    const req = JSON.parse(buf.slice(0, i));
                    buf = buf.slice(i + 1);
                    console.log("not json");
                    console.log(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: req.request_id, response: { commands: [], models: [{ value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku", description: "Haiku 5.5 · Fastest" }], home: process.env.CLAUDE_CONFIG_DIR } } }));
                }
            });
            setInterval(() => {}, 1000);
        `);
        const cwd = path.join(homes().claude, "..", "models");
        const listed = await askClaudeModels(host, { command: claude, env: { CLAUDE_CONFIG_DIR: "/the/home" }, cwd });
        expect(listed).toEqual([{ value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku", description: "Haiku 5.5 · Fastest" }]);
        // the folder it ran in exists, and nothing keeps running once it has answered
        expect(fs.existsSync(cwd)).toBe(true);
        await until(() => host.children.size === 0);
    });

    test("a Claude that ends without answering is an error that says what it said", async () => {
        const host = realHost();
        const claude = fakeClaude(`console.error("Invalid API key · Please run /login"); process.exit(1);`);
        const cwd = path.join(homes().claude, "..", "models");
        await expect(askClaudeModels(host, { command: claude, env: {}, cwd })).rejects.toThrow("Invalid API key");
    });

    test("a Claude that never answers is stopped and its silence is an error", async () => {
        const host = realHost();
        const claude = fakeClaude(`process.stdin.resume(); setInterval(() => {}, 1000);`);
        const cwd = path.join(homes().claude, "..", "models");
        await expect(askClaudeModels(host, { command: claude, env: {}, cwd, timeoutMs: 1500 })).rejects.toThrow("didn't list its models");
        await until(() => host.children.size === 0);
    });
});

async function until(ok: () => boolean, ms = 5000) {
    const end = Date.now() + ms;
    while (!ok()) {
        if (Date.now() > end) throw new Error("timed out");
        await new Promise((r) => setTimeout(r, 20));
    }
}
