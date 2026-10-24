// Flows saved before 0.3 may hold Get Variable or Defer Interaction, which
// 0.3 removed: loading them replaces each with what its output meant, so the
// flow still runs instead of failing on an unknown step.
import { describe, expect, test } from "bun:test";
import { withoutRemovedSteps } from "../src/lib/removedSteps";
import type { CanvasBlock } from "../src/lib/tree";

function block(id: string, panelId: string, action: string, values: Record<string, any> = {}, children?: CanvasBlock[]): CanvasBlock {
    return { id, panelId, pos: { x: 0, y: 0 }, isTrigger: false, action: { id: action, name: action } as any, values, ...(children ? { children } : {}) };
}
const getVariable = (id: string, key: string) => block(id, "builtin.logic", "get-variable", { key });
const defer = (id: string) => block(id, "dev.paperboard.botcreator", "defer-interaction");
const text = (id: string, value: string) => block(id, "builtin.text", "text", { value });

describe("removed steps", () => {
    test("Get Variable becomes the variable chip in every input that read it", () => {
        const flows = [block("t", "builtin.logic", "trigger", {}, [
            getVariable("g1", "score"),
            text("s1", "you have {{g1:Value:data_object}} points"),
        ])];
        const out = withoutRemovedSteps(flows);
        expect(out).toMatchObject({ removed: 1, kept: 0 });
        expect(out.flows[0].children!.map((b) => b.id)).toEqual(["s1"]);
        expect(out.flows[0].children![0].values.value).toBe("you have {{score:score:data_object}} points");
    });

    test("Defer Interaction goes, and its Success output reads true", () => {
        const out = withoutRemovedSteps([block("t", "x", "trigger", {}, [defer("d1"), text("s1", "{{d1:Success:check}}")])]);
        expect(out.removed).toBe(1);
        expect(out.flows[0].children!.map((b) => b.id)).toEqual(["s1"]);
        expect(out.flows[0].children![0].values.value).toBe("true");
    });

    test("a Get Variable whose name is a reference stays, counted", () => {
        const flows = [getVariable("g1", "{{s0:Result:chat}}")];
        const out = withoutRemovedSteps(flows);
        expect(out).toEqual({ flows, removed: 0, kept: 1 });
    });

    test("steps nested under a removed step stay, in its place", () => {
        const nested = { ...defer("d1"), children: [text("inner", "x")] };
        const out = withoutRemovedSteps([block("t", "x", "trigger", {}, [nested, text("after", "y")])]);
        expect(out.flows[0].children!.map((b) => b.id)).toEqual(["inner", "after"]);
    });

    test("flows with nothing removed come back as they were", () => {
        const flows = [text("s1", "{{other:Result:chat}}")];
        expect(withoutRemovedSteps(flows)).toEqual({ flows, removed: 0, kept: 0 });
    });
});
