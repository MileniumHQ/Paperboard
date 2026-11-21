// One turn over ACP (JSON-RPC, a message per line on stdin and stdout), shared
// by OpenCode (`opencode acp`) and Antigravity (`agy acp`). Unlike Codex and
// Claude, the turn isn't the process's whole life: the driver opens or resumes
// the session, picks the model, waits until the harness has the panel's tools
// (OpenCode connects MCP in the background; Antigravity takes mcpServers in
// session/new), sends the prompt, and reports `done` when the prompt is
// answered. The conversation then stops the process.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { errorMessage } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../contract";
import type { StartOptions } from "./browser";
import type { TurnEvent } from "./harness";
import { MCP_SERVER } from "./harness";
import { lineReader } from "./lines";
import { writeLine } from "./mcpClient";

export type AcpEvent = TurnEvent | { type: "done" };

/** OpenCode retries a provider that refuses (a rate limit) with growing waits, as long as it takes; past this, the turn fails with the provider's reason */
const RETRY_MS = 60_000;
const RETRY_META = "opencode/retry";
/** how long a cancelled prompt gets to end before the turn ends without it */
const CANCEL_MS = 10_000;
const MAX_RPC_LINE = 16 * 1024 * 1024;

export interface AcpMcpServer {
    type: "http";
    name: string;
    url: string;
    headers?: { name: string; value: string }[];
}

export interface AcpTurnOptions {
    /** display name used in error messages ("OpenCode", "Antigravity") */
    who: string;
    cwd: string;
    /** the session to resume, if the conversation has one */
    thread: string | null;
    model: string | null;
    message: string;
    /** MCP servers passed directly in session/new and session/resume (Antigravity) */
    mcpServers?: AcpMcpServer[];
    /** extra parameters merged into session/new and session/resume */
    sessionParams?: Record<string, unknown>;
    /** resolves once the harness has listed the panel's tools; rejects if it never does */
    ready: () => Promise<void>;
    /** one message, in order; the next waits for it */
    write: (line: string) => Promise<void>;
    emit: (ev: AcpEvent) => void;
}

export class AcpRpcError extends Error {
    constructor(
        readonly code: number | undefined,
        message: string,
    ) {
        super(message);
    }
}

type Reply = { ok: (result: any) => void; fail: (e: Error) => void };

const isSendMessage = (name: string) => name === `${MCP_SERVER}_send_message` || name === `mcp_${MCP_SERVER}_send_message`;

/**
 * Shared JSON-RPC-over-stdio connection for both long-lived ACP turns (`AcpTurn`)
 * and short-lived ACP queries (`runAcpCall`). Owns request ids, ordered writes,
 * response matching, `AcpRpcError` decoding, and closing with a preserved failure.
 */
class AcpClient {
    private next = 0;
    private replies = new Map<number, Reply>();
    private sending: Promise<void> = Promise.resolve();
    private stopped: ((e: Error) => void)[] = [];
    private closedError: Error | null = null;

    constructor(
        private readonly who: string,
        private readonly write: (line: string) => Promise<void>,
    ) {}

    get closed(): boolean {
        return this.closedError !== null;
    }

    call(method: string, params: unknown): Promise<any> {
        if (this.closedError) return Promise.reject(this.closedError);
        const id = this.next++;
        return new Promise((ok, fail) => {
            this.replies.set(id, { ok, fail });
            // a request that can't be written is never answered
            this.send({ id, method, params }).catch((e) => {
                if (this.replies.delete(id)) fail(e instanceof Error ? e : new Error(String(e)));
            });
        });
    }

    /** An answer to the harness's own request: one that can't be written leaves it waiting, so the connection ends. */
    answer(msg: Record<string, unknown>) {
        this.send(msg).catch((e) => this.close(e instanceof Error ? e : new Error(String(e))));
    }

    send(msg: Record<string, unknown>): Promise<void> {
        const line = `${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`;
        // a failed write was its sender's failure; the next one still goes after it
        this.sending = this.sending.then(
            () => this.write(line),
            () => this.write(line),
        );
        return this.sending;
    }

    /** Parses one stdout line, resolves matching replies, and hands incoming requests/notifications to `onIncoming`. */
    line(line: string, onIncoming?: (msg: any) => void) {
        let msg: any;
        try {
            msg = JSON.parse(line);
        } catch {
            return; // quiet: not a message (a stray log line)
        }
        if (!msg || typeof msg !== "object") return;
        if (msg.method === undefined && typeof msg.id === "number") {
            const reply = this.replies.get(msg.id);
            this.replies.delete(msg.id);
            if (msg.error) reply?.fail(new AcpRpcError(typeof msg.error.code === "number" ? msg.error.code : undefined, String(msg.error.message ?? `${this.who} refused the request`)));
            else reply?.ok(msg.result);
            return;
        }
        onIncoming?.(msg);
    }

