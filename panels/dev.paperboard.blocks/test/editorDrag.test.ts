// Dragging blocks in the editor (real browser).
//
// The editor is bundled with Vite and mounted in headless Chrome over an SDK
// with no daemon behind it (fixtures/paperapiStub.ts); the fixture drags
// blocks out of the Library with pointer events and reports what the canvas
// held and what the editor saved. Only a browser can prove this: Blockly
// draws a preview of the block where it would snap on, and a renderer that
// can't draw the preview fails in the middle of the drag, leaving a block on
// the canvas for every move of the pointer.
//
// Without Chrome the suite is skipped with a visible reason; CI must have it.
import { describe, expect, test } from "bun:test";
import { BUILTIN } from "../src/lib/names";
import { findChrome, runBrowserFixture, type FixtureResults } from "./browserFixture";

const chrome = findChrome();
if (!chrome && process.env.CI) throw new Error("CI has no Chrome, so the editor's drag tests can't run: install it or set PAPERBOARD_CHROME");
const dragTest = chrome ? test : test.skip;
const named = (name: string) => (chrome ? `${name} (headless Chrome)` : `${name} (skipped: no Chrome)`);

let results: Promise<FixtureResults> | undefined;
const fixture = async () => {
    results ??= runBrowserFixture(chrome!, "test/fixtures/editorFixture.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
    const { checks, error } = await results;
    expect(error, "the fixture threw").toBe("");
    return checks;
};

/** A dragged block stays under the pointer, to within a pixel or two of rounding. */
const HELD = 2;
const TIMEOUT = 180_000;

describe("dragging blocks in the editor", () => {
    // the canvas changes size part way: laid out again under a block being dragged, Blockly
    // scrolls to where the block was picked up, and the block leaves the pointer
    dragTest(
        named("a block dragged out of the Library stays under the pointer while the canvas changes size, and lands on the canvas"),
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

    dragTest(
        named("a block dragged into another shows its drop preview and snaps in, leaving nothing else behind"),
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

    dragTest(
        named("a panel's block snaps into a built-in one"),
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

    dragTest(
        named("nothing fails unseen: a drag throws nothing, and what nothing catches is said on the page"),
        async () => {
            const { uncaught, alert } = await fixture();
            expect(uncaught).toEqual([]);
            expect(alert).toContain("the fixture's own failure");
        },
        TIMEOUT,
    );
});
