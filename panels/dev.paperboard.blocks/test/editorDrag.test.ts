// Dragging and copying blocks in the editor (real browser).
//
// The editor is bundled with Vite and mounted in headless Chrome over the
// real service on a real daemon, with another panel offering its blocks
// (test/browserFixture.ts); the fixture drags
// blocks out of the Library with pointer events and reports what the canvas
// held and what the editor saved. Only a browser can prove this: Blockly
// draws a preview of the block where it would snap on, and a renderer that
// can't draw the preview fails in the middle of the drag, leaving a block on
// the canvas for every move of the pointer.
import { describe, expect, test } from "bun:test";
import { BUILTIN } from "../src/lib/names";
import { runHat, type SavedBlock } from "../src/lib/interpreter";
import { browserFixture } from "./browserFixture";

const fixture = async () => {
    const { checks, error } = await browserFixture("editor");
    expect(error, "the fixture threw").toBe("");
    return checks;
};

const TIMEOUT = 180_000;

describe("dragging blocks in the editor", () => {
    // the canvas changes size part way: laid out again under a block being dragged, Blockly
    // scrolls to where the block was picked up, and the block leaves the pointer
    test(
        "a panel's block snaps into a built-in one",
        async () => {
            const { third, afterThird, greet } = await fixture();
            expect(third.previews).toHaveLength(1);
            expect(third.previews[0].drawn).toBe(true);
            expect(afterThird.alert).toBe("");
            expect(afterThird.saved).toHaveLength(1);
            expect(afterThird.saved[0].inputs.DO.block.inputs.DO0.block.type).toBe(greet);
        },
        TIMEOUT,
    );

});

describe("copying blocks in the editor", () => {
    test(
        "a flow duplicated from its menu reads what its own command gave back, not the original's",
        async () => {
            const { duplicated } = await fixture();
            // the copy: a "When Run is clicked" that starts with Count, other than the original
            const hats = (duplicated.saved as SavedBlock[]).filter((b) => b.type === BUILTIN.onRun && b.id !== duplicated.originalHat && b.inputs?.DO?.block?.type.endsWith("|command.count"));
            expect(hats).toHaveLength(1);
            const logs: string[] = [];
            const host = {
                signal: new AbortController().signal,
                run: async () => 7,
                read: async () => null,
                property: async () => null,
                log: (message: string) => void logs.push(message),
            };
            await runHat(hats[0]!, null, { blocks: { languageVersion: 0, blocks: duplicated.saved } }, host);
            expect(logs).toEqual(["7"]);
        },
        TIMEOUT,
    );
});
