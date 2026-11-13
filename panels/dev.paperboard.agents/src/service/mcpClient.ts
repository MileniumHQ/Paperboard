// An MCP client (JSON-RPC 2.0: initialize, tools/list, tools/call) over two
// wires: a stdio child of this computer (daemon-supervised, through the
// panel's process API), or streamable HTTP. A wire carries requests and
// answers; the client on top speaks the protocol.
//
// Everything is bounded: messages, pending requests, time, stderr kept.

import { isImageType, type ToolImage, type ToolResult } from "./computerMcp";

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

/** images one result carries to the agent; a tool returning more names the rest */
export const MAX_IMAGES = 8;

/**
 * An MCP tool result as the agent's tool result. Images it can see (PNG,
 * JPEG, GIF, WebP), sent as image content or as an embedded resource's blob,
 * pass through, up to MAX_IMAGES; any other is named in the text so the agent
 * knows it was there.
 */
export function toToolResult(r: unknown): ToolResult {
    const res = (r ?? {}) as { content?: unknown; isError?: unknown; structuredContent?: unknown };
    const parts: string[] = [];
    const images: ToolImage[] = [];
    const image = (data: string, type: unknown, what: string) => {
        const named = String(type ?? "unnamed").slice(0, 40);
        if (!isImageType(type)) parts.push(`[${what} of type ${named} was returned; only PNG, JPEG, GIF and WebP images can be shown]`);
        else if (images.length >= MAX_IMAGES) parts.push(`[another ${named} image was returned; only ${MAX_IMAGES} images can be shown at once]`);
        else images.push({ data, type });
    };
    if (Array.isArray(res.content)) {
        for (const c of res.content as any[]) {
            if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
            else if (c?.type === "image" && typeof c.data === "string") image(c.data, c.mimeType, "an image");
            else if (c?.type === "resource" && c.resource) {
                const rs = c.resource;
                const uri = String(rs.uri ?? "").slice(0, 200);
                if (typeof rs.text === "string") parts.push(rs.text);
                else if (typeof rs.blob === "string" && typeof rs.mimeType === "string" && rs.mimeType.startsWith("image/")) image(rs.blob, rs.mimeType, `the image ${uri}`);
                else parts.push(`[resource ${uri}]`);
            } else if (c?.type === "resource_link") parts.push(`[resource ${String(c.uri ?? "").slice(0, 200)}]`);
        }
    }
    if (!parts.length && !images.length && res.structuredContent !== undefined) parts.push(JSON.stringify(res.structuredContent));
    let text = parts.join("\n");
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + `\n… ${text.length - MAX_TEXT} characters cut …`;
    return { text: text || (images.length ? "" : "(the tool returned nothing)"), ...(images.length ? { images } : {}), isError: res.isError === true };
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

// ------------------------------------------------------------- streamable HTTP

export interface HttpWireOptions {
    url: string;
    headers: Record<string, string>;
    fetch?: typeof fetch;
    /** the Authorization header for a signed-in server; `fresh` after a 401 asks for new tokens */
    authorize?: (fresh: boolean) => Promise<string>;
}

/** The server answered 401: it wants the user signed in (again). */
export class Unauthorized extends Error {
    constructor(
        message: string,
        /** the server's `WWW-Authenticate` header */
        readonly challenge: string | null,
    ) {
        super(message);
    }
}

/** POST a message, get one JSON answer or an event stream carrying it. No server push stream is opened. */
export class HttpWire implements McpWire {
    private session: string | null = null;
    private version: string = PROTOCOL_VERSION;
    private next = 1;
    private inflight = new Set<AbortController>();
    private closed = false;
    private authorization: string | null = null;

    constructor(private o: HttpWireOptions) {}

    /** POST, and once more with new tokens if a signed-in server says they're no good */
    private async send(message: Record<string, unknown>, timeoutMs: number): Promise<Response & { release(): void }> {
        if (this.o.authorize && this.authorization === null) this.authorization = await this.o.authorize(false);
        let res = (await this.post(message, timeoutMs)) as Response & { release(): void };
        if (res.status !== 401) return res;
        res.release();
        await discard(res.body);
        if (this.o.authorize) {
            this.authorization = await this.o.authorize(true);
            res = (await this.post(message, timeoutMs)) as Response & { release(): void };
            if (res.status !== 401) return res;
            res.release();
            await discard(res.body);
            throw new Unauthorized("the server refused the sign-in; sign in again", res.headers.get("www-authenticate"));
        }
        throw new Unauthorized("the server asks you to sign in", res.headers.get("www-authenticate"));
    }

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
                    ...(this.authorization ? { Authorization: this.authorization } : {}),
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
        const res = await this.send({ jsonrpc: "2.0", id, method, params }, timeoutMs);
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
        const res = await this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }, 10_000);
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
            headers: { ...this.o.headers, ...(this.authorization ? { Authorization: this.authorization } : {}), "Mcp-Session-Id": this.session },
            signal: AbortSignal.timeout(3000),
        }).catch((e: Error) => {
            console.error(`[agents] couldn't end the session with ${new URL(this.o.url).host}: ${e.message}`);
            return null;
        });
        await discard(res?.body);
    }
}

