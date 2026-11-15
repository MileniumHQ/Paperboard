// OpenCode's providers page in a real browser (fixtures/providersFixture.tsx):
// a sign-in's late answer never ends the sign-in that replaced it, and the
// list read again keeps the provider's forms the ones they were, and a
// sign-in that won't stop is told before the modal closes.
import { describe, expect, test } from "bun:test";
import { runBrowserFixture } from "./browserFixture";

describe("a provider's sign-in", () => {
    test(
        "canceled and started again: the first one's late failure doesn't end the new one; a key connected keeps the forms; closing over one that won't stop says so",
        async () => {
            const { checks, error } = await runBrowserFixture("test/fixtures/providersFixture.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
            expect(error, "the fixture threw").toBe("");
            expect(checks.refused, "the old sign-in's error was shown").toBe(false);
            expect(checks.stillSigningIn, "the new sign-in was ended").toBe(true);
            expect(checks.formsKept, "the list read again rebuilt the provider's forms").toBe(true);
            expect(checks.openAfterRefusal, "the modal closed over a sign-in that wasn't stopped").toBe(true);
            expect(checks.staleRefusal, "an old refusal greets the modal opened again").toBe(false);
            expect(checks.uncaught).toEqual([]);
        },
        180_000,
    );
});
