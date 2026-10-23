// An MCP client (JSON-RPC 2.0: initialize, tools/list, tools/call) over three
// wires: a stdio child of this computer (daemon-supervised, through the
// panel's process API), a stdio child inside the agent's computer (through
// the guest agent's relay), or streamable HTTP. A wire carries requests and
// answers; the client on top speaks the protocol.
//
// Everything is bounded: messages, pending requests, time, stderr kept.

import type { ToolResult } from "./computerMcp";

export const PROTOCOL_VERSION = "2025-06-18";
export const MAX_MESSAGE = 4 * 1024 * 1024;
const MAX_PENDING = 32;
const MAX_TOOLS = 500;
const MAX_PAGES = 10;
const STDERR_KEEP = 2000;
const STOP_GRACE_MS = 2000;

export const TIMEOUTS = { initialize: 20_000, list: 15_000, call: 120_000 } as const;

export interface McpTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/** A way to reach one server. A request resolves with the answer's `result` or rejects with its error. */
export interface McpWire {
    request(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
    notify(method: string, params?: unknown): Promise<void>;
    /** stop it and observe that it stopped */
    close(): Promise<void>;
    /** the wire ended on its own (child exit, relay lost); at most once */
    onEnd(cb: (reason: string) => void): void;
}

export class McpRpcError extends Error {
    constructor(
        message: string,
        readonly code: number,
    ) {
        super(message);
    }
}

// ------------------------------------------------------------- the protocol

export class McpClient {
    serverName = "";
    constructor(private wire: McpWire) {}

    async initialize(): Promise<void> {
        const r = (await this.wire.request(
            "initialize",
            { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "paperboard", version: "0.1.0" } },
            TIMEOUTS.initialize,
        )) as { serverInfo?: { name?: unknown } } | null;
        if (!r || typeof r !== "object") throw new Error("the server answered initialize with nothing");
        if (typeof r.serverInfo?.name === "string") this.serverName = r.serverInfo.name.slice(0, 64);
        await this.wire.notify("notifications/initialized");
    }

    async listTools(): Promise<McpTool[]> {
        const out: McpTool[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
            const r = (await this.wire.request("tools/list", cursor ? { cursor } : {}, TIMEOUTS.list)) as { tools?: unknown; nextCursor?: unknown } | null;
            if (!r || !Array.isArray(r.tools)) throw new Error("the server's tool list isn't a list");
            for (const t of r.tools) {
                if (!t || typeof t !== "object" || typeof (t as any).name !== "string" || !(t as any).name) continue;
                const schema = (t as any).inputSchema;
                out.push({
                    name: String((t as any).name),
                    description: typeof (t as any).description === "string" ? (t as any).description : "",
                    inputSchema: schema && typeof schema === "object" && !Array.isArray(schema) ? schema : { type: "object" },
                });
                if (out.length >= MAX_TOOLS) return out;
            }
            if (typeof r.nextCursor !== "string" || !r.nextCursor) return out;
            cursor = r.nextCursor;
        }
        return out;
    }

    async callTool(name: string, args: Record<string, unknown>, timeoutMs: number = TIMEOUTS.call): Promise<ToolResult> {
        const r = await this.wire.request("tools/call", { name, arguments: args }, timeoutMs);
        return toToolResult(r);
    }

    close() {
        return this.wire.close();
    }
    onEnd(cb: (reason: string) => void) {
        this.wire.onEnd(cb);
    }
}

const MAX_TEXT = 32_000;

