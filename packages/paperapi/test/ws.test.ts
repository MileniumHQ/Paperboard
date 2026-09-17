// CraneTransport regression tests (bun test); mocks globalThis.WebSocket
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

type Listener = (e?: any) => void;

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    readyState = 0; // CONNECTING
    sent: string[] = [];
    private listeners = new Map<string, Listener[]>();

    constructor(public url: string) {
        MockWebSocket.instances.push(this);
    }

    addEventListener(event: string, cb: Listener) {
        const arr = this.listeners.get(event) ?? [];
        arr.push(cb);
        this.listeners.set(event, arr);
    }

    send(data: string) {
        if (this.readyState !== 1) throw new Error("MockWebSocket not open");
        this.sent.push(data);
        const frame = JSON.parse(data);
        if (frame.action === "auth:verify") queueMicrotask(() => this.receive({ type: "response", id: frame.id, result: { success: true } }));
    }

    close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        queueMicrotask(() => this.emit("close", {}));
    }

    emit(event: string, e: any = {}) {
        for (const cb of this.listeners.get(event) ?? []) cb(e);
    }

    // ── test helpers ──
    open() {
        this.readyState = 1;
        this.emit("open", {});
    }

    receive(obj: unknown) {
        this.emit("message", {
            data: typeof obj === "string" ? obj : JSON.stringify(obj),
        });
    }

    frames(): any[] {
        return this.sent.map((s) => JSON.parse(s));
    }
}

const LAST = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

const countFrames = (pred: (f: any) => boolean, sock = LAST()) =>
    sock.frames().filter(pred).length;

/** Respond to the nth (0-based) remote:open request with a tunnel-open. */
function acceptRemoteOpen(n: number, sock = LAST()) {
    const reqs = sock.frames().filter((f) => f.type === "remote:open");
    if (!reqs[n]) throw new Error(`no remote:open #${n}`);
    sock.receive({ type: "tunnel-open", id: reqs[n].id });
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error("waitFor timeout");
        await new Promise((r) => setTimeout(r, 5));
    }
}

/** Send a response to the most recent tunneled request on the last socket. */
function respondLastTunneled(result: any) {
    const tf = LAST()
        .frames()
        .filter((f) => f.type === "tunnel")
        .at(-1)!;
    LAST().receive({
        type: "tunnel",
        id: tf.id,
        payload: JSON.stringify({
            type: "response",
            id: JSON.parse(tf.payload).id,
            result,
        }),
    });
}

import { CraneTransport } from "../src/ws";

