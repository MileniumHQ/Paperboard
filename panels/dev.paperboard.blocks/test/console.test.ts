// The run log's scrolling and layout (real browser; skipped with a visible reason without Chrome).
import { expect, test } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";
import { browserTest, panelFixture } from "./helpers/panelFixture";

const chrome = findChrome();
if (!chrome && process.env.CI) throw new Error("CI has no Chrome, so the console tests can't run: install it or set PAPERBOARD_CHROME");

(chrome ? test : test.skip)(
    chrome ? "the console follows new lines only while its reader is at the end (headless Chrome)" : "the console follows new lines only while its reader is at the end (skipped: no Chrome)",
    async () => {
        const { checks, error } = await runBrowserFixture(chrome!, "test/fixtures/consoleFixture.html", {});
        expect(error, "the fixture threw").toBe("");
        expect(checks.startsAtEnd).toBeLessThanOrEqual(1);
        expect(checks.followedAtEnd).toBeLessThanOrEqual(1);
        // lines arrived while the reader was at the top, who stayed there
        expect(checks.stayedWhileReading).toBe(0);
        expect(checks.followedAgain).toBeLessThanOrEqual(1);
        // a wrapped entry has its time on its first line
        expect(checks.textLines).toBeGreaterThan(1);
        expect(checks.timeTopMinusTextTop).toBeLessThanOrEqual(1);
    },
    120_000,
);

// The same, in the editor, over announcements as the daemon delivers them:
// each one a new list of new objects (test/helpers/panelFixture.ts).
(chrome ? test : test.skip)(
    browserTest("in the editor, a log line the service announces adds one row, and the rows and selection already there stay"),
    async () => {
        const { console: log } = await panelFixture();
        expect(log.rows).toBe(31);
        expect(log.newRowText).toBe("one more");
        // the 30 rows shown before are the same elements, not rebuilt
        expect(log.rowsKept).toBe(30);
        // what the reader had selected is still selected, in the page
        expect(log.selection).toBe("line 3");
        expect(log.selectionInPage).toBe(true);
        expect(log.followedAtEnd).toBeLessThanOrEqual(1);
        expect(log.stayedWhileReading).toBe(0);
        expect(log.followedAgain).toBeLessThanOrEqual(1);
    },
    180_000,
);
