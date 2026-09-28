// Event actions at the sync boundary and parameterized routing (bun test,
// hermetic): a listen-only action starts flows — it has no run body, so it
// can never be executed as a step inside one. Roots of a parameterized
// event fire only when the schema's match rules hold against the payload;
// a match that can never fire is refused at sync instead of saved dead.
import { describe, it, expect, afterAll } from "bun:test";
import {
    actions as serviceActions,
    __actionsTestState,
    handleTriggerEventForTest,
} from "../src/service";
import { matchHolds, payloadFieldValue } from "../src/lib/runtime";
import type { CanvasBlock } from "../src/lib/tree";

describe("generic match comparison", () => {
    it("is exact: case differences are different ids", () => {
        expect(matchHolds("roll-dice", "roll-dice")).toBe(true);
        expect(matchHolds("Roll-Dice", "roll-dice")).toBe(false);
    });

    it("coerces only literal-vs-primitive scalars", () => {
        expect(matchHolds("123", 123)).toBe(true);
        expect(matchHolds(true, "true")).toBe(true);
        expect(matchHolds("1", 1)).toBe(true);
    });

    it("never matches objects, nulls or absent values", () => {
        expect(matchHolds({ a: 1 }, { a: 1 })).toBe(false);
        expect(matchHolds("x", undefined)).toBe(false);
        expect(matchHolds(undefined, "x")).toBe(false);
        expect(matchHolds("x", null)).toBe(false);
    });

    it("reads dotted payload fields without variable special cases", () => {
        const payload = { values: { channel: "c1" }, top: "t" };
        expect(payloadFieldValue(payload, "values.channel")).toBe("c1");
        expect(payloadFieldValue(payload, "top")).toBe("t");
        expect(payloadFieldValue(payload, "missing.deep")).toBeUndefined();
    });

    it("addresses a scalar payload itself with $", () => {
        expect(payloadFieldValue("qwen3:8b", "$")).toBe("qwen3:8b");
        expect(matchHolds("qwen3:8b", payloadFieldValue("qwen3:8b", "$"))).toBe(true);
    });
});

describe("parameterized event routing", () => {
    const emitted: { trigger: string; output: any }[] = [];
    __actionsTestState.setServiceCtx({
        emitTrigger: (id: string, output: any) => emitted.push({ trigger: id, output }),
        setState: () => {},
    } as any);

    afterAll(() => {
        __actionsTestState.setFlows([]);
        emitted.length = 0;
    });

    const rootWith = (id: string, itemId: string | undefined): CanvasBlock => ({
        id: `flow_${id}`,
        panelId: "dev.example",
        pos: { x: 0, y: 0 },
        isTrigger: true,
        action: {
            id: "item-ready",
            name: "When Item Ready",
            inputs: { itemId: { type: "string", label: "Item" } },
            // no match rules at all: the event fans out to this root
            ...(itemId === undefined ? {} : { match: { field: "itemId", input: "itemId" } }),
        },
        values: itemId !== undefined ? { itemId } : {},
        children: [],
    });

    const fire = async (itemId: string): Promise<void> => {
        emitted.length = 0;
        handleTriggerEventForTest(
            { itemId },
            { panelId: "dev.example", trigger: "item-ready" },
        );
        await Bun.sleep(20);
    };

    it("routes each event to exactly the root whose literal matches", async () => {
        __actionsTestState.setFlows([rootWith("a", "item-a"), rootWith("b", "item-b")]);
        await fire("item-a");
        expect(emitted.some((e) => e.trigger === "flow-start" && e.output?.triggerBlockId === "flow_a")).toBe(true);
        expect(emitted.some((e) => e.trigger === "flow-start" && e.output?.triggerBlockId === "flow_b")).toBe(false);
        await fire("item-b");
        expect(emitted.some((e) => e.trigger === "flow-start" && e.output?.triggerBlockId === "flow_b")).toBe(true);
    });

    it("a root without match rules keeps the fan-out contract", async () => {
        __actionsTestState.setFlows([rootWith("plain", undefined)]);
        await fire("anything");
        expect(emitted.some((e) => e.trigger === "flow-start")).toBe(true);
    });

    it("a missing payload field is routing, not a failure: nothing fires", async () => {
        __actionsTestState.setFlows([rootWith("a", "item-a")]);
        emitted.length = 0;
        handleTriggerEventForTest(
            { other: "x" },
            { panelId: "dev.example", trigger: "item-ready" },
        );
        await Bun.sleep(20);
        expect(emitted.some((e) => e.trigger === "flow-start")).toBe(false);
    });

    it("an unselected clearable input is (any): the root fires for every value", async () => {
        const anyRoot: CanvasBlock = {
            ...rootWith("any", undefined),
            action: {
                id: "item-ready",
                name: "When Item Ready",
                inputs: { itemId: { type: "string", label: "Item", allowEmpty: true } },
                match: { field: "itemId", input: "itemId" },
            },
            values: {},
        };
        __actionsTestState.setFlows([anyRoot]);
        await fire("whatever");
        expect(emitted.some((e) => e.trigger === "flow-start" && e.output?.triggerBlockId === "flow_any")).toBe(true);
    });

    it("a scalar payload can be filtered through $", async () => {
        const modelRoot: CanvasBlock = {
            ...rootWith("a", "qwen3:8b"),
            action: {
                id: "item-ready",
                name: "When Model Downloaded",
                inputs: { model: { type: "string", label: "Model", allowEmpty: true } },
                match: { field: "$", input: "model" },
            },
            values: { model: "qwen3:8b" },
        };
        __actionsTestState.setFlows([modelRoot]);

        emitted.length = 0;
        handleTriggerEventForTest("qwen3:8b", { panelId: "dev.example", trigger: "item-ready" });
        await Bun.sleep(20);
        expect(emitted.some((e) => e.trigger === "flow-start")).toBe(true);

        emitted.length = 0;
        handleTriggerEventForTest("llama3:8b", { panelId: "dev.example", trigger: "item-ready" });
        await Bun.sleep(20);
        expect(emitted.some((e) => e.trigger === "flow-start")).toBe(false);
    });
});