describe("CraneTransport computer scoping", () => {
    let t: CraneTransport;

    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        try {
            t?.close();
        } catch (err) {
            console.debug("[test] transport already closed:", String(err));
        }
    });

    /** Connects the transport and completes its tunnel handshake. */
    async function connected(id: string) {
        t = new CraneTransport({
            port: 1234,
            token: "tok",
            computerId: id,
        });
        const p = t.ensureConnected();
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        if (id !== "local") {
            await waitFor(() =>
                LAST().frames().some((f) => f.type === "remote:open"),
            );
            acceptRemoteOpen(0);
        }
        await p;
        return t;
    }

    test("remote scope wraps frames through the tunnel; local scope unwraps", async () => {
        await connected("remote-1");

        // Remote traffic is wrapped in a tunnel envelope
        let p = t.call("panel:list");
        await waitFor(() =>
            LAST()
                .frames()
                .some((f) => f.type === "tunnel"),
        );
        const wrapped = LAST()
            .frames()
            .filter((f) => f.type === "tunnel")
            .at(-1)!;
        expect(JSON.parse(wrapped.payload).action).toBe("panel:list");
        respondLastTunneled({ panels: ["remote"] });
        expect(await p).toEqual({ panels: ["remote"] });

        // A local-scoped transport on the same socket factory is plain
        MockWebSocket.instances = [];
        const local = await connected("local");
        p = local.call("ping");
        await waitFor(() => LAST().frames().some((f) => f.action === "ping"));
        const plain = LAST().frames().find((f) => f.action === "ping")!;
        expect(plain.type).toBeUndefined();
        LAST().receive({ type: "response", id: plain.id, result: {} });
        await p;
        local.close();
    });

    test("failed tunnel open rejects calls — frames never leak unwrapped — and stays retryable", async () => {
        await connected("remote-1");

        // Kill the tunnel as the daemon would when the upstream leg drops
        const req = LAST()
            .frames()
            .filter((f) => f.type === "remote:open")
            .at(-1)!;
        LAST().receive({ type: "tunnel-closed", id: req.id });

        // Wait for the automatic reopen attempt, then refuse it
        await waitFor(() => countFrames((f) => f.type === "remote:open") > 1);
        const retry = LAST()
            .frames()
            .filter((f) => f.type === "remote:open")
            .at(-1)!;
        LAST().receive({
            type: "tunnel-closed",
            id: retry.id,
            reason: "auth",
        });

        // Tunnel down: call must trigger a tunnel attempt, not a plain frame
        const probe = t.call("panel:list");
        await waitFor(
            () => countFrames((f) => f.type === "remote:open") > 2,
        );
        // Every panel:list frame seen so far (if any) must be tunneled.
        const leaked = LAST()
            .frames()
            .some((f) => f.action === "panel:list" && f.type === undefined);
        expect(leaked).toBe(false);

        // Accept the probe's tunnel attempt; the call then flows wrapped.
        acceptRemoteOpen(LAST().frames().filter((f) => f.type === "remote:open").length - 1);
        await waitFor(() =>
            LAST()
                .frames()
                .some((f) => f.type === "tunnel"),
        );
        const tf = LAST()
            .frames()
            .filter((f) => f.type === "tunnel")
            .at(-1)!;
        expect(JSON.parse(tf.payload).action).toBe("panel:list");
        respondLastTunneled({ panels: ["r2"] });
        expect(await probe).toEqual({ panels: ["r2"] });
    });

    test("reconnect reopens the tunnel and replays tracked terminals", async () => {
        await connected("remote-1");
        t.trackTerminal("term-1");

        // Simulate the daemon socket dropping.
        LAST().close();

        // Backoff is 400ms; complete the replacement socket's connect + tunnel
        await waitFor(() => MockWebSocket.instances.length > 1);
        const second = LAST();
        second.open();
        await waitFor(() =>
            second.frames().some((f) => f.type === "remote:open"),
        );
        const req = second.frames().find((f) => f.type === "remote:open")!;
        second.receive({ type: "tunnel-open", id: req.id });

        // term:attach replay must arrive THROUGH the new tunnel.
        await waitFor(() =>
            second.frames().some(
                (f) =>
                    f.type === "tunnel" &&
                    JSON.parse(f.payload).action === "term:attach",
            ),
        );
        const replay = second
            .frames()
            .filter((f) => f.type === "tunnel")
            .map((f) => JSON.parse(f.payload))
            .find((p) => p.action === "term:attach")!;
        expect(replay.params.id).toBe("term-1");

        // Fresh traffic flows wrapped on the new socket too.
        const c = t.call("panel:list");
        await waitFor(
            () =>
                second
                    .frames()
                    .filter((f) => f.type === "tunnel")
                    .filter(
                        (f) => JSON.parse(f.payload).action === "panel:list",
                    ).length > 0,
        );
        respondLastTunneled({ panels: [] });
        await c;
    });

    test("close() cancels pending reconnects", async () => {
        await connected("local");
        LAST().close();

        // A reconnect is scheduled; closing before it fires must prevent it.
        t.close();
        await new Promise((r) => setTimeout(r, 700)); // base backoff is 400ms
        expect(MockWebSocket.instances.length).toBe(1);
    });
});
