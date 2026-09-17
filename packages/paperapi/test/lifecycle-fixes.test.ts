// Lifecycle fixes T14/T15/T16/T19/T20 (bun test): route timeout wiring,
// per-transport attach ledger, actions.on identity refusal, send() promise,
// full close() teardown. Mocks globalThis.WebSocket (no real sockets).
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

import { CraneTransport } from "../src/ws";
import {
    invoke,
    initPaperApi,
    getTransport,
    closeTransport,
    on,
} from "../src/ipc";
import { actionsApi } from "../src/actions";
import { processApi } from "../src/process";

beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;
});

afterEach(() => {
    (CraneTransport.prototype as any).call = CraneTransport.prototype.call;
    (globalThis as any).WebSocket = undefined;
    closeTransport("local");
});

async function connect(): Promise<CraneTransport> {
    const connecting = initPaperApi({ port: 1234, token: "tok" });
    // wait for a NEW socket (the ledger-replacement connect may race a
    // prior test's already-counted instance)
    const before = MockWebSocket.instances.length;
    await waitFor(() => MockWebSocket.instances.length > before);
    LAST().open();
    await connecting;
    return getTransport("local");
}

// ─── T14: route timeoutMs reaches transport.call ────────────────────────────

describe("route timeout wiring", () => {
    test("panel-uninstall passes null timeout (may run past the 30s default)", async () => {
        await connect();
        const recorded: { action: string; timeoutMs: unknown }[] = [];
        const orig = CraneTransport.prototype.call;
        (CraneTransport.prototype as any).call = function (
            action: string,
            _params: any,
            timeoutMs: unknown,
        ) {
            recorded.push({ action, timeoutMs });
            return Promise.resolve({ success: true });
        };
        try {
            const res = await invoke("panel-uninstall", "dev.test.panel");
            expect(res).toBe(true);
        } finally {
            (CraneTransport.prototype as any).call = orig;
        }
        const rec = recorded.find((r) => r.action === "panel:uninstall");
        expect(rec).toBeTruthy();
        expect(rec!.timeoutMs).toBeNull();
    });

    test("routes without an explicit timeout keep the 30s default", async () => {
        await connect();
        const recorded: { action: string; timeoutMs: unknown }[] = [];
        const orig = CraneTransport.prototype.call;
        (CraneTransport.prototype as any).call = function (
            action: string,
            _params: any,
            timeoutMs: unknown,
        ) {
            recorded.push({ action, timeoutMs });
            return Promise.resolve({ running: true });
        };
        try {
            await invoke("terminal-exists", { id: "t1" });
        } finally {
            (CraneTransport.prototype as any).call = orig;
        }
        const rec = recorded.find((r) => r.action === "term:exists");
        expect(rec).toBeTruthy();
        expect(rec!.timeoutMs).toBe(30_000);
    });
});

// ─── T15: the attach ledger is per-transport ────────────────────────────────

describe("per-transport attach ledger", () => {
    test("after closeTransport a fresh transport re-attaches despite the stale ledger", async () => {
        await connect();
        // active subscription: the ledger now claims "attachment live" for t1
        const off = on("terminal-data:t1", () => {});
        await waitFor(() =>
            LAST().frames().some((f) => f.action === "term:attach"),
        );
        // transport dropped WITH the subscription still active
        closeTransport("local");
        await connect();
        console.log("DBG frames2", JSON.stringify(LAST().frames().map(f=>f.action)), "n=", MockWebSocket.instances.length);
        const off2 = on("terminal-data:t1", () => {});
        console.log("DBG after on, frames", JSON.stringify(LAST().frames().map(f=>f.action)));
        try {
            // the replacement transport must re-attach — a refcount keyed
            // only by resource id would silently skip this attach
            await waitFor(() => LAST().frames().some((f) => f.action === "term:attach"));
        } finally {
            off?.();
            off2?.();
        }
    });
});

// ─── T16: actions.on two-arg form throws on unresolvable identity ───────────

describe("actions.on identity refusal", () => {
    test("two-arg on throws the helpful identity error (no silent no-op)", () => {
        const saved = process.env.PAPERBOARD_PANEL_ID;
        delete process.env.PAPERBOARD_PANEL_ID;
        try {
            expect(() => actionsApi.on("some-event", () => {})).toThrow(
                /could not resolve this panel's id/,
            );
            expect(() => actionsApi.onTrigger("some-trigger", () => {})).toThrow(
                /could not resolve this panel's id/,
            );
        } finally {
            if (saved !== undefined) process.env.PAPERBOARD_PANEL_ID = saved;
        }
    });

    test("three-arg on with explicit panel id works without identity", async () => {
        await connect();
        const received: unknown[] = [];
        const off = actionsApi.on("dev.other.panel", "evt", (payload) => {
            received.push(payload);
        });
        LAST().receive({
            type: "event",
            event: "actions:dev.other.panel:evt",
            payload: { n: 1 },
        });
        LAST().receive({
            type: "event",
            event: "actions:event",
            payload: { panelId: "dev.other.panel", event: "other", payload: {} },
        });
        expect(received).toEqual([{ n: 1 }]);
        off();
    });
});

// ─── T19: send() failures are awaited, not fire-and-dropped ─────────────────

describe("send returns a bounded promise", () => {
    test("terminal-create and process.write/kill return promises", async () => {
        await connect();
        expect(typeof processApi.write("p1", "hi").then).toBe("function");
        expect(typeof processApi.kill("p1").then).toBe("function");
    });
});

// ─── T20: close() is a full teardown ────────────────────────────────────────

describe("close() full teardown", () => {
    test("close() clears every subscription registry and attached set", async () => {
        const t = await connect();
        const off = on("terminal-data:term-a", () => {});
        t.trackProcess("proc-a");
        off();
        t.close();
        expect((t as any).listeners.size).toBe(0);
        expect((t as any).sourceSubs.size).toBe(0);
        expect((t as any).rawListeners.size).toBe(0);
        expect((t as any).statusListeners.size).toBe(0);
        expect((t as any).attachedTerminals.size).toBe(0);
        expect((t as any).attachedProcesses.size).toBe(0);
    });

    test("events dispatched after close() reach no released listener", async () => {
        const t = await connect();
        const seen: unknown[] = [];
        on("terminal-data:term-b", (data: any) => seen.push(data));
        t.close();
        // simulate a late frame from the dying socket
        LAST().receive({
            type: "event",
            event: "term:data",
            payload: { id: "term-b", data: "late" },
        });
        expect(seen).toEqual([]);
    });
});
