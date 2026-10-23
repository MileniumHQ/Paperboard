import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listModels, MAX_CATALOG_BYTES, openCodeModels, type RunCommand } from "../src/service/models";

// Each test makes its own fake harness homes; the real ~/.claude and ~/.codex are never read.
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
    throw new Error("Claude and Codex models come from their catalogs, not a command");
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
        expect(await listModels("claude-code", h, noRun)).toEqual([
            { id: "a", name: "Alpha", description: "first", older: false },
            { id: "b", name: "Beta", description: null, older: false },
            { id: "z", name: "Zeta", description: null, older: true },
        ]);
    });

    test("no catalog is an error, not an empty list", async () => {
        await expect(listModels("claude-code", homes(), noRun)).rejects.toThrow("hasn't listed its models");
    });

    test("a malformed catalog is an error", async () => {
        const h = homes();
        write(path.join(h.claude, "cache", "model-catalog", "x-cc.json"), "{not json");
        await expect(listModels("claude-code", h, noRun)).rejects.toThrow();
        write(path.join(h.claude, "cache", "model-catalog", "x-cc.json"), { fetchedAt: 1, catalog: { surface: "cc", config: {} } });
        await expect(listModels("claude-code", h, noRun)).rejects.toThrow("isn't a model list");
    });

    test("an oversized catalog is refused unread", async () => {
        const h = homes();
        write(path.join(h.claude, "cache", "model-catalog", "x-cc.json"), " ".repeat(MAX_CATALOG_BYTES + 1));
        await expect(listModels("claude-code", h, noRun)).rejects.toThrow("too big");
    });
});

describe("Codex's models", () => {
    test("the listed ones in priority order; hidden ones left out", async () => {
        const h = homes();
        write(path.join(h.codex, "models_cache.json"), {
            models: [
                { slug: "second", display_name: "Second", visibility: "list", priority: 2 },
                { slug: "internal", display_name: "Internal", visibility: "hide", priority: 0 },
                { slug: "first", display_name: "First", description: "best", visibility: "list", priority: 1 },
            ],
        });
        expect(await listModels("codex", h, noRun)).toEqual([
            { id: "first", name: "First", description: "best", older: false },
            { id: "second", name: "Second", description: null, older: false },
        ]);
    });

    test("no cache, or nothing listed, is an error", async () => {
        const h = homes();
        await expect(listModels("codex", h, noRun)).rejects.toThrow("hasn't listed its models");
        write(path.join(h.codex, "models_cache.json"), { models: [{ slug: "x", visibility: "hide" }] });
        await expect(listModels("codex", h, noRun)).rejects.toThrow("empty");
    });
});

describe("OpenCode's models", () => {
    test("from `opencode models --standalone`: the model as the name, its provider as the description", async () => {
        const runs: [string, string[]][] = [];
        const run: RunCommand = async (command, args) => (runs.push([command, args]), { stdout: "opencode/big-pickle\nvertex/gemini-3-flash\n\nsome log line\n", stderr: "", exitCode: 0 });
        expect(await listModels("opencode", homes(), run)).toEqual([
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
