// Panel-defined types reach the flow builder (bun test; mocks
// globalThis.WebSocket). Types live in the panel's own process, so the only
// way the Actions editor can name and draw them is the registered schema:
// registration must carry every custom type the action names.
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
import { defineAction, defineType } from "../src/schema";

describe("registered schemas carry the panel's types", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        getTransport("local").close();
        (globalThis as any).WebSocket = undefined;
    });

    test("every named custom type, and the types its fields name, reach the wire", async () => {
        defineType({ id: "test-guild", name: "Guild", icon: "groups", base: "string" });
        defineType({
            id: "test-ticket",
            name: "Ticket",
            icon: "confirmation_number",
            base: "object",
            toString: (value: any) => String(value?.id),
            fields: { guild: { type: "test-guild", label: "Guild" } },
        });
        const connecting = initPaperApi({ port: 4321, token: "tok" });
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await connecting;

        const registering = actionsApi.register(
            defineAction({
                id: "close-ticket",
                name: "Close Ticket",
                description: "Closes tickets",
                deprecated: "Use Archive Ticket instead",
                inputs: { tickets: { type: "list<test-ticket>", label: "Tickets" } },
                output: { type: "boolean" },
                run: () => true,
            }),
            undefined,
            "test.panel",
        );
        await waitFor(() => LAST().frames().some((f) => f.action === "actions:register"));
        const frame = LAST().frames().find((f) => f.action === "actions:register")!;
        LAST().receive({ type: "response", id: frame.id, result: { success: true } });
        await registering;

        // the deprecation travels too: the library hides it, placed blocks warn
        expect(frame.params.schema.deprecated).toBe("Use Archive Ticket instead");
        expect(frame.params.schema.types).toEqual({
            "test-ticket": {
                id: "test-ticket",
                name: "Ticket",
                icon: "confirmation_number",
                base: "object",
                fields: { guild: { type: "test-guild", label: "Guild" } },
            },
            "test-guild": { id: "test-guild", name: "Guild", icon: "groups", base: "string" },
        });
    });
});
