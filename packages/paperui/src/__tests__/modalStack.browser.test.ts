// Real-browser contract for a PaperModal opened over another (headless Chrome):
// the page is dimmed once, and the modal underneath steps back until the one
// over it closes. jsdom computes no styles from the stylesheet, so it can't see it.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. When it is
// unavailable the test is skipped with a visible reason rather than passing
// silently.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("PaperModal over another in a real browser", () => {
    browserTest(
        chrome
            ? "the page is dimmed once and the modal underneath steps back (headless Chrome)"
            : "the page is dimmed once and the modal underneath steps back (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const { error, checks } = await runFixture(chrome, "src/__tests__/fixtures/modalStackFixture.html");
            expect(error, "the fixture threw").toBe("");
            expect(checks.firstDims, "a lone modal dims the page").toBe(true);
            expect(checks.secondAddsNoScrim, "the modal on top dimmed the page a second time").toBe(true);
            expect(checks.firstStillDims, "the page's one scrim went away").toBe(true);
            expect(checks.firstSteppedBack, "the modal underneath still showed or took presses").toBe(true);
            expect(checks.secondShown).toBe(true);
            expect(checks.secondClosed, "Escape closes only the modal on top").toBe(true);
            expect(checks.firstForward, "the modal underneath came back when the one over it closed").toBe(true);
        },
        60_000,
    );
});
