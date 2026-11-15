// OpenCode's providers page in a real browser (fixtures/providersFixture.tsx):
// a sign-in's late answer never ends the sign-in that replaced it, and the
// list read again keeps the provider's forms the ones they were.
import { describe, expect, test } from "bun:test";
import { runBrowserFixture } from "./browserFixture";

describe("a provider's sign-in", () => {
    test(
        "canceled and started again: the first one's late failure doesn't end the new one; a key connected keeps the forms",
        async () => {
            const { checks, error } = await runBrowserFixture("test/fixtures/providersFixture.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
            expect(error, "the fixture threw").toBe("");
            expect(checks.refused, "the old sign-in's error was shown").toBe(false);
            expect(checks.stillSigningIn, "the new sign-in was ended").toBe(true);
            expect(checks.formsKept, "the list read again rebuilt the provider's forms").toBe(true);
            expect(checks.uncaught).toEqual([]);
        },
        180_000,
    );
});
