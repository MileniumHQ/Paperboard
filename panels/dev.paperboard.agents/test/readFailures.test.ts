// Reads that fail, in a real browser (fixtures/readFailures.tsx): a failed
// read is always told where it matters, and a failure that's over isn't.
import { beforeAll, describe, expect, test } from "bun:test";
import { runBrowserFixture, type FixtureResults } from "./browserFixture";

let result: FixtureResults;
beforeAll(async () => {
    result = await runBrowserFixture("test/fixtures/readFailures.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
}, 180_000);

describe("a failed read", () => {
    test("of the pages is told on a page's card when they were never read, and above the list when a read again fails", () => {
        expect(result.error, "the fixture threw").toBe("");
        expect(result.checks.firstCard.some((a: string) => a.includes("The pages folder is locked")), "the card says nothing").toBe(true);
        expect(result.checks.later.list, "the list that was read went").toBe(true);
        expect(result.checks.later.alerts.some((a: string) => a.includes("The disk went away")), "the failed read again isn't told").toBe(true);
        expect(result.checks.later.card, "a card whose page was read still complains").toEqual([]);
        expect(result.checks.uncaught).toEqual([]);
    });

    test("of what's allowed gives way to the view the service pushes next", () => {
        expect(result.error, "the fixture threw").toBe("");
        expect(result.checks.accessAfterPush).toEqual({ refusal: false, grant: true });
    });
});
