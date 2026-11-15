// Two brains' actions in a real browser (fixtures/brainErrors.tsx): what one
// brain's refusal says, and when, belongs to that brain alone.
import { beforeAll, expect, test } from "bun:test";
import { runBrowserFixture, type FixtureResults } from "./browserFixture";

let result: FixtureResults;
beforeAll(async () => {
    result = await runBrowserFixture("test/fixtures/brainErrors.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
}, 180_000);

test("a brain's button pressed twice before the service answers is sent once", () => {
    expect(result.error, "the fixture threw").toBe("");
    expect(result.checks.installs).toBe(1);
});

test(
    "a refusal for one brain shows under that brain only, and doesn't undo the other brain's accepted code",
    () => {
        const { checks, error } = result;
        expect(error, "the fixture threw").toBe("");
        expect(checks.codex.some((a: string) => a.includes("No space left on the disk"))).toBe(true);
        expect(checks.claude, "Codex's refusal shows under Claude Code").toEqual([]);
        expect(checks.codeField, "the accepted code is asked for again").toBe(false);
        expect(checks.uncaught).toEqual([]);
    },
);
