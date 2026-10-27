// The panel as a person meets it (real browser): the real Main on real
// PaperUI over a fake Agents service. It proves settings stand and say why
// when the brains can't be looked for.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("panel behavior", () => {
    behaviorTest(
        chrome
            ? "settings without the brains (headless Chrome)"
            : "settings without the brains (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/panelBehaviorFixture.html", {
                "@mileniumhq/paperapi": "test/fixtures/agentsApi.ts",
            });
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;

            expect(c.uncaught, "nothing may fail out of sight").toEqual([]);
            expect(c.settingsShown, "settings must show while the brains can't be looked for").toBe(true);
            expect(c.detectFailureShown, "a failed look for the brains must say why").toBe(true);
        },
        90_000,
    );
});
