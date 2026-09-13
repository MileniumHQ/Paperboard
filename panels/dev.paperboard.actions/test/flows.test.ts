import { describe, it, expect } from "bun:test";
import { executeFlow, clampWaitValue } from "../src/lib/runtime";
import { BUILTIN_CATEGORIES } from "../src/lib/builtins";

// ported from the ad-hoc verify-flows script — real tests, zero network
// blocks (the HTTP round-trips live behind the web builtin but need a
// server; executor paths without them are covered here)

const schemaFor = (id: string): any => {
    for (const cat of BUILTIN_CATEGORIES as any[]) {
        for (const item of cat.items || []) {
            if (item.action === id || item.trigger === id) return item.schema;
        }
    }
    throw new Error(`no schema for ${id}`);
};

let n = 0;
const blk = (actionId: string, values: Record<string, any> = {}, children?: any[]) => ({
    id: `b${++n}_${actionId}`,
    panelId: "builtin.logic",
    pos: { x: 0, y: 0 },
    isTrigger: false,
    action: schemaFor(actionId),
    values,
    ...(children ? { children } : {}),
});
const trig = (children: any[], payload: any = {}) => ({
    block: {
        id: "trig",
        panelId: "builtin.logic",
        pos: { x: 0, y: 0 },
        isTrigger: true,
        action: { id: "chat-message", name: "x", output: { type: "object", label: "Message" } },
        values: {},
        children,
    },
    payload,
});

describe("builtin registry integrity", () => {
    it("every item has a unique action/trigger id and a schema", () => {
        const seen = new Set<string>();
        for (const cat of BUILTIN_CATEGORIES as any[]) {
            for (const item of cat.items || []) {
                const id = item.action || item.trigger;
                expect(id).toBeString();
                expect(seen.has(id)).toBe(false);
                seen.add(id);
                expect(item.schema).toBeObject();
                expect(schemaFor(id).id).toBe(id);
            }
        }
    });

    it("builtin items resolve to reserved builtin.* panel ids", () => {
        const okPanels = new Set(["builtin.computer", "builtin.logic"]);
        for (const cat of BUILTIN_CATEGORIES as any[]) {
            for (const item of (cat.items || []) as any[]) {
                const id = item.action || item.trigger;
                const owning = item.panelId || (cat as any).panelId;
                expect(okPanels.has(owning)).toBe(true);
                expect(typeof id).toBe("string");
                expect(schemaFor(id)).toBeObject();
            }
        }
    });
});

describe("flow execution", () => {
    // captured text/variable pipeline (no shell, no net)
    it("template reply pipeline: contains -> replace -> variable round trip", async () => {
        const { block, payload } = trig(
            [
                blk("text-contains", { text: "{{content:Content:chat}}", substring: "!ip" }),
                blk("text", { value: "Server IP: play.example.com\nPort: 25565" }),
                blk("text-replace", {
                    text: "{{output:Text:notes}}",
                    find: "play.example.com",
                    replacement: "mc.example.com",
                }),
                blk("set-variable", { key: "last_reply", value: "{{output:Replaced Text:find_replace}}" }),
                blk("get-variable", { key: "last_reply" }),
            ],
            { content: "hey !ip please", author: "Steve", channelId: "123" },
        );
        const log = await executeFlow(block as any, payload);
        expect(log.status).toBe("success");
        const steps = Object.fromEntries(log.steps.map((s: any) => [s.actionName, s.result]));
        expect(steps["Text Contains"]).toBe(true);
        expect(steps["Replace Text"]).toBe("Server IP: mc.example.com\nPort: 25565");
        expect(steps["Get Variable"]).toBe("Server IP: mc.example.com\nPort: 25565");
    });

    it("counter, clamp and coalesce semantics hold", async () => {
        const { block } = trig([
            blk("increment-variable", { key: "joins", amount: "1" }),
            blk("increment-variable", { key: "joins", amount: "1" }),
            blk("math-clamp", { value: "{{output:joins:exposure}}", min: "0", max: "1" }),
            blk("coalesce", { first: "   ", second: "welcome!" }),
        ]);
        const log = await executeFlow(block as any, {});
        expect(log.status).toBe("success");
        const steps = Object.fromEntries(log.steps.map((s: any) => [s.actionName, s.result]));
        expect(steps["Increment Variable"]).toBe(2);
        expect(steps["Clamp Number"]).toBe(1);
        expect(steps["First Value"]).toBe("welcome!");
    });
});

describe("bounded resources", () => {
    it("refuses a set-variable past the store cap", async () => {
        // fill the store: MAX_VARIABLES is 500 in runtime — push past it
        const fill = Array.from({ length: 502 }, (_, i) =>
            blk("set-variable", { key: `captest_${i}`, value: i }),
        );
        // a handler throw surfaces as a step error + flow-level error,
        // never as a pass-through result
        const log = await executeFlow(trig(fill).block as any, {});
        const capStep = log.steps.find((st: any) => /Variable store full/i.test(String(st.error)));
        expect(log.status).toBe("error");
        expect(String(capStep?.error)).toEqual(expect.stringMatching(/Variable store full/i));
    });

    it("clamps an over-long wait instead of parking the flow", async () => {
        // pure clamp proof: Infinity and absurd values clamp to the cap,
        // negatives bottom out at zero — nothing can park a flow forever
        expect(clampWaitValue("Infinity", "s")).toBe(3600);
        expect(clampWaitValue(Number.POSITIVE_INFINITY, "s")).toBe(3600);
        expect(clampWaitValue(999999, "ms")).toBe(999999);
        expect(clampWaitValue(4000000, "ms")).toBe(3600000);
        expect(clampWaitValue(-50, "s")).toBe(0);
        expect(clampWaitValue("2.5", "s")).toBe(2.5);
        // and a real (short) flow honors it
        const { block } = trig([blk("wait", { duration: 0.01 })]);
        const log = await executeFlow(block as any, {});
        expect(log.status).toBe("success");
    });
});
