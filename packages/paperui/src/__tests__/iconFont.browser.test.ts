// Real-browser contract for the icon font gate (headless Chrome): a fresh
// document never paints its icons before the icon font loads, and shows once
// it has. jsdom loads no fonts, so this runs in Chrome; without Chrome the
// test is skipped with a visible reason rather than passing silently.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("icon font on a fresh document in a real browser", () => {
    browserTest(
        chrome
            ? "PaperProvider holds its first paint until the icon font is ready (headless Chrome)"
            : "PaperProvider holds its first paint until the icon font is ready (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const { checks, error } = await runFixture(chrome, "src/__tests__/fixtures/iconFontFixture.html");
            expect(error, "the fixture threw").toBe("");
            expect(checks.loadedBeforeRender, "the font was loaded before the provider rendered, so nothing was tested").toBe(false);
            expect(checks.blankFrames, "frames painted with the icon font still loading").toEqual([]);
            expect(checks.shown, "the provider never showed").toBe(true);
        },
        60_000,
    );
});
