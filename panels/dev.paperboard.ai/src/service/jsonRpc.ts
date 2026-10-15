// JSON-RPC 2.0 over newline-delimited JSON (ACP's stdio transport). The
// peer is transport-agnostic: the caller feeds it the child's stdout as it
// arrives and gives it a writer for stdin. Every limit is explicit: a line
// over MAX_LINE_CHARS, or a request past MAX_PENDING, fails loudly instead
// of growing without bound.

/** a single message an agent may send; a whole file read fits comfortably */
export const MAX_LINE_CHARS = 16 * 1024 * 1024;
export const MAX_PENDING = 256;
/** process:write takes at most 65536 characters per call */
export const WRITE_CHUNK_CHARS = 60_000;

export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export class JsonRpcError extends Error {
    constructor(
        readonly code: number,
        message: string,
        readonly data?: unknown,
    ) {
        super(message);
        this.name = "JsonRpcError";
    }
}

export interface JsonRpcHandlers {
    /** a request from the other side; its result (or thrown error) is the reply */
    onRequest(method: string, params: unknown): Promise<unknown>;
    onNotification(method: string, params: unknown): void;
    /** the stream broke (oversized or unparseable line); the peer is closed */
    onProtocolError(err: Error): void;
}

/**
 * Splits a stream into lines, scanning only the bytes that arrived: a long
 * line built from many chunks costs its length once, not once per chunk.
 */
export class LineBuffer {
    private parts: string[] = [];
    private size = 0;

    constructor(private readonly maxLine = MAX_LINE_CHARS) {}

    push(chunk: string): string[] {
        const lines: string[] = [];
        let start = 0;
        for (let nl = chunk.indexOf("\n"); nl !== -1; nl = chunk.indexOf("\n", start)) {
            const piece = chunk.slice(start, nl);
            if (this.size + piece.length > this.maxLine) throw new Error(`a message exceeded ${this.maxLine} characters`);
            this.parts.push(piece);
            lines.push(this.parts.join("").replace(/\r$/, ""));
            this.parts = [];
            this.size = 0;
            start = nl + 1;
        }
        const rest = chunk.slice(start);
        if (rest) {
            if (this.size + rest.length > this.maxLine) throw new Error(`a message exceeded ${this.maxLine} characters`);
            this.parts.push(rest);
            this.size += rest.length;
        }
        return lines;
    }
}

interface Pending {
    method: string;
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
}

export class JsonRpcPeer {
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private lines = new LineBuffer();
    private writing: Promise<void> = Promise.resolve();
    private closedWith: Error | null = null;

    constructor(
        private readonly write: (chunk: string) => Promise<void>,
        private readonly handlers: JsonRpcHandlers,
    ) {}

    get closed(): boolean {
        return this.closedWith !== null;
    }

    /** Feeds the other side's output. */
    receive(chunk: string): void {
        if (this.closedWith) return;
        let lines: string[] = [];
        try {
            lines = this.lines.push(chunk);
        } catch (err) {
            // an oversized line closes the peer; nothing after it is read
            this.fail(err instanceof Error ? err : new Error(String(err)));
        }
        for (const line of lines) {
            if (!line.trim()) continue;
            let message: unknown;
            try {
                message = JSON.parse(line);
            } catch (err) {
                this.fail(new Error(`the agent sent something that is not JSON: ${line.slice(0, 200)}`, { cause: err }));
                return;
            }
            this.dispatch(message);
            if (this.closedWith) return;
        }
    }

    request<T = unknown>(method: string, params: unknown): Promise<T> {
        if (this.closedWith) return Promise.reject(this.closedWith);
        if (this.pending.size >= MAX_PENDING) return Promise.reject(new Error(`More than ${MAX_PENDING} requests are waiting on the agent.`));
        const id = this.nextId++;
        const reply = new Promise<T>((resolve, reject) => {
            this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject });
        });
        this.send({ jsonrpc: "2.0", id, method, params }).catch((err) => this.settle(id, undefined, err));
        return reply;
    }

    notify(method: string, params: unknown): Promise<void> {
        if (this.closedWith) return Promise.reject(this.closedWith);
        return this.send({ jsonrpc: "2.0", method, params });
    }

    /** Rejects everything waiting; later calls fail with `reason`. */
    close(reason: Error): void {
        if (this.closedWith) return;
        this.closedWith = reason;
        for (const [, p] of this.pending) p.reject(reason);
        this.pending.clear();
    }

    private fail(err: Error): void {
        this.close(err);
        this.handlers.onProtocolError(err);
    }

    /** Messages go out whole and in order, however many writes each takes. */
    private send(message: unknown): Promise<void> {
        const text = `${JSON.stringify(message)}\n`;
        const next = this.writing.then(async () => {
            for (let i = 0; i < text.length; i += WRITE_CHUNK_CHARS) {
                await this.write(text.slice(i, i + WRITE_CHUNK_CHARS));
            }
        });
        // one failed write must not wedge every later message
        this.writing = next.catch(() => undefined);
        return next;
    }

    private settle(id: number, result: unknown, error?: unknown): void {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (error === undefined) p.resolve(result);
        else p.reject(error instanceof Error ? error : new Error(String(error)));
    }

    private dispatch(message: unknown): void {
        if (typeof message !== "object" || message === null) return;
        const m = message as { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: unknown };
        if (typeof m.method === "string") {
            if (m.id === undefined || m.id === null) {
                this.handlers.onNotification(m.method, m.params);
                return;
            }
            const id = m.id;
            this.handlers
                .onRequest(m.method, m.params)
                .then(
                    (result) => this.send({ jsonrpc: "2.0", id, result: result ?? null }),
                    (err) => {
                        const code = err instanceof JsonRpcError ? err.code : INTERNAL_ERROR;
                        return this.send({ jsonrpc: "2.0", id, error: { code, message: err instanceof Error ? err.message : String(err) } });
                    },
                )
                .catch((err) => console.warn(`[ai] could not answer the agent's ${m.method}:`, String(err)));
            return;
        }
        if (typeof m.id !== "number") return;
        if (m.error !== undefined) {
            const e = (typeof m.error === "object" && m.error !== null ? m.error : {}) as { code?: unknown; message?: unknown; data?: unknown };
            const pending = this.pending.get(m.id);
            const text = typeof e.message === "string" && e.message ? e.message : `${pending?.method ?? "request"} failed`;
            this.settle(m.id, undefined, new JsonRpcError(typeof e.code === "number" ? e.code : INTERNAL_ERROR, text, e.data));
            return;
        }
        this.settle(m.id, m.result);
    }
}