/** An MCP tool result as the agent's tool result. Only PNG images pass through; others are named, not carried. */
export function toToolResult(r: unknown): ToolResult {
    const res = (r ?? {}) as { content?: unknown; isError?: unknown; structuredContent?: unknown };
    const parts: string[] = [];
    let image: string | undefined;
    if (Array.isArray(res.content)) {
        for (const c of res.content as any[]) {
            if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
            else if (c?.type === "image" && typeof c.data === "string") {
                if (c.mimeType === "image/png" && !image) image = c.data;
                else parts.push(`[an ${String(c.mimeType ?? "image").slice(0, 40)} image was returned; only one PNG can be shown]`);
            } else if (c?.type === "resource" && c.resource) {
                const rs = c.resource;
                parts.push(typeof rs.text === "string" ? rs.text : `[resource ${String(rs.uri ?? "").slice(0, 200)}]`);
            } else if (c?.type === "resource_link") parts.push(`[resource ${String(c.uri ?? "").slice(0, 200)}]`);
        }
    }
    if (!parts.length && !image && res.structuredContent !== undefined) parts.push(JSON.stringify(res.structuredContent));
    let text = parts.join("\n");
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + `\n… ${text.length - MAX_TEXT} characters cut …`;
    return { text: text || (image ? "" : "(the tool returned nothing)"), image, isError: res.isError === true };
}

// ------------------------------------------------------------- stdio on this computer

export interface ProcessHost {
    start(o: { id: string; command: string; args: string[]; env?: Record<string, string> }): Promise<unknown>;
    write(id: string, data: string): Promise<void>;
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    onStdout(id: string, cb: (data: string) => void): () => void;
    onStderr(id: string, cb: (data: string) => void): () => void;
    onExit(id: string, cb: (code?: number) => void): () => void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/** A server run as a daemon-owned child; its stdout carries one JSON-RPC message per line. */
export class StdioWire implements McpWire {
    private pending = new Map<number, Pending>();
    private next = 1;
    private buf = "";
    private stderr = "";
    private offs: (() => void)[] = [];
    private ended: string | null = null;
    private endCbs: ((reason: string) => void)[] = [];
    private exited: Promise<void>;
    private markExited!: () => void;
    private closing = false;

    private constructor(
        private host: ProcessHost,
        readonly id: string,
    ) {
        this.exited = new Promise((ok) => (this.markExited = ok));
    }

    /** Start the child. Its output is subscribed before it runs, so nothing is missed. */
    static async start(host: ProcessHost, o: { id: string; command: string; args: string[]; env?: Record<string, string> }): Promise<StdioWire> {
        // a child the last service generation left behind is not ours to talk to
        if (await host.exists(o.id)) {
            await host.kill(o.id, "SIGKILL");
            const end = Date.now() + STOP_GRACE_MS;
            while (await host.exists(o.id)) {
                if (Date.now() > end) throw new Error("an earlier copy of this server is still running and won't stop");
                await new Promise((r) => setTimeout(r, 25));
            }
        }
        const wire = new StdioWire(host, o.id);
        wire.offs.push(
            host.onStdout(o.id, (d) => wire.onData(d)),
            host.onStderr(o.id, (d) => (wire.stderr = (wire.stderr + d).slice(-STDERR_KEEP))),
            host.onExit(o.id, (code) => wire.onExit(code)),
        );
        try {
            await host.start(o);
        } catch (e) {
            wire.unsubscribe();
            throw e;
        }
        return wire;
    }

    private onData(d: string) {
        this.buf += d;
        for (let i = this.buf.indexOf("\n"); i >= 0; i = this.buf.indexOf("\n")) {
            const line = this.buf.slice(0, i).trim();
            this.buf = this.buf.slice(i + 1);
            if (line) this.onLine(line);
        }
        if (this.buf.length > MAX_MESSAGE) {
            this.buf = "";
            void this.fail("the server sent a message past the size limit");
        }
    }

    private onLine(line: string) {
        let m: any;
        try {
            m = JSON.parse(line);
        } catch {
            return; // a server logging to stdout: not a message
        }
        if (!m || typeof m !== "object" || m.id === undefined || m.method !== undefined) return; // notifications and server requests: we offer no capabilities
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.reject(new McpRpcError(String(m.error.message ?? "error"), Number(m.error.code ?? -32603)));
        else p.resolve(m.result);
    }

