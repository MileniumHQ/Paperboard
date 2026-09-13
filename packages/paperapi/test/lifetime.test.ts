// Status-listener lifetime, refused-invoke progress cleanup, transport
// registry teardown, and wildcard deprecation warnings (bun test).
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

type Listener = (e?: any) => void;

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    readyState = 0;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import { CraneTransport } from "../src/ws";
import { initPaperApi, getTransport, closeTransport, on, send } from "../src/ipc";
import { fileApi } from "../src/file";
import { actionsApi } from "../src/actions";

describe("status listener lifetime", () => {
    let t: CraneTransport;

    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
        t = new CraneTransport({ port: 1234, token: "tok" });
    });

    afterEach(() => {
        t.close();
        (globalThis as any).WebSocket = undefined;
    });

    test("offStatus removes a listener", async () => {
        const seen: boolean[] = [];
        const cb = (s: any) => seen.push(s.connected);
        t.onStatus(cb);
        t.offStatus(cb);
        const p = t.ensureConnected();
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await p;
        expect(seen).toEqual([]);
    });

    test("close() clears status listeners so nothing fires after teardown", async () => {
        const seen: boolean[] = [];
        t.onStatus((s: any) => seen.push(s.connected));
        const p = t.ensureConnected();
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await p;
        expect(seen).toEqual([true]);
        t.close();
        // a late socket close must not reach cleared listeners
        LAST().close();
        await sleep(20);
        expect(seen).toEqual([true]);
    });

    test("reconnect failures are logged, not dropped", async () => {
        const p = t.ensureConnected();
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await p;
        const errors: unknown[][] = [];
        const orig = console.error;
        // debugErr logs via console.error; capture it
        (console as any).error = (...a: unknown[]) => errors.push(a);
        try {
            // drop the socket: the close handler schedules a reconnect
            LAST().close();
            await waitFor(() => MockWebSocket.instances.length > 1);
            // fail the reconnect attempt: the error must be recorded,
            // not silently swallowed by the retry loop
            LAST().emit("error", new Error("ECONNREFUSED"));
            await waitFor(() => errors.length > 0);
            expect(String(errors[0][0])).toContain("reconnect attempt failed");
        } finally {
            (console as any).error = orig;
        }
        t.close();
    });
});

describe("refused invokes clean up progress listeners", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        closeTransport("local");
        (globalThis as any).WebSocket = undefined;
    });

    async function connect(): Promise<void> {
        const connecting = initPaperApi({ port: 1234, token: "tok" });
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await connecting;
    }

    test("fileApi.download unsubscribes when the daemon refuses the invoke", async () => {
        await connect();
        const stages: string[] = [];
        const running = fileApi.download({
            url: "https://example.com/x.bin",
            targetPath: "/tmp/x.bin",
            onProgress(p) {
                stages.push(p.stage);
            },
        });
        await waitFor(() => LAST().frames().some((f) => f.action === "file:download"));
        const frame = LAST().frames().find((f) => f.action === "file:download")!;
        const realId = frame.params.downloadId;
        LAST().receive({ type: "response", id: frame.id, error: "FORBIDDEN" });
        await expect(running).rejects.toThrow("FORBIDDEN");
        await sleep(10);
        // the leaked listener would still forward this; unsubscribed drops it
        LAST().receive({
            type: "event",
            event: "progress",
            payload: { downloadId: realId, stage: "downloading", percent: 50 },
        });
        await sleep(10);
        expect(stages).toEqual([]);
    });

    test("closeTransport drops the cached transport", async () => {
        await connect();
        const first = getTransport("local");
        closeTransport("local");
        const second = getTransport("local");
        expect(second).not.toBe(first);
        closeTransport("local");
    });

    test("wildcard subscriptions warn loudly (once)", async () => {
        await connect();
        const warnings: unknown[][] = [];
        const orig = console.warn;
        (console as any).warn = (...a: unknown[]) => warnings.push(a);
        try {
            const off1 = actionsApi.on("*", "evt", () => {});
            const off2 = actionsApi.onTrigger("panel", "*", () => {});
            off1();
            off2();
        } finally {
            (console as any).warn = orig;
        }
        expect(warnings.length).toBe(2);
        expect(String(warnings[0][0])).toContain("v3.1");
        expect(String(warnings[1][0])).toContain("v3.1");
    });
});

