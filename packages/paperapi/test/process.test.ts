// process.run timeout kills the child (bun test); mocks globalThis.WebSocket
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
import { processApi } from "../src/process";

describe("process.run timeout", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        getTransport("local").close();
        (globalThis as any).WebSocket = undefined;
    });

    test("timeout kills the child (process:kill) and reports RUN_TIMEOUT", async () => {
        const connecting = initPaperApi({ port: 1234, token: "tok" });
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await connecting;

        const result = processApi.run({ command: "sleep", args: ["60"] }, 25);

        // daemon accepts the run
        await waitFor(() => LAST().frames().some((f) => f.action === "process:run"));
        const runFrame = LAST().frames().find((f) => f.action === "process:run")!;
        LAST().receive({ type: "response", id: runFrame.id, result: { success: true } });

        // the caller's bounded promise resolves as a timeout — not a silent hang
        const outcome = await result;
        expect(outcome.code).toBe("RUN_TIMEOUT");
        expect(outcome.exitCode).toBe(-1);

        // the child was killed, by id, via SIGTERM through the daemon rpc
        await waitFor(() => LAST().frames().some((f) => f.action === "process:kill"));
        const killFrame = LAST().frames().find((f) => f.action === "process:kill")!;
        expect(killFrame.params.id).toBe(runFrame.params.id);
        expect(killFrame.params.signal).toBe("SIGTERM");
    });

    test("normal child exit resolves with its real exit code and no kill frame", async () => {
        const connecting = initPaperApi({ port: 1235, token: "tok" });
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await connecting;

        const result = processApi.run({ command: "true" }, 500);

        await waitFor(() => LAST().frames().some((f) => f.action === "process:run"));
        const runFrame = LAST().frames().find((f) => f.action === "process:run")!;
        LAST().receive({ type: "response", id: runFrame.id, result: { success: true } });

        LAST().receive({
            type: "event",
            event: "process:exit",
            payload: { id: runFrame.params.id, exitCode: 0 },
        });

        const outcome = await result;
        expect(outcome).toEqual({ exitCode: 0 });
        expect(LAST().frames().some((f) => f.action === "process:kill")).toBe(false);
    });

    test("exec rejects with RUN_TIMEOUT instead of returning exit -1 as success", async () => {
        const connecting = initPaperApi({ port: 1236, token: "tok" });
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await connecting;

        const result = processApi.exec("sleep", ["60"], { timeoutMs: 25 });

        await waitFor(() => LAST().frames().some((f) => f.action === "process:run"));
        const runFrame = LAST().frames().find((f) => f.action === "process:run")!;
        LAST().receive({ type: "response", id: runFrame.id, result: { success: true } });

        await expect(result).rejects.toThrow(/RUN_TIMEOUT/);
        await waitFor(() => LAST().frames().some((f) => f.action === "process:kill"));
    });
});
