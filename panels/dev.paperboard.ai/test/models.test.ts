import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listModels, MAX_CATALOG_BYTES } from "../src/service/models";

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
        expect(await listModels("claude-code", h)).toEqual([
            { id: "a", name: "Alpha", description: "first", older: false },
            { id: "b", name: "Beta", description: null, older: false },
            { id: "z", name: "Zeta", description: null, older: true },
        ]);
    });

    test("no catalog is an error, not an empty list", async () => {
        await expect(listModels("claude-code", homes())).rejects.toThrow("hasn't listed its models");
    });

    test("a malformed catalog is an error", async () => {
        const h = homes();
        write(path.join(h.claude, "cache", "model-catalog", "x-cc.json"), "{not json");
        await expect(listModels("claude-code", h)).rejects.toThrow();
        write(path.join(h.claude, "cache", "model-catalog", "x-cc.json"), { fetchedAt: 1, catalog: { surface: "cc", config: {} } });
        await expect(listModels("claude-code", h)).rejects.toThrow("isn't a model list");
    });

    test("an oversized catalog is refused unread", async () => {
        const h = homes();
        write(path.join(h.claude, "cache", "model-catalog", "x-cc.json"), " ".repeat(MAX_CATALOG_BYTES + 1));
        await expect(listModels("claude-code", h)).rejects.toThrow("too big");
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
        expect(await listModels("codex", h)).toEqual([
            { id: "first", name: "First", description: "best", older: false },
            { id: "second", name: "Second", description: null, older: false },
        ]);
    });

    test("no cache, or nothing listed, is an error", async () => {
        const h = homes();
        await expect(listModels("codex", h)).rejects.toThrow("hasn't listed its models");
        write(path.join(h.codex, "models_cache.json"), { models: [{ slug: "x", visibility: "hide" }] });
        await expect(listModels("codex", h)).rejects.toThrow("empty");
    });
});