describe("onTrigger two-arg form resolves own panel, never wildcard", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        closeTransport("local");
        (globalThis as any).WebSocket = undefined;
    });

    async function connect(panelId?: string): Promise<void> {
        const connecting = initPaperApi({ port: 1234, token: "tok", panelId });
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await connecting;
    }

    test('two-arg onTrigger defaults to THIS panel, not "*"', async () => {
        await connect("dev.test.panel");
        const received: unknown[] = [];
        const off = actionsApi.onTrigger("my-trigger", (output) => {
            received.push(output);
        });
        LAST().receive({
            type: "event",
            event: "triggers:event",
            payload: {
                panelId: "dev.test.panel",
                trigger: "my-trigger",
                output: { hello: 1 },
            },
        });
        await sleep(10);
        expect(received).toEqual([{ hello: 1 }]);
        off();
        await sleep(10);
    });

    test("other panels' triggers with the same name do not arrive", async () => {
        await connect("dev.test.panel");
        const received: unknown[] = [];
        const off = actionsApi.onTrigger("my-trigger", (output) => {
            received.push(output);
        });
        LAST().receive({
            type: "event",
            event: "triggers:event",
            payload: {
                panelId: "dev.other.panel",
                trigger: "my-trigger",
                output: "stolen",
            },
        });
        await sleep(10);
        expect(received).toEqual([]);
        off();
        await sleep(10);
    });
});
describe("stream attach refcounting", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        closeTransport("local");
        (globalThis as any).WebSocket = undefined;
    });

    async function connect(): Promise<CraneTransport> {
        const connecting = initPaperApi({ port: 1234, token: "tok" });
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await connecting;
        return getTransport("local") as unknown as CraneTransport;
    }

    const attachCount = (action: string, id: string) =>
        MockWebSocket.instances.flatMap((i) => i.frames()).filter(
            (f) => f.action === action && f.params?.id === id,
        ).length;

    test("two subscribers share ONE attach; the last unsubscribe untracks", async () => {
        const t = await connect();
        const off1 = on("terminal-data:mc-shell", () => {});
        const off2 = on("terminal-data:mc-shell", () => {});
        await sleep(10);

        expect(attachCount("term:attach", "mc-shell")).toBe(1);
        expect((t as any).attachedTerminals.has("mc-shell")).toBe(true);

        // first unsubscribe must NOT untrack: a listener remains, so
        // reconnect replay would otherwise lose the stream
        off1();
        await sleep(10);
        expect(attachCount("term:attach", "mc-shell")).toBe(1);
        expect((t as any).attachedTerminals.has("mc-shell")).toBe(true);

        // the last unsubscribe tears the replay attachment down
        off2();
        await sleep(10);
        expect((t as any).attachedTerminals.has("mc-shell")).toBe(false);
    });

    test("process-data and process-stdout on the SAME id share one attachment", async () => {
        const t = await connect();
        const off1 = on("process-data:proc-1", () => {});
        const off2 = on("process-stdout:proc-1", () => {});
        await sleep(10);

        // one daemon resource, one attach RPC — not one per channel kind
        expect(attachCount("process:attach", "proc-1")).toBe(1);
        expect((t as any).attachedProcesses.has("proc-1")).toBe(true);

        // one unsubscribed channel must not untrack the shared process
        off2();
        await sleep(10);
        expect((t as any).attachedProcesses.has("proc-1")).toBe(true);
        off1();
        await sleep(10);
        expect((t as any).attachedProcesses.has("proc-1")).toBe(false);
    });

    test("destroy then resubscribe re-attaches fresh", async () => {
        await connect();
        const off1 = on("terminal-data:t-x", () => {});
        await sleep(10);
        expect(attachCount("term:attach", "t-x")).toBe(1);

        off1();
        await sleep(10);

        const off2 = on("terminal-data:t-x", () => {});
        await sleep(10);
        expect(attachCount("term:attach", "t-x")).toBe(2);
        off2();
    });

    test("terminal-destroy tears the ledger so resubscribe attaches fresh", async () => {
        await connect();
        const off1 = on("terminal-data:t-d", () => {});
        await sleep(10);
        expect(attachCount("term:attach", "t-d")).toBe(1);

        // destroy the resource while the subscription remains: the daemon
        // is told, the transport untracks, and the ledger drops
        send("terminal-destroy", { id: "t-d" });
        await sleep(10);

        // a fresh subscription attaches again (no stale-count shortcut)
        const off2 = on("terminal-data:t-d", () => {});
        await sleep(10);
        expect(attachCount("term:attach", "t-d")).toBe(2);
        off1();
        off2();
    });
});
