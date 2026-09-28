// TransportRegistry (bun test): handlers are keyed by "panelId:action" only.
// A name is owned by the panel that registers it, so two panels can use the
// same action name without colliding, and no bare-name key exists to read.
import { describe, test, expect } from "bun:test";

import { TransportRegistry } from "../src/transport/registry";

describe("namespaced registration", () => {
    test("two panels register the same action name without colliding", () => {
        const r = new TransportRegistry();
        const ha = () => "a";
        const hb = () => "b";
        r.addAction("panel-a", "get", ha);
        r.addAction("panel-b", "get", hb);
        expect(r.getHandler("panel-a:get")).toBe(ha);
        expect(r.getHandler("panel-b:get")).toBe(hb);
    });

    test("a bare action name is never a dispatch key", () => {
        const r = new TransportRegistry();
        r.addAction("panel-a", "status", () => "ok");
        expect(r.getHandler("status")).toBeUndefined();
        expect([...r.actionHandlers.keys()]).toEqual(["panel-a:status"]);
    });

    test("removing one panel's action leaves the other panel's intact", () => {
        const r = new TransportRegistry();
        r.addAction("panel-a", "get", () => "a");
        r.addAction("panel-b", "get", () => "b");
        r.removeAction("panel-a", "get");
        expect(r.getHandler("panel-a:get")).toBeUndefined();
        expect(r.getHandler("panel-b:get")).toBeDefined();
    });
});

describe("resubscribe", () => {
    test("registrations replay under their own panel, never the ambient one", async () => {
        const r = new TransportRegistry();
        r.addAction("panel-a", "get", () => "a");
        r.addAction("panel-b", "get", () => "b", { type: "object" });
        const calls: { action: string; params: Record<string, unknown> }[] = [];
        await r.resubscribe(
            (action, params) => {
                calls.push({ action, params });
                return Promise.resolve(null);
            },
            () => {},
        );
        expect(calls).toEqual([
            { action: "actions:register", params: { panelId: "panel-a", action: "get", schema: undefined } },
            { action: "actions:register", params: { panelId: "panel-b", action: "get", schema: { type: "object" } } },
        ]);
    });

    test("N registrations replay with exactly N actions:register calls", async () => {
        const r = new TransportRegistry();
        const n = 200;
        for (let i = 0; i < n; i++) r.addAction(`panel-${i}`, `op-${i}`, () => i);
        let registers = 0;
        await r.resubscribe(
            (action) => {
                if (action === "actions:register") registers++;
                return Promise.resolve(null);
            },
            () => {},
        );
        expect(registers).toBe(n);
    });
});
