// Real-browser contract for the modal's focus outline (headless Chrome).
//
// Opening a PaperModal focuses the dialog container. Chrome matches
// :focus-visible on that container and paints `outline: auto 1px`; the colour
// is the system accent, which is orange on Ubuntu, so the whole modal got a
// strange orange ring. jsdom cannot catch this: it does not apply the bundled
// CSS, so getComputedStyle there never reflects the fix.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. When it is
// unavailable the test is skipped with a visible reason rather than passing
// silently.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("modal focus styling in a real browser", () => {
    browserTest(
        chrome
            ? "the focused dialog container paints no focus outline (headless Chrome)"
            : "the focused dialog container paints no focus outline (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runFixture(
                chrome,
                "src/__tests__/fixtures/modalFixture.html",
            );
            expect(results.error, "the fixture threw").toBe("");
            const checks = results.checks;

            expect(checks.dialogPresent, "the modal did not open").toBe(true);
            expect(
                checks.focusedOnDialog,
                "focus was not trapped on the dialog container",
            ).toBe(true);
            // outline-style is the painted fact; outline-width still computes
            // to `medium` because `outline: none` only zeroes the style.
            expect(
                checks.outlineStyle,
                "the dialog container painted a UA focus ring",
            ).toBe("none");
        },
        60_000,
    );
});
