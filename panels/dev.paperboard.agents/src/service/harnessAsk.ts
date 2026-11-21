// One question to a harness over its own line protocol: Claude Code's
// stream-json control requests, Codex's app-server JSON-RPC. The harness is
// started for the question, asked, and stopped once it has answered. Nothing
// reaches a model.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { PANEL_ID } from "../contract";
import type { TurnHost } from "./conversation";
import { lineReader } from "./lines";

const ASK_MS = 30_000;
const MAX_ANSWER = 16 * 1024 * 1024;

/** what starting a harness to ask it something takes */
export interface AskLaunch {
    command: string;
    env: Record<string, string>;
    /** an empty folder: no project for it to pick up */
    cwd: string;
    timeoutMs?: number;
}

/** an answer to the question, a refusal in the harness's words, or undefined for a line that is neither */
export type AskReply<T> = { ok: T } | { fail: string } | undefined;

export interface AskSpec<T> {
    /** the harness, as the user knows it ("Claude") */
    who: string;
    /** what it's asked to do, both ways: "list its models", "listed its models" */
    doing: string;
    done: string;
    /** the process's own id is made of this and a fresh UUID */
    kind: string;
    args: string[];
    /** written to its input, a line each */
    requests: unknown[];
    reply: (line: any) => AskReply<T>;
}

export async function askHarness<T>(host: TurnHost, launch: AskLaunch, spec: AskSpec<T>): Promise<T> {
    const id = `${PANEL_ID}.${spec.kind}.${randomUUID()}`;
    let stderr = "";
    let settle!: { ok: (v: T) => void; fail: (e: Error) => void };
    const answered = new Promise<T>((ok, fail) => (settle = { ok, fail }));
    // the harness can end (or time out) while a request is still being written, before anything awaits `answered`: that
    // rejection must not be unhandled, which would stop the whole service. `await answered` below still throws it.
    void Promise.allSettled([answered]); // marks it handled here; the failure itself is thrown where it is awaited
    const onLine = (line: string) => {
        let ev: unknown;
        try {
            ev = JSON.parse(line);
        } catch {
            return; // quiet: a stray log line
        }
        const r = ev && typeof ev === "object" ? spec.reply(ev) : undefined;
        if (!r) return;
        if ("ok" in r) settle.ok(r.ok);
        else settle.fail(new Error(`${spec.who} couldn't ${spec.doing}: ${r.fail}`));
    };
    const offs = [
        host.onStdout(id, lineReader(MAX_ANSWER, onLine, () => settle.fail(new Error(`${spec.who}'s answer was too big to read`))).push),
        host.onStderr(id, (data) => {
            stderr = (stderr + data).slice(-2000);
        }),
        host.onExit(id, (code) => {
            const said = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
            settle.fail(new Error(`${spec.who} ended before it ${spec.done} (exit ${code ?? "?"})${said ? `: ${said}` : "."}`));
        }),
    ];
    const ms = launch.timeoutMs ?? ASK_MS;
    const timer = setTimeout(() => settle.fail(new Error(`${spec.who} didn't ${spec.doing} within ${Math.round(ms / 1000)} seconds.`)), ms);
    let started = false;
    try {
        fs.mkdirSync(launch.cwd, { recursive: true });
        await host.start({ id, command: launch.command, args: spec.args, cwd: launch.cwd, env: launch.env });
        started = true;
        for (const r of spec.requests) await host.write(id, `${JSON.stringify(r)}\n`);
        return await answered;
    } finally {
        clearTimeout(timer);
        for (const off of offs) off();
        if (started && (await host.exists(id))) await host.kill(id, "SIGTERM");
    }
}

/** Claude Code's stream-json mode, with one control request; the reply is its answer's `response`. */
export function askClaude(host: TurnHost, launch: AskLaunch, request: Record<string, unknown>, doing: [string, string], kind: string): Promise<unknown> {
    const requestId = randomUUID();
    return askHarness(host, launch, {
        who: "Claude",
        doing: doing[0],
        done: doing[1],
        kind,
        args: ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
        requests: [{ type: "control_request", request_id: requestId, request }],
        reply: (ev) => {
            if (ev.type !== "control_response" || ev.response?.request_id !== requestId) return undefined;
            if (ev.response.subtype !== "success") return { fail: String(ev.response.error ?? ev.response.subtype) };
            return { ok: ev.response.response };
        },
    });
}

/** Codex's app-server, initialized, with one JSON-RPC request; the reply is its result. */
export function askCodex(host: TurnHost, launch: AskLaunch, method: string, params: unknown, doing: [string, string], kind: string): Promise<unknown> {
    return askHarness(host, launch, {
        who: "Codex",
        doing: doing[0],
        done: doing[1],
        kind,
        // it looks for a newer build when it starts; the package is the only way one arrives
        args: ["app-server", "-c", "check_for_update_on_startup=false"],
        requests: [
            { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "paperboard", version: "1" } } },
            { jsonrpc: "2.0", method: "initialized" },
            { jsonrpc: "2.0", id: 2, method, params },
        ],
        reply: (ev) => {
            if (ev.id !== 1 && ev.id !== 2) return undefined;
            if (ev.error) return { fail: String(ev.error.message ?? `error ${ev.error.code ?? "?"}`) };
            return ev.id === 2 ? { ok: ev.result } : undefined;
        },
    });
}
