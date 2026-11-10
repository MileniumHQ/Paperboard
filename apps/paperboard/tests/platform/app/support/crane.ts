// A compiled crane run as its own process against a throwaway data dir, and
// a small WebSocket RPC client speaking the daemon's wire format.
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { ownChild } from "./temp";

export const WAIT_MS = 60_000;

// resolves when `check` holds, polled on each line of output the process
// writes and on its exit; rejects with everything it printed otherwise
export interface Watched {
    child: ChildProcess;
    output(): string;
    waitFor(what: string, check: (output: string) => boolean, ms?: number): Promise<void>;
    exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export function watch(child: ChildProcess, label: string): Watched {
    let text = "";
    const waiters = new Set<() => void>();
    const poke = () => { for (const w of [...waiters]) w(); };
    child.stdout?.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); poke(); });
    child.stderr?.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); poke(); });
    let done = false;
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("exit", (code, signal) => { done = true; resolve({ code, signal }); poke(); });
    });
    return {
        child,
        output: () => text,
        exited,
        waitFor(what, check, ms = WAIT_MS) {
            return new Promise<void>((resolve, reject) => {
                const finish = (err?: Error) => {
                    clearTimeout(timer);
                    waiters.delete(test);
                    if (err) reject(err);
                    else resolve();
                };
                const test = () => {
                    if (check(text)) finish();
                    else if (done) finish(new Error(`${label} exited before ${what}:\n${text}`));
                };
                const timer = setTimeout(() => finish(new Error(`${label}: no ${what} within ${ms} ms:\n${text}`)), ms);
                waiters.add(test);
                test();
            });
        },
    };
}

export interface Handshake {
    port: number;
    token: string;
    startId: string;
    pid: number;
}

export function readHandshake(dataDir: string): Handshake {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "local", "crane.json"), "utf8"));
}

export interface RunningCrane extends Watched {
    dataDir: string;
    handshake: Handshake;
    stop(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

// `papercrane --headless` on a free loopback port. Resolves once it says it
// listens and its crane.json handshake is on disk.
export async function startCrane(binary: string, dataDir: string, extraEnv: Record<string, string> = {}): Promise<RunningCrane> {
    const env: NodeJS.ProcessEnv = { ...process.env, PAPERBOARD_DIR: dataDir, ...extraEnv };
    delete env.PAPERCRANE_PORT;
    delete env.PAPERCRANE_HOST;
    delete env.PAPERCRANE_TOKEN;
    const child = spawn(binary, ["--headless", "--port", "0", "--host", "127.0.0.1"], {
        cwd: dataDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    ownChild(child);
    const watched = watch(child, `crane ${path.basename(binary)}`);
    await watched.waitFor("listening line", (out) => /Listening on http:\/\/127\.0\.0\.1:\d+/.test(out));
    const handshake = readHandshake(dataDir);
    return {
        ...watched,
        dataDir,
        handshake,
        // the platform's stop: SIGTERM where there are signals, and on
        // Windows TerminateProcess (what a service manager or Task Manager does)
        async stop() {
            if (child.exitCode !== null || child.signalCode !== null) return watched.exited;
            child.kill(process.platform === "win32" ? undefined : "SIGTERM");
            return watched.exited;
        },
    };
}

export interface RpcReply {
    type: "response";
    id: unknown;
    result: any;
    error?: string;
    code?: string;
}

export class RpcError extends Error {
    constructor(message: string, readonly code: string | undefined) { super(message); }
}

// One socket to a daemon. `call` throws an RpcError carrying the daemon's
// error and code; `send` returns the raw reply frame.
export class CraneSocket {
    private next = 1;
    private pending = new Map<unknown, (reply: RpcReply) => void>();
    readonly frames: any[] = [];
    private frameWaiters = new Set<() => void>();
    closed: Promise<{ code: number; reason: string }>;

    private constructor(readonly ws: WebSocket) {
        ws.on("message", (raw) => {
            const msg = JSON.parse(raw.toString());
            this.frames.push(msg);
            for (const w of [...this.frameWaiters]) w();
            if (msg.type === "response" && this.pending.has(msg.id)) {
                const settle = this.pending.get(msg.id)!;
                this.pending.delete(msg.id);
                settle(msg);
            }
        });
        this.closed = new Promise((resolve) => ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
    }

    static open(port: number, headers: Record<string, string> = {}): Promise<CraneSocket> {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
        const socket = new CraneSocket(ws);
        return new Promise((resolve, reject) => {
            ws.once("open", () => resolve(socket));
            ws.once("error", reject);
        });
    }

    // opens and authenticates with auth:verify
    static async authed(port: number, token: string): Promise<CraneSocket> {
        const socket = await CraneSocket.open(port);
        await socket.call("auth:verify", { token });
        return socket;
    }

    send(action: string, params: Record<string, unknown> = {}, ms = WAIT_MS): Promise<RpcReply> {
        const id = this.next++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${action}: no reply within ${ms} ms`));
            }, ms);
            this.pending.set(id, (reply) => { clearTimeout(timer); resolve(reply); });
            this.ws.send(JSON.stringify({ id, action, params }));
        });
    }

    async call(action: string, params: Record<string, unknown> = {}, ms = WAIT_MS): Promise<any> {
        const reply = await this.send(action, params, ms);
        if (reply.error) throw new RpcError(`${action}: ${reply.error}`, reply.code);
        return reply.result;
    }

    // resolves with the first received frame matching `match`
    waitFrame(what: string, match: (frame: any) => boolean, ms = WAIT_MS): Promise<any> {
        return new Promise((resolve, reject) => {
            const test = () => {
                const found = this.frames.find(match);
                if (!found) return;
                clearTimeout(timer);
                this.frameWaiters.delete(test);
                resolve(found);
            };
            const timer = setTimeout(() => {
                this.frameWaiters.delete(test);
                reject(new Error(`no ${what} within ${ms} ms; frames: ${JSON.stringify(this.frames).slice(0, 4000)}`));
            }, ms);
            this.frameWaiters.add(test);
            test();
        });
    }

    close(): void {
        this.ws.close();
    }
}

export function randomChallenge(): string {
    return crypto.randomBytes(32).toString("hex");
}
