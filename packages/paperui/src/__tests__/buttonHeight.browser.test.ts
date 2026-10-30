// Real-browser contract for button heights (headless Chrome): a button with an
// icon is exactly as tall as a text-only button of its size. jsdom loads no
// fonts and does no layout, so this runs in Chrome; without Chrome the test is
// skipped with a visible reason rather than passing silently.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("button heights in a real browser", () => {
    browserTest(
        chrome
            ? "an icon beside a label, or alone, keeps a button as tall as a text-only one (headless Chrome)"
            : "an icon keeps a button as tall as a text-only one (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const { checks, error } = await runFixture(chrome, "src/__tests__/fixtures/buttonHeightFixture.html");
            expect(error, "the fixture threw").toBe("");
            for (const size of ["tiny", "small", "medium", "large"]) {
                const [text, ...withIcons] = checks[size] as number[];
                expect(text, `${size} text button has no height`).toBeGreaterThan(0);
                expect(withIcons, `${size} buttons with an icon are not as tall as the text button`).toEqual([text, text, text]);
            }
            expect(checks.glyphCentred, "the icon glyph is off the label's centre line").toBe(true);
        },
        60_000,
    );
});
