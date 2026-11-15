// OpenCode's providers page in a real browser (fixtures/providersFixture.tsx):
// a sign-in's late answer never ends the sign-in that replaced it, and the
// list read again keeps the provider's forms the ones they were.
//
// Without Chrome the suite is skipped with a visible reason; CI must have it.
import { describe, expect, test } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
if (!chrome && process.env.CI) throw new Error("CI has no Chrome, so the providers page's tests can't run: install it or set PAPERBOARD_CHROME");
const browserTest = chrome ? test : test.skip;
const named = (name: string) => (chrome ? `${name} (headless Chrome)` : `${name} (skipped: no Chrome)`);

describe("a provider's sign-in", () => {
    browserTest(
        named("canceled and started again: the first one's late failure doesn't end the new one; a key connected keeps the forms"),
        async () => {
            const { checks, error } = await runBrowserFixture(chrome!, "test/fixtures/providersFixture.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
            expect(error, "the fixture threw").toBe("");
            expect(checks.refused, "the old sign-in's error was shown").toBe(false);
            expect(checks.stillSigningIn, "the new sign-in was ended").toBe(true);
            expect(checks.formsKept, "the list read again rebuilt the provider's forms").toBe(true);
            expect(checks.uncaught).toEqual([]);
        },
        180_000,
    );
});
