// The models a brain offers, read from the catalog the harness keeps for its
// own model picker. The panel names no models itself: a harness that gains
// one shows it here without a release of this panel.
//
// Claude keeps its catalog under ~/.claude/cache/model-catalog (one file per
// account and surface; Claude Code's is the "cc" surface), Codex in
// ~/.codex/models_cache.json. Both are the harness's own files, read only.
// OpenCode lists its own with `opencode models --standalone` (a private,
// one-shot server, never the shared background one): `provider/model` a line.
// A catalog that can't be read is an error, never an empty list.

import fs from "node:fs";
import path from "node:path";
import type { BrainModel, Harness } from "../contract";

/** far past any real catalog; a file this big isn't one */
export const MAX_CATALOG_BYTES = 4 * 1024 * 1024;

export interface HarnessHomes {
    /** Claude's config folder (~/.claude) */
    claude: string;
    /** Codex's home (~/.codex) */
    codex: string;
}

/** runs a harness's own command, bounded in time */
export type RunCommand = (command: string, args: string[], o: { timeoutMs: number }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const OPENCODE_MODELS_MS = 30_000;

export async function listModels(harness: Harness, homes: HarnessHomes, run: RunCommand): Promise<BrainModel[]> {
    if (harness === "opencode") return openCodeModels(await run("opencode", ["models", "--standalone"], { timeoutMs: OPENCODE_MODELS_MS }));
    return harness === "codex" ? codexModels(homes.codex) : claudeModels(homes.claude);
}

export function openCodeModels(out: { stdout: string; stderr: string; exitCode: number }): BrainModel[] {
    if (out.exitCode !== 0) throw new Error(`OpenCode couldn't list its models: ${out.stderr.trim().slice(-300) || `exit ${out.exitCode}`}`);
    const models: BrainModel[] = [];
    for (const line of out.stdout.split("\n")) {
        const id = line.trim();
        const slash = id.indexOf("/");
        if (slash <= 0 || slash === id.length - 1 || /\s/.test(id)) continue; // not a model line
        models.push({ id, name: id.slice(slash + 1), description: id.slice(0, slash), older: false });
    }
    if (!models.length) throw new Error("OpenCode has no models yet. Connect a provider in OpenCode, then look again.");
    return models;
}

function readJson(file: string): unknown {
    const size = fs.statSync(file).size;
    if (size > MAX_CATALOG_BYTES) throw new Error(`${file} is too big to be a model list (${size} bytes)`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function claudeModels(home: string): BrainModel[] {
    const dir = path.join(home, "cache", "model-catalog");
    if (!fs.existsSync(dir)) throw new Error("Claude hasn't listed its models yet. Open Claude once, then look again.");
    // the newest Claude Code catalog: an older one may be another account's, or out of date
    let newest: { fetchedAt: number; models: unknown[] } | null = null;
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith("-cc.json")) continue;
        const file = path.join(dir, name);
        const d = readJson(file) as { fetchedAt?: unknown; catalog?: { surface?: unknown; config?: { models?: unknown } } };
        if (d.catalog?.surface !== "cc") continue;
        if (!Array.isArray(d.catalog.config?.models) || typeof d.fetchedAt !== "number") throw new Error(`${file} isn't a model list Claude wrote`);
        if (!newest || d.fetchedAt > newest.fetchedAt) newest = { fetchedAt: d.fetchedAt, models: d.catalog.config.models };
    }
    if (!newest) throw new Error("Claude hasn't listed its models yet. Open Claude once, then look again.");
    const models: BrainModel[] = [];
    for (const m of newest.models as { id?: unknown; name?: unknown; description?: unknown; section?: unknown }[]) {
        const id = str(m.id);
        if (!id) continue;
        // its picker shows the "main" ones up front and the rest under more
        models.push({ id, name: str(m.name) ?? id, description: str(m.description), older: m.section !== "main" });
    }
    if (models.length === 0) throw new Error("Claude's model list is empty.");
    // current ones first, each group in Claude's order
    return [...models.filter((m) => !m.older), ...models.filter((m) => m.older)];
}

function codexModels(home: string): BrainModel[] {
    const file = path.join(home, "models_cache.json");
    if (!fs.existsSync(file)) throw new Error("Codex hasn't listed its models yet. Open Codex once, then look again.");
    const d = readJson(file) as { models?: unknown };
    if (!Array.isArray(d.models)) throw new Error(`${file} isn't a model list Codex wrote`);
    const models = (d.models as { slug?: unknown; display_name?: unknown; description?: unknown; visibility?: unknown; priority?: unknown }[])
        // what its own picker lists; hidden ones are internal (reviewers and the like)
        .filter((m) => m.visibility === "list" && str(m.slug))
        .map((m, i) => ({ m, i, priority: typeof m.priority === "number" ? m.priority : Number.MAX_SAFE_INTEGER }))
        .sort((a, b) => a.priority - b.priority || a.i - b.i)
        // Codex marks no models as older than others; its order says it
        .map(({ m }) => ({ id: str(m.slug)!, name: str(m.display_name) ?? str(m.slug)!, description: str(m.description), older: false }));
    if (models.length === 0) throw new Error("Codex's model list is empty.");
    return models;
}
