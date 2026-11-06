// The models a brain offers, read from the catalog the harness keeps for its
// own model picker. The panel names no models itself: a harness that gains
// one shows it here without a release of this panel.
//
// Claude keeps its catalog under <CLAUDE_CONFIG_DIR>/cache/model-catalog (one
// file per account and surface; Claude Code's is the "cc" surface), which it
// writes itself and this panel only reads. It writes it on its first signed-in
// turn, so a brain just signed in has none yet: then Claude is asked for the
// models its /model picker offers, over its stream-json control protocol (an
// `initialize` request, which sends nothing to a model). Codex prints its own with
// `codex debug models` (signed in or not). OpenCode lists its own with
// `opencode models --standalone` (a private, one-shot server, never the shared
// background one): `provider/model` a line. A catalog that can't be read is an
// error, never an empty list.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PANEL_ID, type BrainModel, type Harness } from "../contract";
import type { TurnHost } from "./conversation";

/** far past any real catalog; a file this big isn't one */
export const MAX_CATALOG_BYTES = 4 * 1024 * 1024;

export interface HarnessHomes {
    /** Claude's config folder (CLAUDE_CONFIG_DIR) */
    claude: string;
    /** Codex's home (CODEX_HOME) */
    codex: string;
}

/** runs a harness's own command, bounded in time */
export type RunCommand = (command: string, args: string[], o: { timeoutMs: number }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const MODELS_MS = 30_000;

/** asks Claude Code itself for its models: the `models` of its answer to an `initialize` request */
export type AskClaude = () => Promise<unknown>;

export async function listModels(harness: Harness, homes: HarnessHomes, run: RunCommand, askClaude: AskClaude): Promise<BrainModel[]> {
    if (harness === "opencode") return openCodeModels(await run("opencode", ["models", "--standalone"], { timeoutMs: MODELS_MS }));
    if (harness === "codex") return codexModels(await run("codex", ["debug", "models"], { timeoutMs: MODELS_MS }));
    return claudeCatalog(homes.claude) ?? claudePickerModels(await askClaude());
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

/** Claude Code's catalog, or null when it hasn't written one yet. */
function claudeCatalog(home: string): BrainModel[] | null {
    const dir = path.join(home, "cache", "model-catalog");
    if (!fs.existsSync(dir)) return null;
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
    if (!newest) return null;
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

/**
 * The models Claude's /model picker offers, from its answer to `initialize`. Each is named by the model it
 * runs (`resolvedModel`), as its catalog names it, so a model picked here is the same one once the catalog
 * exists. "default" is left out: the panel offers the default itself.
 */
export function claudePickerModels(listed: unknown): BrainModel[] {
    if (!Array.isArray(listed)) throw new Error("Claude's model list isn't a list of models");
    const models: BrainModel[] = [];
    for (const m of listed as { value?: unknown; resolvedModel?: unknown; displayName?: unknown; description?: unknown }[]) {
        const id = str(m?.resolvedModel);
        if (!id || m.value === "default" || models.some((x) => x.id === id)) continue;
        // "Haiku 5.5 · Fastest for quick answers": the model's full name, then what it's for
        const description = str(m.description);
        const dot = description?.indexOf(" · ") ?? -1;
        models.push(
            dot > 0
                ? { id, name: description!.slice(0, dot).trim(), description: str(description!.slice(dot + 3)), older: false }
                : { id, name: str(m.displayName) ?? id, description, older: false },
        );
    }
    if (models.length === 0) throw new Error("Claude's model list is empty.");
    return models;
}

/** what starting Claude Code to ask it for its models takes */
export interface ClaudeLaunch {
    command: string;
    env: Record<string, string>;
    /** an empty folder: no project for it to pick up */
    cwd: string;
    timeoutMs?: number;
}

const MAX_ANSWER = 16 * 1024 * 1024;

/**
 * Starts Claude Code in its stream-json mode, sends `initialize`, and returns the models of its answer.
 * Nothing reaches a model: the process is stopped once it has answered.
 */
export async function askClaudeModels(host: TurnHost, launch: ClaudeLaunch): Promise<unknown> {
    const id = `${PANEL_ID}.models.${randomUUID()}`;
    const request = randomUUID();
    let buf = "";
    let stderr = "";
    let settle!: { ok: (v: unknown) => void; fail: (e: Error) => void };
    const answered = new Promise<unknown>((ok, fail) => (settle = { ok, fail }));
    const onLine = (line: string) => {
        let ev: any;
        try {
            ev = JSON.parse(line);
        } catch {
            return; // a stray log line
        }
        if (ev?.type !== "control_response" || ev.response?.request_id !== request) return;
        if (ev.response.subtype !== "success") settle.fail(new Error(`Claude couldn't list its models: ${String(ev.response.error ?? ev.response.subtype)}`));
        else settle.ok(ev.response.response?.models);
    };
    const offs = [
        host.onStdout(id, (data) => {
            buf += data;
            for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
                onLine(buf.slice(0, i));
                buf = buf.slice(i + 1);
            }
            if (buf.length > MAX_ANSWER) settle.fail(new Error("Claude's answer is too big to be a model list"));
        }),
        host.onStderr(id, (data) => {
            stderr = (stderr + data).slice(-2000);
        }),
        host.onExit(id, (code) => {
            const said = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
            settle.fail(new Error(`Claude ended before it listed its models (exit ${code ?? "?"})${said ? `: ${said}` : "."}`));
        }),
    ];
    const ms = launch.timeoutMs ?? MODELS_MS;
    const timer = setTimeout(() => settle.fail(new Error(`Claude didn't list its models within ${Math.round(ms / 1000)} seconds.`)), ms);
    let started = false;
    try {
        fs.mkdirSync(launch.cwd, { recursive: true });
        await host.start({
            id,
            command: launch.command,
            args: ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
            cwd: launch.cwd,
            env: launch.env,
        });
        started = true;
        await host.write(id, `${JSON.stringify({ type: "control_request", request_id: request, request: { subtype: "initialize" } })}\n`);
        return await answered;
    } finally {
        clearTimeout(timer);
        for (const off of offs) off();
        if (started && (await host.exists(id))) await host.kill(id, "SIGTERM");
    }
}

export function codexModels(out: { stdout: string; stderr: string; exitCode: number }): BrainModel[] {
    if (out.exitCode !== 0) throw new Error(`Codex couldn't list its models: ${out.stderr.trim().slice(-300) || `exit ${out.exitCode}`}`);
    if (out.stdout.length > MAX_CATALOG_BYTES) throw new Error(`Codex's model list is too big (${out.stdout.length} bytes)`);
    let d: { models?: unknown };
    try {
        d = JSON.parse(out.stdout);
    } catch {
        throw new Error("Codex's model list isn't JSON");
    }
    if (!Array.isArray(d.models)) throw new Error("Codex's model list isn't a list of models");
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
