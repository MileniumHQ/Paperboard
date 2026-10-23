// One OpenCode turn over ACP (`opencode acp`: JSON-RPC, a message per line on
// stdin and stdout). Unlike Codex and Claude, the turn isn't the process's
// whole life: the driver opens or resumes the session, picks the model, waits
// until OpenCode has the panel's tools (it connects MCP in the background, and
// ACP doesn't say when), sends the prompt, and reports `done` when the prompt
// is answered. The conversation then stops the process.

import type { TurnEvent } from "./harness";
import { MCP_SERVER } from "./harness";

export type AcpEvent = TurnEvent | { type: "done" };

/** OpenCode retries a provider that refuses (a rate limit) with growing waits, as long as it takes; past this, the turn fails with the provider's reason */
export const RETRY_MS = 60_000;
const RETRY_META = "opencode/retry";
/** how long a cancelled prompt gets to end before the turn ends without it */
const CANCEL_MS = 10_000;

export interface AcpTurnOptions {
    cwd: string;
    /** the session to resume, if the conversation has one */
    thread: string | null;
    model: string | null;
    message: string;
    /** resolves once OpenCode has listed the panel's tools; rejects if it never does */
    ready: () => Promise<void>;
    /** one message, in order; the next waits for it */
    write: (line: string) => Promise<void>;
    emit: (ev: AcpEvent) => void;
}

type Reply = { ok: (result: any) => void; fail: (e: Error) => void };

