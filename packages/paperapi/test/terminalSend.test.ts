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
import { terminalApi } from "../src/index";

// a keystroke or resize the daemon refused must reach the terminal that sent
// it: swallowed, typing into a dead session just vanishes
describe("terminal write and resize failures", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        getTransport("local").close();
        (globalThis as any).WebSocket = undefined;
    });

    for (const [name, send, action] of [
        ["write", () => terminalApi.write("t1", "ls\r"), "term:write"],
        ["resize", () => terminalApi.resize("t1", 120, 40), "term:resize"],
    ] as const) {
        test(`a refused ${name} rejects with the daemon's reason`, async () => {
            const connecting = initPaperApi({ port: 1234, token: "tok" });
            await waitFor(() => MockWebSocket.instances.length > 0);
            LAST().open();
            await connecting;

            const result = send();
            await waitFor(() => LAST().frames().some((f) => f.action === action));
            const frame = LAST().frames().find((f) => f.action === action)!;
            LAST().receive({ type: "response", id: frame.id, error: 'Terminal "t1" not found' });

            await expect(result).rejects.toThrow('Terminal "t1" not found');
        });
    }
});
