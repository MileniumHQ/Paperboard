// builtin failure semantics (bun test): a missing handler throws (never
// echoes inputs back as "success"), and a broken math expression fails
// the step instead of silently evaluating to 0
import { describe, it, expect } from "bun:test";
import { executeFlow } from "../src/lib/runtime";
import { BUILTIN_CATEGORIES, BUILTIN_DEFS } from "../src/lib/builtins";

const schemaFor = (id: string): any => {
    for (const cat of BUILTIN_CATEGORIES as any[]) {
        for (const item of cat.items || []) {
            if (item.action === id || item.trigger === id) return item.schema;
        }
    }
    // runtime registry, not the library: hidden-but-runnable builtins
    // (get-variable) still execute for existing flows
    for (const def of BUILTIN_DEFS as any[]) {
        if (def.id === id) return def.item.schema;
    }
    throw new Error(`no schema for ${id}`);
};

let n = 0;
const trig = (children: any[]) => ({
    id: "trig",
    panelId: "builtin.logic",
    pos: { x: 0, y: 0 },
    isTrigger: true,
    action: { id: "chat-message", name: "x", output: { type: "object", label: "Message" } },
    values: {},
    children,
});
const step = (actionId: string, values: Record<string, any> = {}, schema?: any) => ({
    id: `b${++n}_${actionId}`,
    panelId: "builtin.logic",
    pos: { x: 0, y: 0 },
    isTrigger: false,
    action: schema ?? schemaFor(actionId),
    values,
});

describe("builtin failure semantics", () => {
    it("missing builtin handler throws instead of echoing inputs", async () => {
        const log = await executeFlow(
            trig([
                step("bogus-builtin", { foo: "bar" }, {
                    id: "bogus-builtin",
                    name: "Bogus",
                    inputs: {},
                }),
            ]) as any,
            {},
        );
        expect(log.status).toBe("error");
        expect(log.message).toMatch(/Unknown builtin action "bogus-builtin"/);
        // the step errored — inputs were NOT passed through as a result
        expect(log.steps[0].error).toMatch(/Unknown builtin action/);
        expect(log.steps[0].result).toBeUndefined();
    });

    it("broken math expression fails the step instead of returning 0", async () => {
        const log = await executeFlow(
            trig([step("math-calculate", { expression: "2 +" })]) as any,
            {},
        );
        expect(log.status).toBe("error");
        expect(log.message).toMatch(/cannot parse expression/);
    });

    it("blank math expression fails the step (empty input defaults to 0, blank does not)", async () => {
        const log = await executeFlow(
            trig([step("math-calculate", { expression: "   " })]) as any,
            {},
        );
        expect(log.status).toBe("error");
        expect(log.message).toMatch(/expression is empty/);
    });

    it("valid math still evaluates", async () => {
        const log = await executeFlow(
            trig([step("math-calculate", { expression: "2 + 3 * 4" })]) as any,
            {},
        );
        expect(log.status).toBe("success");
        expect(log.steps[0].result).toBe(14);
    });
});