export class AcpTurn {
    private next = 0;
    private replies = new Map<number, Reply>();
    private tools = new Map<string, string>(); // toolCallId → tool name, for this turn
    private text = "";
    private messageId: string | null = null;
    private closed = false;
    private sending: Promise<void> = Promise.resolve();
    private stopped: ((e: Error) => void)[] = [];
    private session: string | null = null;
    private retryingSince: number | null = null;
    private gaveUp: string | null = null;
    private cancelTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private o: AcpTurnOptions) {}

    /** Runs the turn; resolves after `done` is emitted, whatever happened. */
    async run(): Promise<void> {
        try {
            await this.call("initialize", { protocolVersion: 1, clientCapabilities: {} });
            const session = await this.open();
            this.session = session;
            this.o.emit({ type: "thread", id: session });
            if (this.o.model) await this.call("session/set_config_option", { sessionId: session, configId: "model", value: this.o.model });
            await this.untilClosed(this.o.ready());
            const result = await this.call("session/prompt", { sessionId: session, prompt: [{ type: "text", text: this.o.message }] });
            this.flush();
            if (this.gaveUp) this.o.emit({ type: "failed", message: this.gaveUp });
            else if (result?.stopReason === "refusal") this.o.emit({ type: "failed", message: "the model refused to answer" });
        } catch (e) {
            this.flush();
            this.o.emit({ type: "failed", message: this.gaveUp ?? (e instanceof Error ? e.message : String(e)) });
        }
        this.close();
        this.o.emit({ type: "done" });
    }

    /** One line of OpenCode's stdout. */
    line(line: string) {
        let msg: any;
        try {
            msg = JSON.parse(line);
        } catch {
            return; // not a message (a stray log line)
        }
        if (!msg || typeof msg !== "object") return;
        if (msg.method === undefined && typeof msg.id === "number") {
            const reply = this.replies.get(msg.id);
            this.replies.delete(msg.id);
            if (msg.error) reply?.fail(new Error(String(msg.error.message ?? "OpenCode refused the request")));
            else reply?.ok(msg.result);
            return;
        }
        if (msg.method === "session/update") return this.update(msg.params?.update);
        if (msg.id === undefined) return;
        // the only tools left are the panel's and web search, which need no permission: anything else is refused
        if (msg.method === "session/request_permission") return this.answer({ id: msg.id, result: { outcome: { outcome: "selected", optionId: "reject" } } });
        this.answer({ id: msg.id, error: { code: -32601, message: `${msg.method} isn't offered` } });
    }

    /** The process is gone: nothing more will be answered. */
    close() {
        if (this.closed) return;
        this.closed = true;
        if (this.cancelTimer) clearTimeout(this.cancelTimer);
        const replies = [...this.replies.values()];
        this.replies.clear();
        this.tools.clear();
        const gone = new Error("OpenCode stopped before answering");
        for (const r of replies) r.fail(gone);
        for (const stop of this.stopped.splice(0)) stop(gone);
    }

    private untilClosed<T>(p: Promise<T>): Promise<T> {
        if (this.closed) return Promise.reject(new Error("OpenCode stopped before answering"));
        return new Promise<T>((ok, fail) => {
            this.stopped.push(fail);
            p.then(ok, fail);
        });
    }

    private async open(): Promise<string> {
        const params = { cwd: this.o.cwd, mcpServers: [] };
        if (this.o.thread) {
            // resume attaches without replaying the history; a session OpenCode no longer has starts a new one
            const resumed = await this.call("session/resume", { sessionId: this.o.thread, ...params }).then(
                () => true,
                () => false,
            );
            if (resumed) return this.o.thread;
        }
        const created = await this.call("session/new", params);
        if (typeof created?.sessionId !== "string") throw new Error("OpenCode didn't open a session");
        return created.sessionId;
    }

    private update(u: any) {
        if (!u || typeof u !== "object") return;
        if (u.sessionUpdate === "agent_message_chunk" || u.sessionUpdate === "tool_call") this.retryingSince = null; // the provider answered
        if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text" && typeof u.content.text === "string") {
            if (u.messageId !== this.messageId) this.flush();
            if (!this.text) this.o.emit({ type: "typing" });
            this.messageId = u.messageId ?? null;
            this.text += u.content.text;
            return;
        }
        if (u.sessionUpdate === "tool_call" && typeof u.toolCallId === "string") {
            this.flush();
            const name = String(u.name ?? "");
            this.tools.set(u.toolCallId, name);
            this.o.emit({ type: name === `${MCP_SERVER}_send_message` ? "typing" : "working" });
            return;
        }
        if (u.sessionUpdate === "session_info_update" && u._meta && RETRY_META in u._meta) return this.retrying(u._meta[RETRY_META]);
        // a text that's gone out: the model's next step is work until it says otherwise
        if (u.sessionUpdate === "tool_call_update" && (u.status === "completed" || u.status === "failed") && this.tools.get(u.toolCallId) === `${MCP_SERVER}_send_message`) {
            this.o.emit({ type: "working" });
            return;
        }
        if (u.sessionUpdate === "tool_call_update" && u.status === "in_progress" && this.tools.get(u.toolCallId) === "websearch") {
            this.tools.set(u.toolCallId, ""); // shown once
            this.o.emit({ type: "search", query: String(u.rawInput?.query ?? "") });
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
        this.gaveUp = `${reason} (OpenCode was still retrying after a minute, so this turn stopped)`;
        // the prompt then ends as cancelled; if it doesn't, the turn ends anyway
        this.send({ method: "session/cancel", params: { sessionId: this.session } }).catch(() => this.close());
        this.cancelTimer = setTimeout(() => this.close(), CANCEL_MS);
    }

    private flush() {
        if (this.text.trim()) this.o.emit({ type: "message", text: this.text });
        this.text = "";
        this.messageId = null;
    }

    private call(method: string, params: unknown): Promise<any> {
        if (this.closed) return Promise.reject(new Error("OpenCode stopped before answering"));
        const id = this.next++;
        return new Promise((ok, fail) => {
            this.replies.set(id, { ok, fail });
            // a request that can't be written is never answered
            this.send({ id, method, params }).catch((e) => {
                if (this.replies.delete(id)) fail(e);
            });
        });
    }

    /** An answer to OpenCode's own request: one that can't be written leaves it waiting, so the turn ends. */
    private answer(msg: Record<string, unknown>) {
        this.send(msg).catch(() => this.close());
    }

    private send(msg: Record<string, unknown>): Promise<void> {
        const line = `${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`;
        // a failed write was its sender's failure; the next one still goes after it
        this.sending = this.sending.then(
            () => this.o.write(line),
            () => this.o.write(line),
        );
        return this.sending;
    }
}
