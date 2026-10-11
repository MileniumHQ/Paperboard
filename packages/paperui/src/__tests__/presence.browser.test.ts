// Real-browser contract for PaperPresence (headless Chrome): an element
// animates in, stays mounted while it animates out, and leaves at once when
// motion is reduced. jsdom runs no CSS animations, so it can't see any of it.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. When it is
// unavailable the test is skipped with a visible reason rather than passing
// silently.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("PaperPresence in a real browser", () => {
    browserTest(
        chrome
            ? "animates in, waits for its exit animation, and skips it under reduced motion (headless Chrome)"
            : "animates in, waits for its exit animation, and skips it under reduced motion (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const { error, checks } = await runFixture(chrome, "src/__tests__/fixtures/presenceFixture.html");
            expect(error, "the fixture threw").toBe("");
            expect(checks.enterAnimation, "the preset's keyframes did not apply").toMatch(/SlideEnd/);
            expect(checks.enterClassesGone, "enter classes outlived the animation").toBe(true);
            expect(checks.mountedWhileLeaving, "the element left before animating out").toBe(true);
            expect(checks.exitDirection, "exit does not replay the preset in reverse").toBe("reverse");
            expect(checks.goneAfterLeaving, "the element stayed after its exit animation").toBe(true);
            expect(checks.reducedGoneAtOnce, "reduced motion still waited on an animation").toBe(true);
        },
        60_000,
    );
});
