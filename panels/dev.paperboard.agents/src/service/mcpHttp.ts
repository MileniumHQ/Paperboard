// An MCP server on the web: streamable HTTP (a POST per message, answered
// with JSON or an event stream), and the older SSE transport (a stream the
// server answers on, and a POST address it names).

import { errorText } from "../lib/failure";
import { MAX_MESSAGE, MAX_PENDING, McpRpcError, PROTOCOL_VERSION, TIMEOUTS, type McpWire } from "./mcpClient";

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
        try {
            await w.connect(timeoutMs);
        } catch (e) {
            // a stream that opened but never said where to send messages isn't left open: nobody will close it
            w.stream.abort(e);
            throw e;
        }
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
            console.warn("[agents] a tool server sent an event that isn't JSON:", errorText(e));
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
        // the stream can end while the request is still being posted, before `answer` is awaited: not an unhandled rejection
        void Promise.allSettled([answer]); // marks it handled here; the failure itself is thrown where it is awaited
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
        return `(${errorText(e)})`;
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
