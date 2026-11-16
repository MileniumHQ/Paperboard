// The editor's layout with log lines and a notice shown (headless Chrome,
// the whole panel: test/fixtures/panelFixture.tsx): the console and the
// notice in a dock under the canvas, and the Library beside it, collapsed on
// its own in the narrowest Paperboard window unless the person chose.
import { expect, test } from "bun:test";
import { panelFixture } from "./helpers/panelFixture";

test(
    "the console and notices never cover the canvas, and the narrowest window gives the canvas the panel's width unless the person opens the Library",
    async () => {
        const { layout } = await panelFixture();
        // the blocks under the console never show through its lines
        expect(layout.alpha).toBe(1);
        expect(layout.backdrop).toBe("none");
        for (const size of [layout.wide, layout.narrow, layout.narrowOpened, layout.back, layout.collapsedNarrow, layout.collapsedWide, layout.reopened]) {
            // the dock is under the canvas, in the panel, and the canvas keeps the larger share of the height
            expect(size.dockOverCanvas).toBe(0);
            expect(size.dockOutside).toBe(0);
            expect(size.canvasHeight).toBeGreaterThanOrEqual(size.dockHeight);
        }
        // a wide window shows the Library at its own width, and leaves the canvas more room than it takes
        expect(layout.wide.libraryShown).toBe(true);
        expect(layout.wide.canvasRoom).toBeGreaterThan(layout.wide.libraryWidth);
        expect(layout.reopened.libraryWidth).toBe(layout.wide.libraryWidth);
        // the narrowest collapses it on its own: the canvas has the panel's whole width
        expect(layout.narrow.libraryShown).toBe(false);
        expect(layout.narrow.canvasRoom).toBe(layout.narrow.panelWidth);
        // opened there by the person, it stays open, its list no wider than the canvas beside it, and stays open as the window widens
        expect(layout.narrowOpened.libraryShown).toBe(true);
        expect(layout.narrowOpened.canvasRoom).toBeGreaterThanOrEqual(layout.narrowOpened.listWidth);
        expect(layout.back).toEqual(layout.wide);
        // collapsed by the person, it stays collapsed in any window
        expect(layout.collapsedNarrow.libraryShown).toBe(false);
        expect(layout.collapsedWide.libraryShown).toBe(false);
    },
    180_000,
);
