// The run log's scrolling and layout (real browser; skipped with a visible reason without Chrome).
import { expect, test } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

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
