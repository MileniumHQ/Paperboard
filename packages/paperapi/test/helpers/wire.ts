// A loopback WebSocket server speaking the daemon's wire format, recording
// every frame each client sends. Transport tests need to see exactly what the
// SDK puts on the wire (a plain frame where a tunnel envelope belongs, a
// replayed registration), which the real daemon does not expose.
//
// Requests ({ id, action, params }) are answered by `answer`; remote:open
// opens a tunnel unless `refuseTunnels` is set; frames inside a tunnel are
// unwrapped, recorded with their tunnel id and answered inside it.
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";

export interface Frame {
    // which connection sent it, counting from 0
    conn: number;
    // the tunnel it rode, or null for a plain frame
    tunnel: string | null;
    msg: any;
}

export type Answer = (action: string, params: any, frame: Frame) => unknown;

export interface WireServer {
    port: number;
    token: string;
    frames: Frame[];
    // set to change how requests are answered; throw to answer with an error
    answer: Answer;
    refuseTunnels: boolean;
    // resolves with the first frame (past or future) that matches
    next(what: string, match: (frame: Frame) => boolean, timeoutMs?: number): Promise<Frame>;
    // frames that are requests for this action
    requests(action: string): Frame[];
    // pushes an event to every open connection, inside its tunnel if it has one
    emit(event: string, payload: unknown): void;
    // sends a raw frame on the newest connection
    sendRaw(obj: unknown): void;
    // tells the newest connection its tunnel closed
    closeTunnel(): void;
    // drops every connection, as a daemon restart does
    dropConnections(): Promise<void>;
    connections(): number;
    // resolves once connection `conn` has closed
    connectionClosed(conn: number): Promise<void>;
    close(): Promise<void>;
}

export async function startWireServer(token = "test-token"): Promise<WireServer> {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
        wss.once("listening", () => resolve());
        wss.once("error", reject);
    });
    const frames: Frame[] = [];
    const sockets: { ws: WebSocket; tunnel: string | null }[] = [];
    const closedConns = new Map<number, { promise: Promise<void>; resolve: () => void }>();
    const closeOf = (conn: number) => {
        let entry = closedConns.get(conn);
        if (!entry) {
            let resolve!: () => void;
            const promise = new Promise<void>((r) => {
                resolve = r;
            });
            entry = { promise, resolve };
            closedConns.set(conn, entry);
        }
        return entry;
    };
    const waiters: { match: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];

    const record = (frame: Frame) => {
        frames.push(frame);
        for (const w of [...waiters]) {
            if (w.match(frame)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve(frame);
            }
        }
    };

    const server: WireServer = {
        port: (wss.address() as AddressInfo).port,
        token,
        frames,
        answer: () => ({}),
        refuseTunnels: false,
        next: (what, match, timeoutMs = 10_000) => {
            const seen = frames.find(match);
            if (seen) return Promise.resolve(seen);
            return new Promise<Frame>((resolve, reject) => {
                const timer = setTimeout(() => {
                    waiters.splice(waiters.indexOf(waiter), 1);
                    reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}; frames: ${JSON.stringify(frames.map((f) => f.msg))}`));
                }, timeoutMs);
                const waiter = {
                    match,
                    resolve: (f: Frame) => {
                        clearTimeout(timer);
                        resolve(f);
                    },
                };
                waiters.push(waiter);
            });
        },
        requests: (action) => frames.filter((f) => f.msg?.action === action),
        emit: (event, payload) => {
            for (const s of sockets) {
                const frame = JSON.stringify({ type: "event", event, payload });
                s.ws.send(s.tunnel ? JSON.stringify({ type: "tunnel", id: s.tunnel, payload: frame }) : frame);
            }
        },
        sendRaw: (obj) => {
            sockets[sockets.length - 1].ws.send(JSON.stringify(obj));
        },
        closeTunnel: () => {
            const s = sockets[sockets.length - 1];
            const id = s.tunnel;
            s.tunnel = null;
            s.ws.send(JSON.stringify({ type: "tunnel-closed", id }));
        },
        dropConnections: async () => {
            const closing = sockets.splice(0).map(
                (s) =>
                    new Promise<void>((resolve) => {
                        s.ws.once("close", () => resolve());
                        s.ws.terminate();
                    }),
            );
            await Promise.all(closing);
        },
        connections: () => sockets.length,
        connectionClosed: (conn) => closeOf(conn).promise,
        close: async () => {
            for (const s of sockets.splice(0)) s.ws.terminate();
            await new Promise<void>((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve())));
        },
    };

    let count = 0;
    wss.on("connection", (ws) => {
        const conn = count++;
        const entry = { ws, tunnel: null as string | null };
        sockets.push(entry);
        ws.on("close", () => {
            closeOf(conn).resolve();
            const i = sockets.indexOf(entry);
            if (i !== -1) sockets.splice(i, 1);
        });
        const respond = (id: unknown, action: string, params: any, frame: Frame, wrap: string | null) => {
            const send = (obj: Record<string, unknown>) => {
                if (ws.readyState !== ws.OPEN) return;
                const text = JSON.stringify(obj);
                ws.send(wrap ? JSON.stringify({ type: "tunnel", id: wrap, payload: text }) : text);
            };
            let result: unknown;
            try {
                if (action === "auth:verify") {
                    if (params?.token !== token) throw new Error("bad token");
                    result = { ok: true };
                } else {
                    result = server.answer(action, params, frame);
                }
            } catch (err) {
                send({ type: "response", id, error: (err as Error).message });
                return;
            }
            Promise.resolve(result).then(
                (value) => send({ type: "response", id, result: value }),
                (err: Error) => send({ type: "response", id, error: err.message }),
            );
        };
        ws.on("message", (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "remote:open") {
                record({ conn, tunnel: null, msg });
                if (server.refuseTunnels) {
                    ws.send(JSON.stringify({ type: "tunnel-closed", id: msg.id, reason: "refused by test" }));
                } else {
                    entry.tunnel = msg.id;
                    ws.send(JSON.stringify({ type: "tunnel-open", id: msg.id }));
                }
                return;
            }
            if (msg.type === "tunnel") {
                const inner = JSON.parse(msg.payload);
                const frame = { conn, tunnel: msg.id as string, msg: inner };
                record(frame);
                if (inner.action) respond(inner.id, inner.action, inner.params, frame, msg.id);
                return;
            }
            const frame = { conn, tunnel: null, msg };
            record(frame);
            if (msg.action) respond(msg.id, msg.action, msg.params, frame, null);
        });
    });
    return server;
}
