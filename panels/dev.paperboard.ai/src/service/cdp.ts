// A DevTools Protocol connection to the agent's browser: one WebSocket to
// the browser itself, with each tab reached through its own flattened
// session. Every command has a deadline and the waiting ones are bounded;
// when the socket closes, everything still waiting fails with it.

type Json = Record<string, any>;

const MAX_WAITING = 256;

export class CdpError extends Error {}

export class Cdp {
    private next = 0;
    private waiting = new Map<number, { ok: (v: Json) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    private listeners = new Map<string, Set<(params: Json, sessionId?: string) => void>>();
    private closers = new Set<(why: string) => void>();
    private closed: string | null = null;

    private constructor(private ws: WebSocket) {
        ws.onmessage = (e) => this.receive(String(e.data));
        ws.onclose = () => this.end("the browser's connection closed");
        ws.onerror = () => this.end("the browser's connection failed");
    }

    static async connect(url: string, timeoutMs = 10_000): Promise<Cdp> {
        const ws = new WebSocket(url);
        await new Promise<void>((ok, fail) => {
            const t = setTimeout(() => {
                ws.close();
                fail(new CdpError("the browser didn't take the connection"));
            }, timeoutMs);
            ws.onopen = () => {
                clearTimeout(t);
                ok();
            };
            ws.onerror = () => {
                clearTimeout(t);
                fail(new CdpError("couldn't connect to the browser"));
            };
        });
        return new Cdp(ws);
    }

    get open() {
        return this.closed === null;
    }

    send<T = Json>(method: string, params: Json = {}, sessionId?: string, timeoutMs = 15_000): Promise<T> {
        if (this.closed) return Promise.reject(new CdpError(this.closed));
        if (this.waiting.size >= MAX_WAITING) return Promise.reject(new CdpError("the browser is busy; try again"));
        const id = ++this.next;
        return new Promise<T>((ok, fail) => {
            const timer = setTimeout(() => {
                this.waiting.delete(id);
                fail(new CdpError(`the browser didn't answer ${method} in time`));
            }, timeoutMs);
            this.waiting.set(id, { ok: ok as (v: Json) => void, fail, timer });
            this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
        });
    }

    /** An event, from any session; the listener is told which. Returns the way to stop listening. */
    on(method: string, cb: (params: Json, sessionId?: string) => void): () => void {
        const set = this.listeners.get(method) ?? new Set();
        this.listeners.set(method, set);
        set.add(cb);
        return () => {
            set.delete(cb);
            if (!set.size) this.listeners.delete(method);
        };
    }

    onClose(cb: (why: string) => void): () => void {
        this.closers.add(cb);
        return () => this.closers.delete(cb);
    }

    close() {
        this.end("closed");
        this.ws.close();
    }

    private receive(raw: string) {
        let m: Json;
        try {
            m = JSON.parse(raw);
        } catch (e) {
            console.warn("[ai] the browser's DevTools connection sent something unreadable:", e instanceof Error ? e.message : String(e));
            this.end("the browser sent something unreadable");
            this.ws.close();
            return;
        }
        if (typeof m.id === "number") {
            const w = this.waiting.get(m.id);
            if (!w) return; // answered after its deadline
            this.waiting.delete(m.id);
            clearTimeout(w.timer);
            if (m.error) w.fail(new CdpError(String(m.error.message ?? "the browser refused").slice(0, 200)));
            else w.ok(m.result ?? {});
            return;
        }
        if (typeof m.method === "string") for (const cb of [...(this.listeners.get(m.method) ?? [])]) cb(m.params ?? {}, m.sessionId);
    }

    private end(why: string) {
        if (this.closed) return;
        this.closed = why;
        for (const w of this.waiting.values()) {
            clearTimeout(w.timer);
            w.fail(new CdpError(why));
        }
        this.waiting.clear();
        this.listeners.clear();
        for (const cb of [...this.closers]) cb(why);
        this.closers.clear();
    }
}
