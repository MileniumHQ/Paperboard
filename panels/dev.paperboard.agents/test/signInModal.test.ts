// Signing in to a brain from settings, as a person meets it (real browser):
// one step at a time, the browser's return caught on this device and sent to
// the brain's computer, a field to paste it into from a web browser, a code
// field only when the brain asks for one, and closing stops the sign-in.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("signing in from settings", () => {
    browserTest(
        chrome ? "one step at a time, from this computer, another one or a web browser (headless Chrome)" : "one step at a time (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/signInFixture.html", {
                "@mileniumhq/paperapi": "test/fixtures/agentsApi.ts",
            });
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;
            expect(c.uncaught, "nothing may fail out of sight").toEqual([]);
            expect(c.startsSignIn, "opening the modal starts the sign-in").toBe(true);
            expect(c.waitsForPage, "it says what it waits for before the page is there").toBe(true);
            expect(c.continueOpensPage, "Continue opens the sign-in page in a new tab").toBe(true);
            expect(c.oneStepAtATime, "waiting isn't shown before the page is opened").toBe(true);
            expect(c.askedShell, "the shell is asked to catch the browser's return").toBe(true);
            expect(c.waitsAfterContinue, "after Continue it only waits").toBe(true);
            expect(c.noPasteFieldWhenCaught, "no paste field while the shell is catching the return").toBe(true);
            expect(c.sentCaughtAddress, "the caught address goes to the brain").toBe(true);
            expect(c.signedInAs, "it ends on who it's signed in as").toBe(true);
            expect(c.doneCloses, "Done closes without stopping anything").toBe(true);
            expect(c.pasteFieldInBrowser, "a web browser gets a field for the address").toBe(true);
            expect(c.noWarningForBrowser, "having no listener in a web browser isn't a failure").toBe(true);
            expect(c.sentPastedAddress, "the pasted address goes to the brain, trimmed").toBe(true);
            expect(c.cancelStops, "closing before it's done stops the sign-in").toBe(true);
            expect(c.inUseSaid, "a port taken on this device is said, with the field").toBe(true);
            expect(c.codeFieldForClaude, "a brain that ends in a code gets a code field and nothing else").toBe(true);
            expect(c.sentCode, "the code goes to the brain").toBe(true);
            expect(c.failureShown, "a failed sign-in is said, with Try again").toBe(true);
        },
        120_000,
    );
});
