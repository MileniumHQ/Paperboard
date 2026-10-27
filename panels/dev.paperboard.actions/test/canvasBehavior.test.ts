// The canvas as a person meets it (real browser): the real App on real
// PaperUI over a fake Actions service. It proves a canvas that can't load
// says why and can be retried, and that a failed apply is shown with its
// reason and a retry.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("canvas behavior", () => {
    behaviorTest(
        chrome
            ? "loading and sync failures (headless Chrome)"
            : "loading and sync failures (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/canvasBehaviorFixture.html", {
                "@mileniumhq/paperapi": "test/fixtures/canvasSyncApi.ts",
            });
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;

            expect(c.loadFailureTitled, "a canvas that can't load needs a titled alert").toBe(true);
            expect(c.loadFailureReason, "the alert must give the reason on its own").toBe(true);
            expect(c.loadFailureRetry, "a canvas that can't load needs a retry").toBe(true);

            expect(c.syncErrorTitled, "a failed apply needs a titled alert").toBe(true);
            expect(c.syncErrorReason, "the alert must say what failed").toBe(true);
            expect(c.syncErrorRetry, "a failed apply needs a retry").toBe(true);
            expect(c.syncErrorCleared, "a successful retry must clear the alert").toBe(true);
        },
        60_000,
    );
});
