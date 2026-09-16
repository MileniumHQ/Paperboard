// Repeat-based loop control (break/continue) and Wait Until semantics on
// the real executor.
import { describe, expect, it } from "bun:test";
import { executeFlow } from "../src/lib/runtime";
import { BUILTIN_CATEGORIES } from "../src/lib/builtins";

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
) => ({
    id: `b${++n}_${actionId}`,
    panelId: "builtin.logic",
    pos: { x: 0, y: 0 },
    isTrigger: false,
    action: schemaFor(actionId),
    values,
    ...(children ? { children } : {}),
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

describe("repeat with break and continue", () => {
    it("runs the body the requested number of times", async () => {
        const log = await run([
            blk("repeat", { count: 3 }, [blk("increment-variable", { key: "loop-n" })]),
            blk("get-variable", { key: "loop-n" }),
        ]);
        expect(log.status).toBe("success");
        expect(finalResult(log)).toBe(3);
    });

    it("break ends the loop early", async () => {
        const log = await run([
            blk("repeat", { count: 5 }, [
                blk("increment-variable", { key: "loop-break" }),
                blk("break"),
            ]),
            blk("get-variable", { key: "loop-break" }),
        ]);
        expect(log.status).toBe("success");
        expect(finalResult(log)).toBe(1);
    });

    it("continue skips the rest of the iteration only", async () => {
        const log = await run([
            blk("repeat", { count: 2 }, [
                blk("increment-variable", { key: "loop-continue" }),
                blk("continue"),
                blk("increment-variable", { key: "loop-continue" }),
            ]),
            blk("get-variable", { key: "loop-continue" }),
        ]);
        expect(log.status).toBe("success");
        expect(finalResult(log)).toBe(2);
    });

    it("a break outside any loop fails with a readable message", async () => {
        const log = await run([blk("break")]);
        expect(log.status).toBe("error");
        expect(log.message).toMatch(/Break outside a loop/);
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
