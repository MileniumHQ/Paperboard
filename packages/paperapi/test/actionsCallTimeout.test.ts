// actionsApi.call timeout opt-in (bun test); mocks globalThis.WebSocket.
//
// A caller may pass `{ timeoutMs }` to bound an action call, or `null` to
// wait for a long-running action to finish. Both must reach the wire (the
// daemon reads params.timeoutMs) AND the transport's own request timer.
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

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error("waitFor timeout");
        await new Promise((r) => setTimeout(r, 5));
    }
}

import { initPaperApi, getTransport } from "../src/ipc";
import { actionsApi } from "../src/actions";

describe("actionsApi.call timeout", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        getTransport("local").close();
        (globalThis as any).WebSocket = undefined;
    });

    async function connected(port: number): Promise<void> {
        const connecting = initPaperApi({ port, token: "tok" });
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await connecting;
    }

    test("a numeric timeoutMs reaches the wire and the request timer", async () => {
        await connected(1234);
        const call = actionsApi.call("panel.target", "slow", { x: 1 }, { timeoutMs: 25 });
        await waitFor(() => LAST().frames().some((f) => f.action === "actions:call"));
        const frame = LAST().frames().find((f) => f.action === "actions:call")!;
        expect(frame.params.timeoutMs).toBe(25);
        expect(frame.params.args[0]).toEqual({ x: 1 });
        // 25 ms is a real deadline: the call rejects rather than hanging
        await expect(call).rejects.toThrow(/timed out/);
    });

    test("timeoutMs null reaches the wire and waits for the reply", async () => {
        await connected(1235);
        const call = actionsApi.call("panel.target", "slow", { x: 2 }, { timeoutMs: null });
        await waitFor(() => LAST().frames().some((f) => f.action === "actions:call"));
        const frame = LAST().frames().find((f) => f.action === "actions:call")!;
        expect(frame.params.timeoutMs).toBeNull();
        // no other handler options, so args[1] serializes to null
        expect(frame.params.args[1]).toBeNull();
        // nothing settles it on its own; the daemon's reply does
        await new Promise((r) => setTimeout(r, 30));
        LAST().receive({ type: "response", id: frame.id, result: { result: { ok: true } } });
        const out = await call;
        expect(out).toEqual({ ok: true });
    });

    test("options other than timeoutMs are forwarded to the handler", async () => {
        await connected(1236);
        const call = actionsApi.call("panel.target", "slow", undefined, { timeoutMs: null, flag: true });
        await waitFor(() => LAST().frames().some((f) => f.action === "actions:call"));
        const frame = LAST().frames().find((f) => f.action === "actions:call")!;
        expect(frame.params.timeoutMs).toBeNull();
        expect(frame.params.args[1]).toEqual({ flag: true });
        LAST().receive({ type: "response", id: frame.id, result: { result: 1 } });
        await call;
    });
});
