// The chat's request cards in a real browser (fixtures/requestCards.tsx), over
// a stubbed service: each answer is sent once however often it's pressed, a
// typed password or key is gone from the page once the card is answered, and
// an answer that didn't go through says why on its card.
import { describe, expect, test } from "bun:test";
import { runBrowserFixture, type FixtureResults } from "./browserFixture";

const PASSWORD = "correct horse battery staple";
const KEY = "lin_api_secret-key";
const TIMEOUT = 180_000;

let results: Promise<FixtureResults> | undefined;
const fixture = async () => {
    results ??= runBrowserFixture("test/fixtures/requestCards.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
    const { checks, error } = await results;
    expect(error, "the fixture threw").toBe("");
    expect(checks.uncaught).toEqual([]);
    return checks;
};

describe("a request card in the chat", () => {
    test(
        "a sign-in pressed twice is sent once; refused, it says why and the typed password is gone",
        async () => {
            const { signIn } = await fixture();
            expect(signIn.sends, "the sign-in was sent more than once").toBe(1);
            expect(signIn.values).toEqual(["ada@example.com", PASSWORD]);
            expect(signIn.refusal).toContain("Answer not sent");
            expect(signIn.refusal).toContain("The browser window closed");
            expect(signIn.holdsPassword, "the password is still on the page").toBe(false);
        },
        TIMEOUT,
    );

    test(
        "a prompt pressed twice is sent once, and once it's sent the key is nowhere on the page",
        async () => {
            const { prompt } = await fixture();
            expect(prompt.sends, "the prompt was sent more than once").toBe(1);
            expect(prompt.values).toEqual(["acme", KEY]);
            expect(prompt.holdsKey, "the key is still on the page").toBe(false);
        },
        TIMEOUT,
    );

    test(
        "an access request's refused answer says why, and a decline that goes through says so in place of the buttons",
        async () => {
            const { access } = await fixture();
            expect(access.how).toBe("always");
            expect(access.refusal).toContain("Answer not sent");
            expect(access.refusal).toContain("That request isn't waiting anymore.");
            expect(access.afterDecline, "the old refusal is still shown").toBeNull();
            expect(access.answers, "the answer buttons are still shown").toBe(0);
        },
        TIMEOUT,
    );
});
