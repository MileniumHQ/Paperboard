// The wrapping multiline editor field is opt-in per input via the schema's
// `multiline` flag, and the builtin Text action is its one user. If another
// action starts declaring it, this fails so the UI decision is deliberate.
import { describe, expect, test } from "bun:test";
import { mergeActionSchemas, type CanvasBlock } from "../src/lib/tree";
import { BUILTIN_DEFS, BUILTIN_SCHEMA_ENTRIES } from "../src/lib/builtinRegistry";

describe("multiline action inputs", () => {
    test("only the builtin Text action declares a multiline field", () => {
        const multilineActions: string[] = [];
        for (const def of BUILTIN_DEFS) {
            const inputs = def.item.schema?.inputs ?? {};
            if (Object.values(inputs).some((input) => input.multiline)) {
                multilineActions.push(def.id);
            }
        }
        expect(multilineActions).toEqual(["text"]);
    });

    test("a stored Text block picks the multiline schema up on load", () => {
        // flows saved while the multiline field was missing keep a stale
        // schema; the load-time merge must refresh it
        const stored: CanvasBlock = {
            id: "b1",
            panelId: "builtin.logic",
            pos: { x: 0, y: 0 },
            isTrigger: false,
            values: { value: "one\ntwo" },
            action: {
                id: "text",
                name: "Text",
                description: "Text value",
                template: "Text {value}",
                inputs: {
                    value: { type: "string", label: "Value", required: true },
                },
            } as any,
        };
        const [merged] = mergeActionSchemas([stored], BUILTIN_SCHEMA_ENTRIES);
        expect(merged.action.inputs?.value.multiline).toBe(true);
        expect(merged.values).toEqual({ value: "one\ntwo" });
    });
});
