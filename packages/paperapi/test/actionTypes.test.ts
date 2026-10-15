// What a registered action carries over the wire (bun test; mocks
// globalThis.WebSocket). Types live in the panel's own process, so the only
// way the Actions editor can name and draw them is the registered schema:
// registration must carry every custom type the action names. Declared
// input limits are enforced on the call itself, before `run`.
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
import { checkActionInput, defineAction, defineType } from "../src/schema";

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

describe("declared input limits", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        (globalThis as any).WebSocket = MockWebSocket;
    });

    afterEach(() => {
        getTransport("local").close();
        (globalThis as any).WebSocket = undefined;
    });

    test("name the input and the broken limit; unknown and empty values break none", () => {
        const picks = { type: "number", label: "Picks", min: 1, max: 25, integer: true };
        expect(checkActionInput(picks, 30)).toBe('"Picks" must be at most 25');
        expect(checkActionInput(picks, "2.5")).toBe('"Picks" must be a whole number');
        expect(checkActionInput(picks, "lots")).toBe('"Picks" must be a number');
        expect(checkActionInput(picks, "")).toBeUndefined();
        expect(checkActionInput(picks, "{{x}}", (v) => String(v).includes("{{"))).toBeUndefined();

        const options = { type: "list<string>", label: "Options", maxItems: 2, maxLength: 3 };
        expect(checkActionInput(options, ["a", "b", "c"])).toBe('"Options" holds at most 2 items (it has 3)');
        expect(checkActionInput(options, ["a", "long"])).toBe(
            'Item 2 of "Options" holds at most 3 characters (it has 4)',
        );
        // a variable item may hold many items: only known items count
        expect(
            checkActionInput(options, ["a", "{{x}}"], (v) => String(v).includes("{{")),
        ).toBeUndefined();
    });

    test("a definition with an impossible limit is refused", async () => {
        await expect(
            actionsApi.register(
                defineAction({
                    id: "bad-limits",
                    name: "Bad",
                    description: "",
                    inputs: { n: { type: "number", label: "N", min: 5, max: 1 } },
                    run: () => null,
                }),
                undefined,
                "test.panel",
            ),
        ).rejects.toThrow(/min above its max/);
    });

    test("a call that breaks a limit is refused before run sees it", async () => {
        const connecting = initPaperApi({ port: 4321, token: "tok" });
        await waitFor(() => MockWebSocket.instances.length > 0);
        LAST().open();
        await connecting;

        const seen: unknown[] = [];
        const registering = actionsApi.register(
            defineAction({
                id: "set-title",
                name: "Set Title",
                description: "Sets a title",
                inputs: { title: { type: "string", label: "Title", maxLength: 5 } },
                run: (_ctx, inputs) => {
                    seen.push(inputs.title);
                    return true;
                },
            }),
            undefined,
            "test.panel",
        );
        await waitFor(() => LAST().frames().some((f) => f.action === "actions:register"));
        const frame = LAST().frames().find((f) => f.action === "actions:register")!;
        LAST().receive({ type: "response", id: frame.id, result: { success: true } });
        await registering;
        expect(frame.params.schema.inputs.title.maxLength).toBe(5);

        const reply = async (callId: string, title: string) => {
            LAST().receive({
                type: "action_call",
                callId,
                panelId: "test.panel",
                action: "set-title",
                args: [{ title }],
            });
            await waitFor(() => LAST().frames().some((f) => f.callId === callId));
            return LAST().frames().find((f) => f.callId === callId);
        };
        expect((await reply("c1", "Too long")).error).toBe(
            '"Title" holds at most 5 characters (it has 8)',
        );
        expect((await reply("c2", "Short")).result).toBe(true);
        expect(seen).toEqual(["Short"]);
    });
});