describe("sync-flows validation for event actions", () => {
    const syncFlows = serviceActions.find((a: any) => a.id === "sync-flows") as any;
    const ctx = { emitTrigger: () => {}, setState: () => {} } as any;

    const root = (overrides: Partial<CanvasBlock> = {}): CanvasBlock => ({
        id: "flow_sync",
        panelId: "dev.example",
        pos: { x: 0, y: 0 },
        isTrigger: true,
        action: {
            id: "item-ready",
            name: "When Item Ready",
            match: { field: "itemId", input: "itemId" },
        },
        values: { itemId: "item-a" },
        children: [],
        ...overrides,
    });

    it("refuses an event-only action nested inside a flow", async () => {
        const bad = root({
            children: [
                {
                    id: "badnest",
                    panelId: "dev.panel",
                    pos: { x: 0, y: 0 },
                    isTrigger: false,
                    action: { id: "on-message", name: "On Message", eventOnly: true },
                    values: {},
                },
            ],
        });
        let caught: unknown = null;
        try {
            await syncFlows.run(ctx, { flows: [bad] });
        } catch (err) {
            caught = err;
        }
        expect((caught as Error)?.message).toContain("cannot be nested");
    });

    it("refuses a parameterized trigger whose match input is empty and not clearable", async () => {
        let caught: unknown = null;
        try {
            await syncFlows.run(ctx, { flows: [root({ values: {} })] });
        } catch (err) {
            caught = err;
        }
        expect((caught as Error)?.message).toContain("would never fire");
    });

    it("accepts an empty match input the schema declares clearable: (any)", async () => {
        const clearable = root({
            action: {
                id: "item-ready",
                name: "When Item Ready",
                inputs: { itemId: { type: "string", label: "Item", allowEmpty: true } },
                match: { field: "itemId", input: "itemId" },
            },
            values: {},
        });
        const result = await syncFlows.run(ctx, { flows: [clearable] });
        expect(result.flows).toBe(1);
    });

    it("refuses a variable chip as a match value: routing must be a literal", async () => {
        let caught: unknown = null;
        try {
            await syncFlows.run(ctx, {
                flows: [root({ values: { itemId: "{{someVar:Var:bolt}}" } })],
            });
        } catch (err) {
            caught = err;
        }
        expect((caught as Error)?.message).toContain("must be a literal value");
    });

    it("accepts a well-formed parameterized root", async () => {
        const result = await syncFlows.run(ctx, { flows: [root()] });
        expect(result.flows).toBe(1);
    });

    afterAll(() => {
        __actionsTestState.setFlows([]);
    });
});
