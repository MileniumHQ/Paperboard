// Real-browser contract for PaperLoader (headless Chrome): a loader eases in
// where it appears, ends on its own opacity, and appears at once when motion
// is reduced. jsdom runs no CSS animations, so it can't see any of it.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. When it is
// unavailable the test is skipped with a visible reason rather than passing
// silently.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("PaperLoader in a real browser", () => {
    browserTest(
        chrome
            ? "eases in when it appears, keeps a waiting loader dim, and appears at once under reduced motion (headless Chrome)"
            : "eases in when it appears (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const { error, checks } = await runFixture(chrome, "src/__tests__/fixtures/loaderFixture.html");
            expect(error, "the fixture threw").toBe("");
            expect(checks.delayedEntrance, "a delayed loader popped in with no entrance").toMatch(/loaderEnter/);
            expect(checks.startsHidden, "the entrance does not start from transparent").toBe(true);
            expect(checks.settledOpacity, "the loader did not finish fully visible").toBe("1");
            expect(checks.waitingOpacity, "the entrance overrode a waiting loader's dim").toBe("0.5");
            expect(checks.reducedDuration, "reduced motion still faded the loader in").toBeLessThan(0.001);
        },
        60_000,
    );
});
