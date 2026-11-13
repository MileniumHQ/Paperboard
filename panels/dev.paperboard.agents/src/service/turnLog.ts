// A developer's log of every turn, for comparing models: what the agent was
// told, every line its harness printed, every tool it called and what came
// back, how long each took, the tokens and cost its harness reported, and how
// the turn ended. One JSON object per line, appended as things happen, so a
// turn that crashes the service is still there up to that point.
//
// Off unless Paperboard starts with PAPERBOARD_AGENT_LOG=1. It's for the
// developer, never a feature: it holds whole conversations, unredacted, and
// grows until it's deleted. The MCP token never goes in: it's only ever in
// the harness's environment, which isn't logged.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Harness } from "../contract";

export const TURN_LOG_ENV = "PAPERBOARD_AGENT_LOG";

/** The tokens and cost a harness reported for a turn, as far as it reports them. */
export interface TurnUsage {
    input?: number;
    cachedInput?: number;
    cacheWrite?: number;
    output?: number;
    reasoning?: number;
    costUsd?: number;
    /** OpenCode's: the whole session's cost so far, as of this turn's end (ACP reports only that) */
    sessionCostUsd?: number;
    /** the harness's own timings and step count, where it gives them */
    durationMs?: number;
    apiMs?: number;
    steps?: number;
}

export interface TurnLog {
    readonly file: string;
    /** A turn starts: everything it was given. Returns the turn's id, which every later record carries. */
    begin(o: { harness: Harness; model: string | null; name: string; fromFlow: boolean; thread: string | null; message: string; instructions: string; command: string; args: string[] }): string;
    /** One line the harness printed, or one the panel wrote to it (ACP). */
    line(stream: "stdout" | "stderr" | "stdin", text: string): void;
    /** A tool the agent called, what it was given and what came back. */
    tool(o: { name: string; args: unknown; result: unknown; ms: number; isError: boolean }): void;
    /** The turn is over, however it went. */
    end(o: { outcome: "done" | "stopped" | "failed"; error?: string; exitCode?: number; context: { used: number | null; size: number | null } }): void;
    /** A question from an automation (Get Answer): its own small turn, start to end. */
    ask(o: { harness: Harness; model: string | null; question: string; instructions: string; answer?: string; error?: string; ms: number; lines: string[] }): void;
}

/** The log, when it's switched on; null otherwise, and nothing is written. */
export function openTurnLog(dir: string, env: NodeJS.ProcessEnv = process.env): TurnLog | null {
    if (env[TURN_LOG_ENV] !== "1") return null;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "turns.jsonl");
    let turn: { id: string; harness: Harness; started: number; usage: TurnUsage; tools: number; toolMs: number; lines: number } | null = null;
    const write = (record: Record<string, unknown>) => {
        try {
            fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
        } catch (e) {
            // the log is a developer's: a full disk or a removed folder is said, and the turn goes on
            console.error(`[ai] the turn log couldn't be written (${file}):`, e instanceof Error ? e.message : String(e));
        }
    };
    console.log(`[ai] logging every turn to ${file} (${TURN_LOG_ENV}=1)`);
    return {
        file,
        begin(o) {
            const id = crypto.randomBytes(6).toString("hex");
            turn = { id, harness: o.harness, started: Date.now(), usage: {}, tools: 0, toolMs: 0, lines: 0 };
            write({ type: "turn.start", turn: id, ...o });
            return id;
        },
        line(stream, text) {
            if (!text.trim()) return;
            let json: unknown;
            try {
                json = JSON.parse(text);
            } catch {
                json = undefined;
            }
            if (turn) {
                turn.lines++;
                if (stream === "stdout" && json && typeof json === "object") addUsage(turn.harness, json as Record<string, any>, turn.usage);
            }
            write({ type: "harness", turn: turn?.id ?? null, stream, ...(json === undefined ? { text } : { json }) });
        },
        tool(o) {
            if (turn) {
                turn.tools++;
                turn.toolMs += o.ms;
            }
            write({ type: "tool", turn: turn?.id ?? null, ...o });
        },
        end(o) {
            if (!turn) return;
            write({
                type: "turn.end",
                turn: turn.id,
                harness: turn.harness,
                ms: Date.now() - turn.started,
                ...o,
                usage: turn.usage,
                toolCalls: turn.tools,
                toolMs: turn.toolMs,
                harnessLines: turn.lines,
            });
            turn = null;
        },
        ask(o) {
            const usage: TurnUsage = {};
            for (const l of o.lines) {
                try {
                    addUsage(o.harness, JSON.parse(l), usage);
                } catch {
                    // a line that isn't JSON carries no usage
                }
            }
            write({ type: "ask", ...o, usage });
        },
    };
}

/**
 * What one harness event says about the turn's tokens and cost, added to what's known. Claude Code's result is
 * the whole turn's; Codex reports each turn's usage when it completes; OpenCode (over ACP) its running cost.
 */
export function addUsage(harness: Harness, ev: Record<string, any>, into: TurnUsage) {
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const add = (k: keyof TurnUsage, v: unknown) => {
        const n = num(v);
        if (n !== undefined) into[k] = (into[k] ?? 0) + n;
    };
    if (harness === "claude-code" && ev.type === "result") {
        const u = ev.usage ?? {};
        add("input", u.input_tokens);
        add("cachedInput", u.cache_read_input_tokens);
        add("cacheWrite", u.cache_creation_input_tokens);
        add("output", u.output_tokens);
        add("costUsd", ev.total_cost_usd);
        add("durationMs", ev.duration_ms);
        add("apiMs", ev.duration_api_ms);
        add("steps", ev.num_turns);
    } else if (harness === "codex" && ev.type === "turn.completed") {
        const u = ev.usage ?? {};
        add("input", u.input_tokens);
        add("cachedInput", u.cached_input_tokens);
        add("output", u.output_tokens);
        add("reasoning", u.reasoning_output_tokens);
    } else if (harness === "opencode") {
        // a session update with the session's usage so far: the latest is the whole of it
        const u = ev.params?.update;
        if (u?.sessionUpdate === "usage_update") {
            const cost = num(u.cost?.amount);
            if (cost !== undefined) into.sessionCostUsd = cost;
        }
        const r = ev.result?.usage;
        if (r) {
            add("input", r.inputTokens);
            add("cachedInput", r.cachedReadTokens);
            add("cacheWrite", r.cachedWriteTokens);
            add("output", r.outputTokens);
            add("reasoning", r.thoughtTokens);
        }
    }
}