    /** Rejects when the connection closes (even if it closed before `untilClosed` was called). */
    untilClosed<T>(p: Promise<T>): Promise<T> {
        if (this.closedError) return Promise.reject(this.closedError);
        return new Promise<T>((ok, fail) => {
            this.stopped.push(fail);
            p.then(ok, fail);
        });
    }

    close(err?: Error) {
        if (this.closedError) return;
        const gone = err ?? new Error(`${this.who} stopped before answering`);
        this.closedError = gone;
        const pending = [...this.replies.values()];
        this.replies.clear();
        for (const r of pending) r.fail(gone);
        for (const stop of this.stopped.splice(0)) stop(gone);
    }
}

/** Pick the refusal option from an ACP `session/request_permission` payload. */
function rejectOptionId(params: any): string {
    const options: { optionId?: unknown; kind?: unknown }[] = Array.isArray(params?.options) ? params.options : [];
    for (const kind of ["reject_once", "reject_always"]) {
        const match = options.find((o) => o?.kind === kind && typeof o.optionId === "string");
        if (match) return match.optionId as string;
    }
    return "reject";
}

export class AcpTurn {
    private client: AcpClient;
    private tools = new Map<string, string>(); // toolCallId → tool name, for this turn
    private text = "";
    private messageId: string | null = null;
    private session: string | null = null;
    private retryingSince: number | null = null;
    private gaveUp: string | null = null;
    private cancelTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private o: AcpTurnOptions) {
        this.client = new AcpClient(o.who, o.write);
    }

    /** Runs the turn; resolves after `done` is emitted, whatever happened. */
    async run(): Promise<void> {
        try {
            await this.client.call("initialize", { protocolVersion: 1, clientCapabilities: {} });
            const session = await this.open();
            this.session = session;
            this.o.emit({ type: "thread", id: session });
            if (this.o.model) await this.client.call("session/set_config_option", { sessionId: session, configId: "model", value: this.o.model });
            await this.client.untilClosed(this.o.ready());
            const result = await this.client.call("session/prompt", { sessionId: session, prompt: [{ type: "text", text: this.o.message }] });
            this.flush();
            if (this.gaveUp) this.o.emit({ type: "failed", message: this.gaveUp });
            else if (result?.stopReason === "refusal") this.o.emit({ type: "failed", message: "the model refused to answer" });
        } catch (e) {
            this.flush();
            this.o.emit({ type: "failed", message: this.gaveUp ?? errorMessage(e) });
        }
        this.close();
        this.o.emit({ type: "done" });
    }

    /** One line of the harness's stdout. */
    line(line: string) {
        this.client.line(line, (msg) => {
            if (msg.method === "session/update") return this.update(msg.params?.update);
            if (msg.id === undefined) return;
            // Every permission prompt is refused: the panel's own tools are pre-allowed by config/settings,
            // and nothing else is allowed to run interactively.
            if (msg.method === "session/request_permission") {
                return this.client.answer({ id: msg.id, result: { outcome: { outcome: "selected", optionId: rejectOptionId(msg.params) } } });
            }
            this.client.answer({ id: msg.id, error: { code: -32601, message: `${msg.method} isn't offered` } });
        });
    }

    /** The process is gone: nothing more will be answered. */
    close() {
        if (this.cancelTimer) clearTimeout(this.cancelTimer);
        this.tools.clear();
        this.client.close();
    }

    private async open(): Promise<string> {
        const params = { cwd: this.o.cwd, mcpServers: this.o.mcpServers ?? [], ...this.o.sessionParams };
        if (this.o.thread) {
            // resume attaches without replaying the history; a session the harness no longer has starts a new one
            const resumed = await this.client.call("session/resume", { sessionId: this.o.thread, ...params }).then(
                () => true,
                () => false,
            );
            if (resumed) return this.o.thread;
        }
        const created = await this.client.call("session/new", params);
        if (typeof created?.sessionId !== "string") throw new Error(`${this.o.who} didn't open a session`);
        return created.sessionId;
    }

    private update(u: any) {
        if (!u || typeof u !== "object") return;
        if (u.sessionUpdate === "agent_message_chunk" || u.sessionUpdate === "tool_call") this.retryingSince = null; // the provider answered
        if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text" && typeof u.content.text === "string") {
            if (u.messageId !== this.messageId) this.flush();
            this.messageId = u.messageId ?? null;
            this.text += u.content.text;
            return;
        }
        if (u.sessionUpdate === "tool_call" && typeof u.toolCallId === "string") {
            this.flush();
            const name = String(u.name ?? u.title ?? "");
            this.tools.set(u.toolCallId, name);
            this.o.emit(isSendMessage(name) ? { type: "typing" } : { type: "working" });
            return;
        }
        // how much of the model's context the session fills, and its window
        if (u.sessionUpdate === "usage_update" && typeof u.used === "number") {
            this.o.emit({ type: "context", used: u.used, ...(typeof u.size === "number" && u.size > 0 ? { size: u.size } : {}) });
            return;
        }
        if (u.sessionUpdate === "session_info_update" && u._meta && RETRY_META in u._meta) return this.retrying(u._meta[RETRY_META]);
        // a text that's gone out: the model's next step is work until it says otherwise
        if (u.sessionUpdate === "tool_call_update" && (u.status === "completed" || u.status === "failed") && isSendMessage(this.tools.get(u.toolCallId) ?? "")) {
            this.o.emit({ type: "working" });
            return;
        }
    }

    /** OpenCode is waiting to retry the provider. It clears the notice (null) at each attempt, so only the model's output ends the wait. */
    private retrying(retry: any) {
        if (!retry || typeof retry !== "object") return;
        this.o.emit({ type: "working" });
        const now = Date.now();
        this.retryingSince ??= now;
        const next = Date.parse(String(retry.nextRetryAt ?? ""));
        const until = Number.isFinite(next) ? next : now;
        if (this.gaveUp || !this.session || until - this.retryingSince <= RETRY_MS) return;
        const reason = typeof retry.error?.message === "string" && retry.error.message.trim() ? retry.error.message.trim() : "the model's provider keeps refusing";
        this.gaveUp = `${reason} (${this.o.who} was still retrying after a minute, so this turn stopped)`;
        // the prompt then ends as cancelled; if it doesn't, the turn ends anyway
        this.client.send({ method: "session/cancel", params: { sessionId: this.session } }).catch(() => this.close());
        this.cancelTimer = setTimeout(() => this.close(), CANCEL_MS);
    }

    private flush() {
        if (this.text.trim()) this.o.emit({ type: "message", text: this.text });
        this.text = "";
        this.messageId = null;
    }
}

