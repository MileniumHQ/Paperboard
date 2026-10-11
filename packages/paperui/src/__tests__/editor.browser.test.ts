// Real-browser contract for PaperEditor and PaperFileBrowser (headless
// Chrome): see fixtures/editorFixture.tsx for why jsdom cannot check these.
// Skipped with a visible reason when Chrome is unavailable.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

interface Alignment {
    rows: number;
    textareaFitsHeight: boolean;
    textareaFitsWidth: boolean;
    longLineWidth: number;
    textareaWidth: number;
    longLineHeight: number;
    lineHeight: number;
    numberAfterLongTop: number;
    lineAfterLongTop: number;
    highlightedKeys: number;
    textareaColor: string;
}

describe("PaperEditor and PaperFileBrowser in a real browser", () => {
    browserTest(
        chrome ? "icons, overlay alignment, native undo and tree focus (headless Chrome)" : "editor contract (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const { checks, error } = await runFixture(chrome, "src/__tests__/fixtures/editorFixture.html");
            expect(error, "the fixture threw").toBe("");
            expect(checks.stage, "the fixture did not finish").toBe("done");

            // every icon the browser uses is a real ligature; the made-up
            // name proves the measurement can tell the difference
            const widths = checks.iconWidthsInEm as Record<string, number>;
            const control = checks.iconControl as string;
            expect(widths[control], "a missing ligature should spell out wide").toBeGreaterThan(3);
            const missing = Object.entries(widths).filter(([name, w]) => name !== control && w > 1.6);
            expect(missing, "icons that do not exist in Material Symbols Rounded").toEqual([]);

            for (const mode of ["nowrap", "wrap"] as const) {
                const a = checks[mode] as Alignment;
                expect(a.rows, `${mode}: one row per line`).toBe(6);
                expect(a.textareaFitsHeight, `${mode}: textarea taller than the rows`).toBe(true);
                expect(a.textareaFitsWidth, `${mode}: textarea wider than the rows`).toBe(true);
                expect(a.numberAfterLongTop, `${mode}: line number drifted from its line`).toBe(a.lineAfterLongTop);
                expect(a.highlightedKeys, `${mode}: YAML keys were not highlighted`).toBeGreaterThan(0);
                expect(a.textareaColor, `${mode}: textarea text should be invisible over highlighting`).toBe("rgba(0, 0, 0, 0)");
            }
            const nowrap = checks.nowrap as Alignment;
            expect(Math.abs(nowrap.longLineWidth - nowrap.textareaWidth), "row and textarea widths differ").toBeLessThanOrEqual(1);
            const wrap = checks.wrap as Alignment;
            expect(wrap.longLineHeight, "the long line should wrap onto several rows").toBeGreaterThan(wrap.lineHeight * 2);

            const short = checks.short as { rowHeights: number[]; lineHeight: number; textareaHeight: number };
            expect(short.rowHeights, "a short file's rows stretched to fill the editor").toEqual([short.lineHeight, short.lineHeight]);
            expect(short.textareaHeight, "the textarea should fill a tall editor").toBeGreaterThan(300);

            expect(checks.tabPrevented).toBe(true);
            expect(checks.afterTabStart).toBe("  # ");
            expect(checks.undoRestored, "Tab's indent was not undoable").toBe(true);
            expect(checks.enterInserted).toBe(JSON.stringify("\n  "));

            expect(checks.childShown, "ArrowRight did not open the folder").toBe(true);
            expect(checks.focusKept, "expanding a folder dropped keyboard focus").toBe(true);
        },
        90_000,
    );
});
