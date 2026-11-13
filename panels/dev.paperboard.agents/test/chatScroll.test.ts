// Where the chat is held while its sizes change (real browser).
//
// The chat keeps itself at its end, or at the row someone scrolled up to read,
// through everything that resizes it: a bubble arriving, the message box
// growing. Only a browser lays anything out, so the chat is mounted in headless
// Chrome over a service with a conversation and nothing else
// (fixtures/paperapiStub.ts); the fixture changes the sizes and reports where
// the chat was left.
//
// Without Chrome the suite is skipped with a visible reason; CI must have it.
import { describe, expect, test } from "bun:test";
import { findChrome, runBrowserFixture, type FixtureResults } from "./browserFixture";

const chrome = findChrome();
if (!chrome && process.env.CI) throw new Error("CI has no Chrome, so the chat's scroll tests can't run: install it or set PAPERBOARD_CHROME");
const scrollTest = chrome ? test : test.skip;
const named = (name: string) => (chrome ? `${name} (headless Chrome)` : `${name} (skipped: no Chrome)`);

let results: Promise<FixtureResults> | undefined;
const fixture = async () => {
    results ??= runBrowserFixture(chrome!, "test/fixtures/chatFixture.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
    const { checks, error } = await results;
    expect(error, "the fixture threw").toBe("");
    return checks;
};

/** pixels of rounding a layout may leave */
const ROUNDING = 2;
const TIMEOUT = 180_000;

describe("the chat's scroll", () => {
    scrollTest(
        named("a long conversation opens at its end"),
        async () => {
            const { opened } = await fixture();
            expect(opened.overflows, "the conversation has to be long for this to mean anything").toBe(true);
            expect(opened.fromEnd).toBeLessThanOrEqual(ROUNDING);
        },
        TIMEOUT,
    );

    scrollTest(
        named("the chat stays at its end when a bubble arrives, a tall one too"),
        async () => {
            const { arrivedShort, arrivedTall } = await fixture();
            for (const arrived of [arrivedShort, arrivedTall]) {
                expect(arrived.fromEnd).toBeLessThanOrEqual(ROUNDING);
                expect(arrived.shown, "the new bubble was below the view").toBe(true);
            }
        },
        TIMEOUT,
    );

    scrollTest(
        named("the chat stays at its end when the message box grows and shrinks"),
        async () => {
            const { grown, cleared } = await fixture();
            expect(grown.listShrankBy, "the message box did not grow").toBeGreaterThan(20);
            expect(grown.fromEnd).toBeLessThanOrEqual(ROUNDING);
            expect(cleared.listRestored).toBe(true);
            expect(cleared.fromEnd).toBeLessThanOrEqual(ROUNDING);
        },
        TIMEOUT,
    );

    scrollTest(
        named("a reader who scrolled up stays on the same row when a bubble arrives, and when the message box grows"),
        async () => {
            const { whileArriving, whileGrowing } = await fixture();
            expect(whileArriving.away, "the reader was taken to the end").toBeGreaterThan(200);
            expect(Math.abs(whileArriving.moved), "the row they were reading moved").toBeLessThanOrEqual(ROUNDING);
            expect(Math.abs(whileArriving.scrollMoved), "the chat scrolled under them").toBeLessThanOrEqual(ROUNDING);
            expect(whileGrowing.away).toBeGreaterThan(200);
            expect(Math.abs(whileGrowing.moved), "the row they were reading moved").toBeLessThanOrEqual(ROUNDING);
        },
        TIMEOUT,
    );

    scrollTest(
        named("older rows drawn above a reader who reached the top leave them on the same row"),
        async () => {
            const { reachedTop } = await fixture();
            expect(reachedTop.olderRowsDrawn, "no older rows were drawn").toBeGreaterThan(0);
            expect(Math.abs(reachedTop.moved), "the row they were reading moved").toBeLessThanOrEqual(ROUNDING);
        },
        TIMEOUT,
    );

    scrollTest(
        named("a reader who scrolls back to the end is held there again, and nothing fails unseen"),
        async () => {
            const { returned, uncaught } = await fixture();
            expect(returned.fromEnd).toBeLessThanOrEqual(ROUNDING);
            expect(returned.shown).toBe(true);
            expect(uncaught).toEqual([]);
        },
        TIMEOUT,
    );
});
