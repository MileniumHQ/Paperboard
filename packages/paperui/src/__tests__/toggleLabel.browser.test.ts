// Real-browser contract for a PaperToggle inside a <label> (headless Chrome).
//
// The label forwards a click on the switch to its hidden checkbox, which
// would flip back and report the old value. jsdom skips that activation, so
// this runs in Chrome. When Chrome is unavailable the test is skipped with a
// visible reason rather than passing silently.
import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("PaperToggle in a label in a real browser", () => {
    browserTest(
        chrome
            ? "a tap on the switch changes the setting once, and the label's text still toggles it (headless Chrome)"
            : "a tap on the switch changes the setting once, and the label's text still toggles it (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const { checks, error } = await runFixture(chrome, "src/__tests__/fixtures/toggleLabelFixture.html");
            expect(error, "the fixture threw").toBe("");
            expect(checks.afterSwitch, "the label flipped the switch back").toEqual({ lastHeard: true, heardOld: false, checked: true, ariaChecked: "true" });
            expect(checks.afterLabelText, "the label's text no longer toggles the switch").toEqual({ lastHeard: false, checked: false });
        },
        60_000,
    );
});