// ------------------------------------------------------------- HTTP+SSE (the older transport)

/**
 * The transport from before streamable HTTP: a GET opens an event stream,
 * whose first `endpoint` event names where to POST messages; every answer
 * comes back on the stream. The address it names must be on the same server,
 * so the headers (and their secrets) never go anywhere else.
 */
export class SseWire implements McpWire {
    private next = 1;
    private endpoint: string | null = null;
    private waiting = new Map<number, { ok(v: unknown): void; fail(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
    private stream = new AbortController();
    private ended: ((reason: string) => void) | null = null;
    private done = false;
    private authorization: string | null = null;

    private constructor(private o: HttpWireOptions) {}

    static async open(o: HttpWireOptions, timeoutMs = TIMEOUTS.initialize): Promise<SseWire> {
        const w = new SseWire(o);
        await w.connect(timeoutMs);
        return w;
    }

    private headers(): Record<string, string> {
        return { ...this.o.headers, ...(this.authorization ? { Authorization: this.authorization } : {}) };
    }

    private async get(): Promise<Response> {
        return (this.o.fetch ?? fetch)(this.o.url, { method: "GET", redirect: "error", signal: this.stream.signal, headers: { ...this.headers(), Accept: "text/event-stream" } });
    }

    private async connect(timeoutMs: number) {
        if (this.o.authorize) this.authorization = await this.o.authorize(false);
        let res = await this.get();
        if (res.status === 401 && this.o.authorize) {
            await discard(res.body);
            this.authorization = await this.o.authorize(true);
            res = await this.get();
        }
        if (res.status === 401) {
            await discard(res.body);
            throw new Unauthorized(this.o.authorize ? "the server refused the sign-in; sign in again" : "the server asks you to sign in", res.headers.get("www-authenticate"));
        }
        if (!res.ok || !res.body) {
            const detail = (await errorDetail(res)).slice(0, 300);
            throw new Error(`the server answered ${res.status}${detail ? `: ${detail}` : ""}`);
        }
        const endpoint = new Promise<string>((ok, fail) => {
            const timer = setTimeout(() => fail(new Error(`the server didn't say where to send messages within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
            void this.read(res.body!, (url) => {
                clearTimeout(timer);
                ok(url);
            }).then(
                () => this.end("the server closed the stream"),
                (e: Error) => {
                    clearTimeout(timer);
                    fail(e);
                    this.end(this.stream.signal.aborted ? "closed" : `the stream broke: ${e.message}`);
                },
            );
        });
        const raw = await endpoint;
        let url: URL;
        try {
            url = new URL(raw, this.o.url);
        } catch {
            throw new Error("the server named an address to send messages to that isn't one");
        }
        if (url.origin !== new URL(this.o.url).origin) throw new Error(`the server wants messages sent to another server (${url.host}); refused`);
        this.endpoint = url.href;
    }

    private async read(body: ReadableStream<Uint8Array>, onEndpoint: (url: string) => void) {
        const reader = body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) return;
                buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
                if (buf.length > MAX_MESSAGE * 2) throw new Error("an event is past the size limit");
                for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
                    const block = buf.slice(0, i);
                    buf = buf.slice(i + 2);
                    let event = "message";
                    const data: string[] = [];
                    for (const line of block.split("\n")) {
                        if (line.startsWith("event:")) event = line.slice(6).trim();
                        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
                    }
                    if (!data.length) continue;
                    if (event === "endpoint") onEndpoint(data.join("\n").trim());
                    else if (event === "message") this.deliver(data.join("\n"));
                }
            }
        } finally {
            // a stream we closed ourselves needs no letting go
            if (!this.stream.signal.aborted) await discard(reader);
        }
    }

    private deliver(raw: string) {
        let m: any;
        try {
            m = JSON.parse(raw);
        } catch (e) {
            console.warn("[agents] a tool server sent an event that isn't JSON:", e instanceof Error ? e.message : String(e));
            return;
        }
        for (const one of Array.isArray(m) ? m : [m]) {
            if (typeof one?.id !== "number" || one.method !== undefined) continue;
            const w = this.waiting.get(one.id);
            if (!w) continue;
            this.waiting.delete(one.id);
            clearTimeout(w.timer);
            if (one.error) w.fail(new McpRpcError(String(one.error.message ?? "error"), Number(one.error.code ?? -32603)));
            else w.ok(one.result);
        }
    }

    private async post(message: Record<string, unknown>) {
        if (this.done || !this.endpoint) throw new Error("the connection was closed");
        const body = JSON.stringify(message);
        if (body.length > MAX_MESSAGE) throw new Error("that message is too large to send");
        const res = await (this.o.fetch ?? fetch)(this.endpoint, {
            method: "POST",
            redirect: "error",
            headers: { ...this.headers(), "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(30_000),
        });
        try {
            if (res.status === 401) throw new Unauthorized("the server refused the sign-in; sign in again", res.headers.get("www-authenticate"));
            if (!res.ok) {
                const detail = (await errorDetail(res)).slice(0, 300);
                throw new Error(`the server answered ${res.status}${detail ? `: ${detail}` : ""}`);
            }
        } finally {
            await discard(res.body);
        }
    }

    request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
        if (this.waiting.size >= MAX_PENDING) return Promise.reject(new Error("too many requests are waiting on this server"));
        const id = this.next++;
        const answer = new Promise<unknown>((ok, fail) => {
            const timer = setTimeout(() => {
                this.waiting.delete(id);
                fail(new Error(`the server didn't answer within ${Math.round(timeoutMs / 1000)} s`));
            }, timeoutMs);
            this.waiting.set(id, { ok, fail, timer });
        });
        return this.post({ jsonrpc: "2.0", id, method, params }).then(
            () => answer,
            (e: Error) => {
                const w = this.waiting.get(id);
                if (w) clearTimeout(w.timer);
                this.waiting.delete(id);
                throw e;
            },
        );
    }

    notify(method: string, params?: unknown): Promise<void> {
        return this.post({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
    }

    onEnd(cb: (reason: string) => void): void {
        this.ended = cb;
    }

    private end(reason: string) {
        if (this.done) return;
        this.done = true;
        for (const w of this.waiting.values()) {
            clearTimeout(w.timer);
            w.fail(new Error(reason));
        }
        this.waiting.clear();
        this.ended?.(reason);
    }

    async close(): Promise<void> {
        this.stream.abort(new Error("closed"));
        this.end("closed");
    }
}

/** Let go of a stream we're done with; a stream that won't cancel is logged, it can't change the outcome. */
async function discard(s: { cancel(): Promise<void>; locked?: boolean } | null | undefined): Promise<void> {
    // a stream someone read is already finished with (or cancelled by its reader)
    if (s?.locked) return;
    try {
        await s?.cancel();
    } catch (e) {
        console.error("[agents] couldn't release a response stream:", String(e));
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
