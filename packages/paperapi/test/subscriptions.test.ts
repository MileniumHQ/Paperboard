// events:subscribe auto-sync (bun test): the transport announces the full
// listener set to the daemon as a full-replace frame, grows/shrinks it, and
// re-announces after the server drops the socket.
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
    }

    close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        queueMicrotask(() => this.emit("close", {}));
    }

    /** Simulate the server dropping the socket without the client calling close(). */
    serverDrop() {
        this.readyState = 3;
        queueMicrotask(() => this.emit("close", { wasClean: false }));
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

function subFrames(ws: MockWebSocket): any[] {
    return ws.frames().filter((f) => f.action === "events:subscribe");
}

async function ackAll(ws: MockWebSocket): Promise<void> {
    for (const f of subFrames(ws)) {
        ws.receive({ type: "response", id: f.id, result: { success: true } });
    }
}

import { initPaperApi, getTransport } from "../src/ipc";

let port = 7001;

async function connect(
    register: (t: ReturnType<typeof getTransport>) => void,
): Promise<MockWebSocket> {
    const connecting = initPaperApi({ port: port++, token: "tok" });
    await waitFor(() => MockWebSocket.instances.length > 0);
    const ws = LAST();
    register(getTransport("local"));
    ws.open();
    await connecting;
    return ws;
}

describe("events:subscribe auto-sync", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        getTransport("local").close();
        (globalThis as any).WebSocket = undefined;
    });

    test("the listener set is announced on connect, grown, and shrunk", async () => {
        const ws = await connect((t) => {
            t.subscribeEvent("actions:event", () => {});
            t.subscribeEvent("actions:registry-updated", () => {});
            t.subscribeEvent("triggers:event", () => {});
        });
        const t = getTransport("local");

        await waitFor(() => subFrames(ws).length >= 1);
        expect([...subFrames(ws)[0].params.events].sort()).toEqual([
            "actions:event",
            "actions:registry-updated",
            "triggers:event",
        ]);
        await ackAll(ws);

        // grow: full-replace frame includes the new event too
        t.subscribeEvent("triggers:event2", () => {});
        await waitFor(() =>
            subFrames(ws).some((f) => f.params.events.includes("triggers:event2")),
        );
        expect([...subFrames(ws).at(-1)!.params.events].sort()).toEqual([
            "actions:event",
            "actions:registry-updated",
            "triggers:event",
            "triggers:event2",
        ]);
        await ackAll(ws);

        // a second listener on an existing event must not re-announce
        const before = subFrames(ws).length;
        t.subscribeEvent("actions:event", () => {});
        await new Promise((r) => setTimeout(r, 30));
        expect(subFrames(ws).length).toBe(before);

        // shrink: dropping the last listener for an event removes it
        const dropCb = () => {};
        t.subscribeEvent("actions:scrap", dropCb);
        await waitFor(() =>
            subFrames(ws).some((f) => f.params.events.includes("actions:scrap")),
        );
        await ackAll(ws);
        const scrapIdx = subFrames(ws).length;
        t.unsubscribeEvent("actions:scrap", dropCb);
        await waitFor(() =>
            subFrames(ws).slice(scrapIdx).some(
                (f) =>
                    !f.params.events.includes("actions:scrap") &&
                    f.params.events.includes("triggers:event2"),
            ),
        );
        expect([...subFrames(ws).at(-1)!.params.events].sort()).toEqual([
            "actions:event",
            "actions:registry-updated",
            "triggers:event",
            "triggers:event2",
        ]);
    });

    test("subscribeSource fans out through the same subscription sync", async () => {
        const ws = await connect(() => {});
        const t = getTransport("local");
        const unsub = t.subscribeSource("progress", () => {});
        t.subscribeEvent("actions:event", () => {});
        await waitFor(() =>
            subFrames(ws).some(
                (f) =>
                    f.params.events.includes("progress") &&
                    f.params.events.includes("actions:event"),
            ),
        );
        unsub();
        await waitFor(() =>
            subFrames(ws).some(
                (s) =>
                    !s.params.events.includes("progress") &&
                    s.params.events.includes("actions:event"),
            ),
        );
    });

    test("reconnect re-announces the listener set", async () => {
        const ws = await connect((t) => {
            t.subscribeEvent("actions:event", () => {});
            t.subscribeEvent("triggers:event", () => {});
        });
        const t = getTransport("local");
        await waitFor(() => subFrames(ws).length >= 1);
        const expected = [...subFrames(ws)[0].params.events].sort();
        await ackAll(ws);

        ws.serverDrop();
        await waitFor(() => !t.isConnected(), 3000);

        // Parallel test files share globalThis and may clear the mock while we
        // await, leaving the transport to construct a real (never-opening) ws.
        // Re-install before each attempt and retry until the reconnect lands.
        let reAnnounce: any = null;
        for (let attempt = 0; attempt < 40 && !reAnnounce; attempt++) {
            (globalThis as any).WebSocket = MockWebSocket;
            const before = MockWebSocket.instances.length;
            const reconnecting = t.ensureConnected();
            try {
                await waitFor(() => MockWebSocket.instances.length > before, 150);
                const fresh = LAST();
                fresh.open();
                await reconnecting;
                reAnnounce = subFrames(fresh).find(
                    (f) => f.params.events.length === expected.length,
                );
            } catch (err) {
                console.error(`reconnect attempt ${attempt} missed: ${err}`);
            }
        }
        expect([...reAnnounce.params.events].sort()).toEqual(expected);
    });
});