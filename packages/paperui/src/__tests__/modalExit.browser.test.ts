// Real-browser contract for a closing PaperModal (headless Chrome): while it
// fades out, a press goes to the page under it, not the leaving backdrop.
// jsdom does no hit testing, so it can't see it.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. When it is
// unavailable the test is skipped with a visible reason rather than passing
// silently.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("PaperModal closing in a real browser", () => {
    browserTest(
        chrome
            ? "a press during the exit fade reaches the page behind (headless Chrome)"
            : "a press during the exit fade reaches the page behind (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const { error, checks } = await runFixture(chrome, "src/__tests__/fixtures/modalExitFixture.html");
            expect(error, "the fixture threw").toBe("");
            expect(checks.openCovers, "an open modal let the press through").toBe(true);
            expect(checks.stillMounted, "the modal left without fading out").toBe(true);
            expect(checks.pressReachesPage, `the leaving backdrop swallowed the press: ${checks.hit}`).toBe(true);
        },
        60_000,
    );
});
