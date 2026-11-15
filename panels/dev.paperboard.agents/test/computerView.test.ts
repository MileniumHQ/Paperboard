// The agent's computer in a real browser (fixtures/computerFixture.tsx):
// using a window takes control once, an idle spell hands it back, and so
// does closing the view, so the agent is never left waiting on hands that
// went.
import { describe, expect, test } from "bun:test";
import { runBrowserFixture } from "./browserFixture";

describe("control of the computer", () => {
    test(
        "taken once by using a window, handed back when idle and when the view closes",
        async () => {
            const { checks, error } = await runBrowserFixture("test/fixtures/computerFixture.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
            expect(error, "the fixture threw").toBe("");
            expect(checks.takenOnce, "using a window it already held took it again").toEqual([true]);
            expect(checks.afterIdle, "an idle spell didn't hand it back").toEqual([true, false]);
            expect(checks.all, "closing the view didn't hand it back").toEqual([true, false, true, false]);
            expect(checks.idleLeft, "the idle wait outlived the view").toBe(0);
            expect(checks.uncaught).toEqual([]);
        },
        180_000,
    );
});