    private onExit(code?: number) {
        const tail = this.stderr.trim().split("\n").slice(-3).join(" | ");
        this.finish(this.closing ? "stopped" : `the server exited${code !== undefined ? ` (${code})` : ""}${tail ? `: ${tail}` : ""}`);
        this.markExited();
    }

    private finish(reason: string) {
        if (this.ended !== null) return;
        this.ended = reason;
        this.unsubscribe();
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error(reason));
        }
        this.pending.clear();
        if (!this.closing) for (const cb of this.endCbs) cb(reason);
    }

    private unsubscribe() {
        for (const off of this.offs.splice(0)) off();
    }

    private async fail(reason: string) {
        try {
            await this.close();
        } finally {
            this.finish(reason);
        }
    }

    async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
        if (this.ended !== null) throw new Error(this.ended);
        if (this.pending.size >= MAX_PENDING) throw new Error("too many requests are waiting on this server");
        const id = this.next++;
        const done = new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`the server didn't answer ${method} within ${Math.round(timeoutMs / 1000)} s`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
        });
        try {
            await this.send({ jsonrpc: "2.0", id, method, params });
        } catch (e) {
            const p = this.pending.get(id);
            if (p) {
                clearTimeout(p.timer);
                this.pending.delete(id);
            }
            throw e;
        }
        return done;
    }

    async notify(method: string, params?: unknown): Promise<void> {
        if (this.ended !== null) throw new Error(this.ended);
        await this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
    }

    private async send(msg: unknown) {
        const line = JSON.stringify(msg) + "\n";
        if (line.length > MAX_MESSAGE) throw new Error("that message is too large to send");
        await writeLine(this.host.write, this.id, line);
    }

    onEnd(cb: (reason: string) => void) {
        if (this.ended !== null) return;
        this.endCbs.push(cb);
    }

    /** Ask it to stop, then make it, and return once the daemon says it's gone. */
    async close(): Promise<void> {
        this.closing = true;
        if (this.ended === null || (await this.host.exists(this.id))) {
            await this.host.kill(this.id, "SIGTERM");
            if (!(await this.stopped(STOP_GRACE_MS))) {
                await this.host.kill(this.id, "SIGKILL");
                if (!(await this.stopped(STOP_GRACE_MS))) throw new Error(`${this.id} didn't stop`);
            }
        }
        this.finish("stopped");
    }

    private async stopped(ms: number): Promise<boolean> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<boolean>((ok) => (timer = setTimeout(() => ok(false), ms)));
        try {
            return await Promise.race([this.exited.then(() => true), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }
}

// ------------------------------------------------------------- stdio inside the agent's computer

/** The guest agent's relay (agent.py, mcp_* calls): the same JSON-RPC, carried by its authenticated HTTP API. */
export type GuestCall = (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;

export class GuestWire implements McpWire {
    private ended = false;
    private endCbs: ((reason: string) => void)[] = [];

    private constructor(
        private call: GuestCall,
        readonly id: string,
    ) {}

    static async start(call: GuestCall, o: { id: string; argv: string[]; env: Record<string, string> }): Promise<GuestWire> {
        const r = await call("mcp_start", { id: o.id, argv: o.argv, env: o.env });
        if (r.isError) throw new Error(r.text);
        return new GuestWire(call, o.id);
    }

    async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
        if (this.ended) throw new Error("the server stopped");
        const r = await this.call("mcp_rpc", { id: this.id, message: { jsonrpc: "2.0", id: 1, method, params }, timeout: timeoutMs / 1000 });
        if (r.isError) {
            // the guest lost the server (its agent restarted, or the child exited)
            if (/isn't running|no such server/i.test(r.text)) this.end(r.text);
            throw new Error(r.text);
        }
        let m: any;
        try {
            m = JSON.parse(r.text);
        } catch {
            throw new Error("the computer's relay answered with something that isn't JSON");
        }
        if (m?.error) throw new McpRpcError(String(m.error.message ?? "error"), Number(m.error.code ?? -32603));
        return m?.result;
    }

    async notify(method: string, params?: unknown): Promise<void> {
        if (this.ended) throw new Error("the server stopped");
        const r = await this.call("mcp_rpc", { id: this.id, message: { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }, timeout: 5 });
        if (r.isError) throw new Error(r.text);
    }

    private end(reason: string) {
        if (this.ended) return;
        this.ended = true;
        for (const cb of this.endCbs) cb(reason);
    }

    onEnd(cb: (reason: string) => void) {
        this.endCbs.push(cb);
    }

    async close(): Promise<void> {
        if (this.ended) return;
        this.ended = true;
        const r = await this.call("mcp_stop", { id: this.id });
        if (r.isError) throw new Error(r.text);
    }
}

// ------------------------------------------------------------- streamable HTTP

export interface HttpWireOptions {
    url: string;
    headers: Record<string, string>;
    fetch?: typeof fetch;
}

/** POST a message, get one JSON answer or an event stream carrying it. No server push stream is opened. */
export class HttpWire implements McpWire {
    private session: string | null = null;
    private version: string = PROTOCOL_VERSION;
    private next = 1;
    private inflight = new Set<AbortController>();
    private closed = false;

    constructor(private o: HttpWireOptions) {}

    private async post(message: Record<string, unknown>, timeoutMs: number): Promise<Response> {
        if (this.closed) throw new Error("the connection was closed");
        if (this.inflight.size >= MAX_PENDING) throw new Error("too many requests are waiting on this server");
        const ctl = new AbortController();
        this.inflight.add(ctl);
        const timer = setTimeout(() => ctl.abort(new Error(`the server didn't answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
        try {
            const body = JSON.stringify(message);
            if (body.length > MAX_MESSAGE) throw new Error("that message is too large to send");
            const res = await (this.o.fetch ?? fetch)(this.o.url, {
                method: "POST",
                // a redirect would carry the headers (and their secrets) somewhere else
                redirect: "error",
                signal: ctl.signal,
                headers: {
                    ...this.o.headers,
                    "Content-Type": "application/json",
                    Accept: "application/json, text/event-stream",
                    ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
                    "MCP-Protocol-Version": this.version,
                },
                body,
            });
            // the timer and controller live until the body is read
            const release = () => {
                clearTimeout(timer);
                this.inflight.delete(ctl);
            };
            return Object.assign(res, { release });
        } catch (e) {
            clearTimeout(timer);
            this.inflight.delete(ctl);
            throw ctl.signal.aborted && ctl.signal.reason instanceof Error ? ctl.signal.reason : e;
        }
    }

    async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
        const id = this.next++;
        const res = (await this.post({ jsonrpc: "2.0", id, method, params }, timeoutMs)) as Response & { release(): void };
        try {
            if (!res.ok) {
                const detail = (await errorDetail(res)).slice(0, 300);
                throw new Error(`the server answered ${res.status}${detail ? `: ${detail}` : ""}`);
            }
            const sid = res.headers.get("mcp-session-id");
            if (sid && method === "initialize") this.session = sid;
            const type = res.headers.get("content-type") ?? "";
            const reply = type.includes("text/event-stream") ? await readEvents(res, id) : parseMessage(await readCapped(res, MAX_MESSAGE), id);
            if (reply.error) throw new McpRpcError(String(reply.error.message ?? "error"), Number(reply.error.code ?? -32603));
            if (method === "initialize" && typeof reply.result?.protocolVersion === "string") this.version = reply.result.protocolVersion;
            return reply.result;
        } finally {
            res.release();
            // an unread body must not hold the connection
            await discard(res.body);
        }
    }

    async notify(method: string, params?: unknown): Promise<void> {
        const res = (await this.post({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }, 10_000)) as Response & { release(): void };
        try {
            if (!res.ok && res.status !== 202) throw new Error(`the server answered ${res.status} to ${method}`);
        } finally {
            res.release();
            await discard(res.body);
        }
    }

    onEnd(): void {
        // no process, no stream: the server being down shows as the next request failing
    }

    async close(): Promise<void> {
        this.closed = true;
        for (const c of this.inflight) c.abort(new Error("closed"));
        if (!this.session) return;
        // ending the session is a courtesy; a server may refuse (405) or be gone
        const res = await (this.o.fetch ?? fetch)(this.o.url, {
            method: "DELETE",
            redirect: "error",
            headers: { ...this.o.headers, "Mcp-Session-Id": this.session },
            signal: AbortSignal.timeout(3000),
        }).catch((e: Error) => {
            console.error(`[ai] couldn't end the session with ${new URL(this.o.url).host}: ${e.message}`);
            return null;
        });
        await discard(res?.body);
    }
}

/** Let go of a stream we're done with; a stream that won't cancel is logged, it can't change the outcome. */
async function discard(s: { cancel(): Promise<void>; locked?: boolean } | null | undefined): Promise<void> {
    // a stream someone read is already finished with (or cancelled by its reader)
    if (s?.locked) return;
    try {
        await s?.cancel();
    } catch (e) {
        console.error("[ai] couldn't release a response stream:", String(e));
    }
}

/** What a failing server said, if it said anything readable; the failure itself is reported either way. */
async function errorDetail(res: Response): Promise<string> {
    try {
        return (await readCapped(res, 2000, true)).trim();
    } catch (e) {
        return `(${(e as Error).message})`;
    }
}

async function readCapped(res: Response, max: number, truncate = false): Promise<string> {
    if (!res.body) return "";
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let out = "";
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return out + dec.decode();
        size += value.length;
        if (size > max) {
            await reader.cancel();
            // an error's explanation is read as far as the cap; an answer past it is refused
            if (truncate) return out + dec.decode(value.subarray(0, max - (size - value.length)));
            throw new Error("the server's answer is past the size limit");
        }
        out += dec.decode(value, { stream: true });
    }
}

function parseMessage(raw: string, id: number): any {
    let m: any;
    try {
        m = JSON.parse(raw);
    } catch {
        throw new Error("the server's answer isn't JSON");
    }
    const found = Array.isArray(m) ? m.find((x) => x?.id === id) : m;
    if (!found || found.id !== id) throw new Error("the server's answer isn't for this request");
    return found;
}

/** Read server-sent events until the answer to `id` arrives. Other messages (progress, logs) are dropped. */
async function readEvents(res: Response, id: number): Promise<any> {
    if (!res.body) throw new Error("the server sent an empty stream");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > MAX_MESSAGE * 2) throw new Error("the server's stream is past the size limit");
            buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
            for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
                const block = buf.slice(0, i);
                buf = buf.slice(i + 2);
                const data = block
                    .split("\n")
                    .filter((l) => l.startsWith("data:"))
                    .map((l) => l.slice(5).replace(/^ /, ""))
                    .join("\n");
                if (!data) continue;
                let m: any;
                try {
                    m = JSON.parse(data);
                } catch {
                    continue;
                }
                if (m?.id === id && m.method === undefined) return m;
            }
        }
    } finally {
        await discard(reader);
    }
    throw new Error("the server's stream ended without an answer");
}

/** Text to a daemon-owned child's stdin. The daemon takes at most 64 KiB per write, so it goes in pieces, never splitting a character. */
export async function writeLine(write: (id: string, data: string) => Promise<void>, id: string, text: string): Promise<void> {
    for (let i = 0; i < text.length; ) {
        let end = Math.min(i + 32_768, text.length);
        const c = text.charCodeAt(end - 1);
        if (end < text.length && c >= 0xd800 && c <= 0xdbff) end--;
        await write(id, text.slice(i, end));
        i = end;
    }
}
