// Real-browser contract for the labelled PaperInput (headless Chrome).
//
// The label sits in a notch of the top border, and focus turns the border and
// label primary. jsdom does no layout and does not apply the bundled CSS, so
// this runs in Chrome. When Chrome is unavailable the test is skipped with a
// visible reason rather than passing silently.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("labelled input in a real browser", () => {
    browserTest(
        chrome
            ? "the label sits in the top border's notch and focus colours it (headless Chrome)"
            : "the label sits in the top border's notch and focus colours it (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const { checks, error } = await runFixture(chrome, "src/__tests__/fixtures/inputLabelFixture.html");
            expect(error, "the fixture threw").toBe("");
            expect(checks.labelText).toBe("Access key");
            expect(checks.labelFor, "the label is not tied to the input").toBe(true);
            expect(checks.labelVisible, "the label is not painted").toBe(true);
            expect(checks.labelStraddlesBorder, "the label is not on the top border").toBe(true);
            expect(checks.labelInsideNotch, "the border runs through the label").toBe(true);
            expect(checks.borderAtInputTop, "the border is not at the input's top edge").toBe(true);
            expect(checks.focusBorderIsPrimary, "focus did not colour the border").toBe(true);
            expect(checks.focusLabelIsPrimary, "focus did not colour the label").toBe(true);
        },
        60_000,
    );
});
