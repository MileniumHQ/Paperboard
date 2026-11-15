// The editor's layout with log lines shown (headless Chrome, the whole panel:
// test/fixtures/panelFixture.tsx): the console over the canvas, and the
// Library beside it in the narrowest Paperboard window.
import { expect, test } from "bun:test";
import { panelFixture } from "./helpers/panelFixture";

test(
    "the console is opaque and stays off the Library, and the narrowest window leaves the canvas as much room as the Library",
    async () => {
        const { layout } = await panelFixture();
        // the blocks under the console never show through its lines
        expect(layout.alpha).toBe(1);
        expect(layout.backdrop).toBe("none");
        for (const size of [layout.wide, layout.narrow, layout.back]) {
            expect(size.consoleOverLibrary).toBeLessThanOrEqual(0);
            expect(size.consoleOutside).toBeLessThanOrEqual(0);
        }
        // a wide window keeps the Library at its own width; the narrowest halves the canvas with it
        expect(layout.back).toEqual(layout.wide);
        expect(layout.narrow.libraryWidth).toBeLessThan(layout.wide.libraryWidth);
        expect(layout.narrow.canvasRoom).toBeGreaterThanOrEqual(layout.narrow.libraryWidth);
    },
    180_000,
);
