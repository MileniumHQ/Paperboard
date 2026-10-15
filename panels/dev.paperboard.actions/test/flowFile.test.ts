// Flow files: exporting and importing must round-trip, and importing adds
// beside what is there with new ids, its chips and function calls following.
import { describe, test, expect } from "bun:test";
import { addFlowFile, flowFileText, parseFlowFile, revealScroll, REVEAL_MARGIN } from "../src/lib/flowFile";
import { buildCallSchema, buildTriggerSchema, type FunctionDef } from "../src/lib/functions";
import type { CanvasBlock } from "../src/lib/tree";
import type { CanvasDocument } from "../src/lib/canvasDoc";

const fn: FunctionDef = { id: "fn_a", name: "Greet", params: [{ name: "who", type: "string" }] };

function block(partial: Partial<CanvasBlock>): CanvasBlock {
    return { id: "b", panelId: "builtin.logic", pos: { x: 0, y: 0 }, isTrigger: false, action: { id: "act", name: "Act" } as any, values: {}, ...partial };
}

const canvas = (): CanvasDocument => ({
    flows: [
        block({
            id: "t1", isTrigger: true, pos: { x: 10, y: 40 },
            children: [
                block({ id: "s1", values: { text: "hi" } }),
                block({ id: "c1", action: buildCallSchema(fn), values: { who: "{{s1:Result:chat}} and {{player}}" } }),
            ],
        }),
        block({ id: "f1", isTrigger: true, pos: { x: 300, y: 100 }, action: buildTriggerSchema(fn) }),
    ],
    notes: [{ id: "n1", pos: { x: 0, y: 200 }, text: "remember" }],
    functions: [fn],
});

const counter = () => {
    let n = 0;
    return (kind: string) => `${kind}_new${++n}`;
};

describe("flow files", () => {
    test("an exported canvas reads back the same", () => {
        expect(parseFlowFile(flowFileText(canvas()))).toEqual(canvas());
    });

    test("importing adds beside the canvas with new ids and moved references", () => {
        const before = canvas();
        const after = addFlowFile(before, parseFlowFile(flowFileText(canvas())), counter());

        // nothing that was there changed
        expect(after.flows.slice(0, 2)).toEqual(before.flows);
        expect(after.notes.slice(0, 1)).toEqual(before.notes);
        expect(after.functions[0]).toEqual(fn);

        const [t, f] = after.flows.slice(2);
        const added = after.functions[1];
        expect(added.name).toBe("Greet 2");
        expect(added.id).not.toBe(fn.id);
        const [s, c] = t.children!;
        expect(new Set([t.id, s.id, c.id, f.id]).size).toBe(4);
        expect([t.id, s.id, c.id, f.id].some((id) => ["t1", "s1", "c1", "f1"].includes(id))).toBe(false);
        // the chip points at the imported step; a plain variable is untouched
        expect(c.values.who).toBe(`{{${s.id}:Result:chat}} and {{player}}`);
        // the call and the body belong to the imported function, not the old one
        expect(c.action).toEqual(buildCallSchema(added));
        expect(f.action).toEqual(buildTriggerSchema(added));
        // placed below everything already on the canvas (lowest top edge 200)
        expect(t.pos.y).toBe(40 + 200 + 160 - 40);
        expect(after.notes[1].id).not.toBe("n1");
        expect(after.notes[1].pos.y).toBe(200 + 200 + 160 - 40);
    });

    test("an empty canvas takes the file where it was", () => {
        const after = addFlowFile({ flows: [], notes: [], functions: [] }, canvas(), counter());
        expect(after.flows[0].pos).toEqual({ x: 10, y: 40 });
        expect(after.functions[0].name).toBe("Greet");
    });

    test("anything but a flow file is refused with a reason", () => {
        expect(() => parseFlowFile("not json")).toThrow("not JSON");
        expect(() => parseFlowFile(JSON.stringify({ flows: [] }))).toThrow("not a flow file");
        expect(() => parseFlowFile(JSON.stringify({ format: "paperboard.actions.flows", version: 2 }))).toThrow("version 2");
        expect(() => parseFlowFile(JSON.stringify({ format: "paperboard.actions.flows", version: 1, flows: [{ id: "x" }] }))).toThrow("damaged flow");
        expect(() => parseFlowFile(JSON.stringify({ format: "paperboard.actions.flows", version: 1 }))).toThrow("empty");
    });
});

describe("revealing an import", () => {
    test("scrolls its top-left corner clear of the open Library", () => {
        const items = [{ pos: { x: 500, y: 900 } }, { pos: { x: 420, y: 1000 } }];
        expect(revealScroll(items, 300)).toEqual({ left: 420 - 300 - REVEAL_MARGIN, top: 900 - REVEAL_MARGIN });
    });

    test("never asks for a scroll before the canvas's start, and nothing added is no scroll", () => {
        expect(revealScroll([{ pos: { x: 10, y: 5 } }], 300)).toEqual({ left: 0, top: 0 });
        expect(revealScroll([], 300)).toBeNull();
    });
});

test("an import that would sit under the open Library moves right of it, keeping its layout", () => {
    const merged = addFlowFile(canvas(), canvas(), counter(), 340);
    const added = merged.flows.slice(2);
    expect(added.map((b) => b.pos.x)).toEqual([350, 640]);
    expect(merged.notes[1].pos.x).toBe(340);
    // already clear of it: left where the file put it
    expect(addFlowFile(canvas(), canvas(), counter(), 0).flows[2].pos.x).toBe(10);
});
