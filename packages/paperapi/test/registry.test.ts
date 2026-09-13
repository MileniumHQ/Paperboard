// TransportRegistry bare-name collision refusal (bun test)
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import { TransportRegistry } from "../src/transport/registry";

function makeRegistry(defaultPanelId = "local") {
    return new TransportRegistry(() => defaultPanelId);
}

const origWarn = console.warn;
const origError = console.error;
let warnCalls: string[] = [];
let errCalls: string[] = [];

beforeEach(() => {
    warnCalls = [];
    errCalls = [];
    console.warn = (...args: unknown[]) => {
        warnCalls.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
        errCalls.push(args.map(String).join(" "));
    };
});

afterEach(() => {
    console.warn = origWarn;
    console.error = origError;
});

describe("bare-name registration", () => {
    test("two panels claiming the same bare name: the second throws, naming both", () => {
        const r = makeRegistry();
        r.setActionHandler("restart", () => "ok", "panel-a");

        expect(() => r.setActionHandler("restart", () => "ok", "panel-b")).toThrowError(
            /action 'restart' is already claimed by panel 'panel-a'; cannot register it for panel 'panel-b'/,
        );

        // first registration survives unchanged
        expect(r.resolveHandler("restart")).toBeDefined();
        expect(typeof r.getHandler("panel-a:restart")).toBe("function");
        expect(r.getHandler("panel-b:restart")).toBeUndefined();
    });

    test("re-registering the same name by the same panel is allowed", () => {
        const r = makeRegistry();
        r.setActionHandler("restart", () => "v1", "panel-a");
        expect(() => r.setActionHandler("restart", () => "v2", "panel-a")).not.toThrow();
        expect(r.resolveHandler("restart")).toBeDefined();
    });
});

describe("resolveHandler", () => {
    test("unique bare name resolves", () => {
        const r = makeRegistry();
        const handler = () => 42;
        r.setActionHandler("ping", handler, "panel-a");
        expect(r.resolveHandler("ping")).toBe(handler);
        expect(r.resolveHandler("panel-a:ping")).toBe(handler);
    });

    test("composite-only panels with the same action name: explicit target dispatches, bare call is refused", () => {
        const r = makeRegistry();
        const ha = () => "result-a";
        const hb = () => "result-b";
        r.addAction("panel-a", "get", ha);
        r.addAction("panel-b", "get", hb);

        // explicit target dispatches to the right handler
        expect(r.resolveHandler("panel-a:get")).toBe(ha);
        expect(r.resolveHandler("panel-b:get")).toBe(hb);

        // bare name without a claim is ambiguous: refused loudly
        expect(r.resolveHandler("get")).toBeUndefined();
        expect(errCalls.some((m) => m.includes("refusing ambiguous dispatch"))).toBe(true);
    });

    test("a single composite-only panel still resolves via its bare name (implicit read-through)", () => {
        const r = makeRegistry();
        const handler = () => "ok";
        r.addAction("panel-a", "status", handler);
        expect(r.resolveHandler("status")).toBe(handler);
        expect(r.resolveHandler("panel-a:status")).toBe(handler);
    });

    test("unclaimed bare name with no composite match resolves undefined", () => {
        const r = makeRegistry();
        expect(r.resolveHandler("nope")).toBeUndefined();
        expect(errCalls).toEqual([]);
    });
});

describe("removeAction", () => {
    test("removing a bare-named action releases the bare claim", () => {
        const r = makeRegistry();
        r.setActionHandler("restart", () => "ok", "panel-a");
        r.removeAction("panel-a", "restart");
        expect(r.resolveHandler("restart")).toBeUndefined();
        expect(r.getHandler("panel-a:restart")).toBeUndefined();
    });

    test("removing one panel's composite leaves the other panel's composite intact", () => {
        const r = makeRegistry();
        r.addAction("panel-a", "get", () => "a");
        r.addAction("panel-b", "get", () => "b");
        r.removeAction("panel-a", "get");
        expect(r.resolveHandler("panel-b:get")).toBeDefined();
        expect(r.resolveHandler("panel-a:get")).toBeUndefined();
        // one composite remains, so the bare read-through is unambiguous again
        expect(r.resolveHandler("get")).toBeDefined();
    });
});

describe("resubscribe", () => {
    test("bare-named handler re-registers under its owning panel", async () => {
        const r = makeRegistry("panel-x");
        r.setActionHandler("restart", () => "ok");
        const calls: Record<string, unknown>[] = [];
        await r.resubscribe(
            (action, params) => {
                calls.push({ action, params });
                return Promise.resolve(null);
            },
            () => {},
        );
        expect(calls.some((c) => c.action === "actions:register")).toBe(true);
        const reg = calls.find((c) => c.action === "actions:register");
        expect(reg?.params).toMatchObject({ panelId: "panel-x", action: "restart" });
    });

    test("composite-only registrations replay under their own panel, never the ambient one", async () => {
        const r = makeRegistry("panel-x");
        r.addAction("panel-a", "get", () => "a");
        r.addAction("panel-b", "get", () => "b");
        const calls: Record<string, unknown>[] = [];
        await r.resubscribe(
            (action, params) => {
                calls.push({ action, params });
                return Promise.resolve(null);
            },
            () => {},
        );
        const registers = calls.filter((c) => c.action === "actions:register");
        expect(registers.length).toBe(2);
        expect(registers.map((c) => c.params)).toEqual([
            { panelId: "panel-a", action: "get", schema: undefined },
            { panelId: "panel-b", action: "get", schema: undefined },
        ]);
    });

    test("covered bare name is not double-registered (exactly one emit per registration)", async () => {
        const r = makeRegistry("panel-x");
        // the bare claim and a composite registration exist for the same name;
        // resubscribe must replay the composite entry and skip the bare name —
        // never two actions:register emits for one action
        r.setActionHandler("restart", () => "ok", "panel-a");
        r.addAction("panel-a", "restart", () => "ok", { type: "object" });
        const calls: Record<string, unknown>[] = [];
        await r.resubscribe(
            (action, params) => {
                calls.push({ action, params });
                return Promise.resolve(null);
            },
            () => {},
        );
        const emits = calls.filter((c) => c.action === "actions:register");
        expect(emits.length).toBe(1);
        expect(emits[0].params).toEqual({
            panelId: "panel-a",
            action: "restart",
            schema: { type: "object" },
        });
    });

    test("N registrations replay with exactly N actions:register calls at scale", async () => {
        const r = makeRegistry("panel-x");
        const n = 200;
        for (let i = 0; i < n; i++) {
            r.addAction(`panel-${i}`, `op-${i}`, () => i);
        }
        let actions = 0;
        let bare = 0;
        await r.resubscribe(
            (action) => {
                if (action === "actions:register") actions++;
                else if (action === "actions:register-bare") bare++;
                return Promise.resolve(null);
            },
            () => {},
        );
        expect(actions).toBe(n);
        expect(bare).toBe(0);
    });
});