export interface AcpProcessHost {
    start(o: StartOptions): Promise<unknown>;
    write(id: string, data: string): Promise<void>;
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    onStdout(id: string, cb: (data: string) => void): () => void;
    onStderr(id: string, cb: (data: string) => void): () => void;
    onExit(id: string, cb: (code?: number) => void): () => void;
}

export type AcpCall = (method: string, params: unknown) => Promise<any>;

/**
 * Starts a short-lived ACP server, runs `initialize`, executes `run(call)`, and stops it cleanly.
 * Used for Antigravity's status check (`session/list`) and model listing (`session/new`).
 */
export async function runAcpCall<T>(
    host: AcpProcessHost,
    opts: {
        label: string;
        who: string;
        command: string;
        args: string[];
        cwd: string;
        env: Record<string, string>;
        timeoutMs: number;
    },
    run: (call: AcpCall) => Promise<T>,
): Promise<T> {
    const id = `${PANEL_ID}.acp.${opts.label}.${randomUUID()}`;
    const client = new AcpClient(opts.who, (line) => writeLine(host.write, id, line));
    let stderr = "";

    const offs = [
        host.onStdout(id, lineReader(MAX_RPC_LINE, (line) => client.line(line), () => client.close(new Error(`${opts.who}'s answer is too big`))).push),
        host.onStderr(id, (data) => {
            stderr = (stderr + data).slice(-2000);
        }),
        host.onExit(id, (code) => {
            const said = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
            client.close(new Error(`${opts.who} ended before answering (exit ${code ?? "?"})${said ? `: ${said}` : "."}`));
        }),
    ];
    const timer = setTimeout(() => client.close(new Error(`${opts.who} didn't answer within ${Math.round(opts.timeoutMs / 1000)} seconds.`)), opts.timeoutMs);
    try {
        fs.mkdirSync(opts.cwd, { recursive: true });
        await client.untilClosed(host.start({ id, command: opts.command, args: opts.args, cwd: opts.cwd, env: opts.env }));
        return await client.untilClosed(
            (async () => {
                await client.call("initialize", { protocolVersion: 1, clientCapabilities: {} });
                return await run((method, params) => client.call(method, params));
            })(),
        );
    } finally {
        client.close();
        clearTimeout(timer);
        for (const off of offs) off();
        if (await host.exists(id)) await host.kill(id, "SIGTERM");
    }
}
