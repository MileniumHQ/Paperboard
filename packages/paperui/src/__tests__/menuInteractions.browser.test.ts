// Real-browser contract for menu presses (headless Chrome).
//
// PaperUI's menu failures live in the gap jsdom leaves: jsdom dispatches a
// click on a display:none element, so a suite can pass while a real option
// click dies when the press already dismissed the popup. This test bundles
// the real components into a fixture, serves it, and lets Chrome run the
// press/release/click sequence through its own hit testing.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. When it is
// unavailable the test is skipped with a visible reason rather than passing
// silently.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("menu presses in a real browser", () => {
    browserTest(
        chrome
            ? "a press on a select option or context menu item survives to its click (headless Chrome)"
            : "a press on a select option or context menu item survives to its click (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runFixture(
                chrome,
                "src/__tests__/fixtures/menuFixture.html",
            );
            expect(results.error, "the fixture threw").toBe("");
            const checks = results.checks;

            expect(checks.selectOpened, "the trigger click did not open the listbox").toBe(true);
            expect(
                checks.popupOpenAfterOptionPress,
                "the press on the option dismissed the popup before its click",
            ).toBe(true);
            expect(checks.selectCommitted, "the option click did not commit").toBe("beta");
            expect(checks.triggerLabel, "the trigger did not show the chosen option").toContain("Beta");
            expect(checks.selectClosedAfterOption, "the popup stayed open after committing").toBe(true);

            expect(checks.contextMenuOpened, "right click did not open the context menu").toBe(true);
            expect(checks.contextItemClicks, "the context menu item click did not run").toBe(1);
            expect(checks.contextMenuClosedAfterItem, "the context menu stayed open after its item click").toBe(true);

            // vertical PaperRange owns a real height; a caller's auto-height
            // container must not collapse it (the empty volume box)
            expect(checks.autoRangeTrackHeight, "a vertical range collapsed in an auto-height box").toBeGreaterThan(0);
            expect(checks.volumeTrackHeight, "the PaperAudio volume slider rendered empty").toBeGreaterThan(0);
        },
        60_000,
    );
});
