// Importing flows onto a canvas: one Undo takes the whole import back, and
// never leaves blocks behind with the variables they used taken away.
import { describe, expect, test } from "bun:test";
import * as Blockly from "blockly";
import { appendWorkspace } from "../src/lib/appendWorkspace";
import { saved } from "./helpers/workspace";

// Blockly fires its events (and fills the undo stack) after the current task
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const imported = () =>
    saved(
        [
            {
                type: "variables_set",
                id: "set",
                x: 0,
                y: 0,
                fields: { VAR: { id: "v-a" } },
                inputs: { VALUE: { block: { type: "text", id: "t", fields: { TEXT: "hi" } } } },
                next: { block: { type: "text_print", id: "print", inputs: { TEXT: { block: { type: "variables_get", id: "get", fields: { VAR: { id: "v-a" } } } } } } },
            },
        ],
        [{ name: "a", id: "v-a" }],
    );

describe("an import", () => {
    test("is undone whole by one Undo", async () => {
        const ws = new Blockly.Workspace();
        try {
            ws.getVariableMap().createVariable("kept", "", "v-kept");
            const before = ws.getAllBlocks(false).length;
            await settle();
            ws.clearUndo();

            appendWorkspace(ws, imported(), 100);
            await settle();
            expect(ws.getAllBlocks(false).map((b) => b.id).sort()).toEqual(["get", "print", "set", "t"]);
            expect(ws.getBlockById("set")!.getRelativeToSurfaceXY().y).toBe(100);

            ws.undo(false);
            await settle();
            expect(ws.getAllBlocks(false)).toHaveLength(before);
            expect(ws.getVariableMap().getAllVariables().map((v) => v.getId())).toEqual(["v-kept"]);

            // and Redo brings it all back, the variable's blocks still using it
            ws.undo(true);
            await settle();
            expect((ws.getBlockById("get")!.getField("VAR") as Blockly.FieldVariable).getVariable()!.getId()).toBe("v-a");
        } finally {
            ws.dispose();
        }
    });

    test("uses a variable the canvas has already, by id or by name, instead of a second one", async () => {
        const ws = new Blockly.Workspace();
        try {
            ws.getVariableMap().createVariable("a", "", "v-a");
            appendWorkspace(ws, imported(), 0);
            await settle();
            expect(ws.getVariableMap().getAllVariables()).toHaveLength(1);
        } finally {
            ws.dispose();
        }
    });
});
