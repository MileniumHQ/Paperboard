// for-each / break / continue / switch semantics on the real executor.
import { describe, expect, it } from "bun:test";
import { executeFlow, MAX_FOREACH_ITERATIONS } from "../src/lib/runtime";
import { BUILTIN_CATEGORIES } from "../src/lib/builtins";
import { SWITCH_CASE_SCHEMA } from "../src/lib/builtin/control";

const schemaFor = (id: string): any => {
    for (const cat of BUILTIN_CATEGORIES as any[]) {
        for (const item of cat.items || []) {
            if (item.action === id || item.trigger === id) return item.schema;
        }
    }
    throw new Error(`no schema for ${id}`);
};

let n = 0;
const blk = (
    actionId: string,
    values: Record<string, any> = {},
    children?: any[],
    elseChildren?: any[],
) => ({
    id: `b${++n}_${actionId}`,
    panelId: "builtin.logic",
    pos: { x: 0, y: 0 },
    isTrigger: false,
    action: schemaFor(actionId),
    values,
    ...(children ? { children } : {}),
    ...(elseChildren ? { elseChildren } : {}),
});

const caseBlk = (value: any, children: any[]) => ({
    id: `case${++n}`,
    panelId: "builtin.logic",
    pos: { x: 0, y: 0 },
    isTrigger: false,
    action: SWITCH_CASE_SCHEMA,
    values: { value },
    children,
});

const trig = (children: any[]) => ({
    id: "trig",
    panelId: "builtin.logic",
    pos: { x: 0, y: 0 },
    isTrigger: true,
    action: { id: "on-play", name: "On Play", output: { type: "any", label: "Out" } },
    values: {},
    children,
});

const run = (children: any[]) => executeFlow(trig(children) as any, {});

// body steps land in the same log, so the last step is the read-back
const finalResult = (log: any) => log.steps.at(-1)?.result;

describe("for-each", () => {
    it("runs the body once per item", async () => {
        const log = await run([
            blk("for-each", { list: ["a", "b", "c"] }, [
                blk("increment-variable", { key: "control-n" }),
            ]),
            blk("get-variable", { key: "control-n" }),
        ]);
        expect(log.status).toBe("success");
        expect(finalResult(log)).toBe(3);
    });

    it("break ends the loop early", async () => {
        const log = await run([
            blk("for-each", { list: ["a", "b", "c"] }, [
                blk("increment-variable", { key: "control-break" }),
                blk("break"),
            ]),
            blk("get-variable", { key: "control-break" }),
        ]);
        expect(log.status).toBe("success");
        expect(finalResult(log)).toBe(1);
    });

    it("continue skips the rest of the iteration only", async () => {
        const log = await run([
            blk("for-each", { list: ["a", "b"] }, [
                blk("increment-variable", { key: "control-continue" }),
                blk("continue"),
                blk("increment-variable", { key: "control-continue" }),
            ]),
            blk("get-variable", { key: "control-continue" }),
        ]);
        expect(log.status).toBe("success");
        expect(finalResult(log)).toBe(2);
    });

    it("caps absurd lists instead of parking the flow", async () => {
        const huge = Array.from({ length: MAX_FOREACH_ITERATIONS + 5 }, () => 1);
        const log = await run([blk("for-each", { list: huge }, [])]);
        expect(log.status).toBe("success");
    });

    it("a break outside any loop fails with a readable message", async () => {
        const log = await run([blk("break")]);
        expect(log.status).toBe("error");
        expect(log.message).toMatch(/Break outside a loop/);
    });
});

describe("switch", () => {
    it("runs the matching case", async () => {
        const log = await run([
            blk(
                "switch",
                { value: "b" },
                [
                    caseBlk("a", [blk("set-variable", { key: "sw", value: "a" })]),
                    caseBlk("b", [blk("set-variable", { key: "sw", value: "b" })]),
                    caseBlk("c", [blk("set-variable", { key: "sw", value: "c" })]),
                ],
                [blk("set-variable", { key: "sw", value: "other" })],
            ),
            blk("get-variable", { key: "sw" }),
        ]);
        expect(log.status).toBe("success");
        expect(finalResult(log)).toBe("b");
    });

    it("falls through to the otherwise branch", async () => {
        const log = await run([
            blk(
                "switch",
                { value: "z" },
                [caseBlk("a", [blk("set-variable", { key: "sw2", value: "a" })])],
                [blk("set-variable", { key: "sw2", value: "other" })],
            ),
            blk("get-variable", { key: "sw2" }),
        ]);
        expect(log.status).toBe("success");
        expect(finalResult(log)).toBe("other");
    });

    it("compares stringly, so numbers and text match", async () => {
        const log = await run([
            blk(
                "switch",
                { value: 2 },
                [caseBlk("2", [blk("set-variable", { key: "sw3", value: "two" })])],
            ),
            blk("get-variable", { key: "sw3" }),
        ]);
        expect(log.status).toBe("success");
        expect(finalResult(log)).toBe("two");
    });

    it("refuses non-case children instead of ignoring them", async () => {
        const log = await run([
            blk("switch", { value: "a" }, [blk("set-variable", { key: "x", value: 1 })]),
        ]);
        expect(log.status).toBe("error");
        expect(log.message).toMatch(/only contain Case/);
    });

    it("a stray case outside a switch fails loudly", async () => {
        const log = await run([caseBlk("a", [])]);
        expect(log.status).toBe("error");
        expect(log.message).toMatch(/only run inside a Switch/);
    });
});

describe("wait-until", () => {
    it("returns as soon as the variable is truthy", async () => {
        const log = await run([
            blk("set-variable", { key: "ready", value: "true" }),
            blk("wait-until", { variable: "ready", timeout: 1 }),
        ]);
        expect(log.status).toBe("success");
        expect(finalResult(log)).toBe(true);
    });

    it("fails loudly on timeout", async () => {
        const log = await run([blk("wait-until", { variable: "never-set", timeout: 0.2 })]);
        expect(log.status).toBe("error");
        expect(log.message).toMatch(/timed out/);
    });
});
