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

/** A dragged block stays under the pointer, to within a pixel or two of rounding. */
const HELD = 2;
const TIMEOUT = 180_000;

describe("dragging blocks in the editor", () => {
    // the canvas changes size part way: laid out again under a block being dragged, Blockly
    // scrolls to where the block was picked up, and the block leaves the pointer
    test(
        "a block dragged out of the Library stays under the pointer while the canvas changes size, and lands on the canvas",
        async () => {
            const { first, afterFirst, fitted } = await fixture();
            expect(Math.abs(first.offBy.x), "the block was not under the pointer").toBeLessThanOrEqual(HELD);
            expect(Math.abs(first.offBy.y), "the block was not under the pointer").toBeLessThanOrEqual(HELD);
            expect(afterFirst.onCanvas).toEqual([BUILTIN.onRun]);
            expect(afterFirst.saved.map((b: { type: string }) => b.type)).toEqual([BUILTIN.onRun]);
            expect(afterFirst.alert).toBe("");
            expect(fitted, "the canvas kept its old size after the drop").toBe(true);
        },
        TIMEOUT,
    );

    test(
        "a block dragged into another shows its drop preview and snaps in, leaving nothing else behind",
        async () => {
            const { second, afterSecond } = await fixture();
            expect(Math.abs(second.offBy.x), "the block was not under the pointer").toBeLessThanOrEqual(HELD);
            expect(Math.abs(second.offBy.y), "the block was not under the pointer").toBeLessThanOrEqual(HELD);
            // one preview, drawn, with the block's own icon: so it is the block's size
            expect(second.previews).toEqual([{ drawn: true, icon: "alt_route" }]);
            expect(afterSecond.alert).toBe("");
            expect(afterSecond.onCanvas).toEqual(["controls_if", BUILTIN.onRun]);
            expect(afterSecond.saved).toHaveLength(1);
            expect(afterSecond.saved[0].type).toBe(BUILTIN.onRun);
            expect(afterSecond.saved[0].inputs.DO.block.type).toBe("controls_if");
        },
        TIMEOUT,
    );

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

    test(
        "nothing fails unseen: a drag throws nothing, and what nothing catches is said on the page",
        async () => {
            const { uncaught, alerts } = await fixture();
            expect(uncaught).toEqual([]);
            // one toast, and the editor's own notice doesn't say it again
            expect(alerts).toHaveLength(1);
            expect(alerts[0].toast).toBe(true);
            expect(alerts[0].text).toContain("the fixture's own failure");
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
