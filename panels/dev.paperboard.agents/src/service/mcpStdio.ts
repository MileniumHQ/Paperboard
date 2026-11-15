// An MCP server run on this computer as a daemon-owned child: one JSON-RPC
// message per line on its stdin and stdout.

import { errorText } from "../lib/failure";
import { stopChild } from "./stopChild";
import { lineReader } from "./lines";
import { MAX_MESSAGE, MAX_PENDING, McpRpcError, writeLine, type McpWire } from "./mcpClient";

const STDERR_KEEP = 2000;

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
    private stdout = lineReader(MAX_MESSAGE, (line) => this.onLine(line), () => this.fail("the server sent a message past the size limit"));
    private stderr = "";
    private offs: (() => void)[] = [];
    private ended: string | null = null;
    private endCbs: ((reason: string) => void)[] = [];
    private closing = false;
    /** why this end stopped the server itself, which is what it ended with */
    private failure: string | null = null;

    private constructor(
        private host: ProcessHost,
        readonly id: string,
    ) {}

    /** Start the child. Its output is subscribed before it runs, so nothing is missed. */
    static async start(host: ProcessHost, o: { id: string; command: string; args: string[]; env?: Record<string, string> }): Promise<StdioWire> {
        // a child the last service generation left behind is not ours to talk to
        await stopChild(host, o.id).catch((e) => {
            throw new Error(`an earlier copy of this server is still running and won't stop: ${errorText(e)}`);
        });
        const wire = new StdioWire(host, o.id);
        wire.offs.push(
            host.onStdout(o.id, (d) => wire.stdout.push(d)),
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

    private onLine(raw: string) {
        const line = raw.trim();
        if (!line) return;
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
        this.finish(this.failure ?? (this.closing ? "stopped" : `the server exited${code !== undefined ? ` (${code})` : ""}${tail ? `: ${tail}` : ""}`));
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
        if (!this.closing || this.failure !== null) for (const cb of this.endCbs) cb(reason);
    }

    private unsubscribe() {
        for (const off of this.offs.splice(0)) off();
    }

    /** End it from this side: what was waiting, and whoever follows its end, get `reason`. */
    private fail(reason: string) {
        this.failure = reason;
        this.close().catch((e) => this.finish(`${reason}, and it couldn't be stopped: ${errorText(e)}`));
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
        // the server can end while the request is still being written, before `done` is awaited: not an unhandled rejection
        void Promise.allSettled([done]); // marks it handled here; the failure itself is thrown where it is awaited
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

    /** `cb` is told why it ended; at once, if it already has */
    onEnd(cb: (reason: string) => void) {
        if (this.ended !== null) cb(this.ended);
        else this.endCbs.push(cb);
    }

    /** Ask it to stop, then make it, and return once the daemon says it's gone. */
    async close(): Promise<void> {
        this.closing = true;
        await stopChild(this.host, this.id);
        this.finish(this.failure ?? "stopped");
    }
}
