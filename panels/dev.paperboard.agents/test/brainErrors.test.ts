// Two brains' actions in a real browser (fixtures/brainErrors.tsx): what one
// brain's refusal says, and when, belongs to that brain alone.
import { expect, test } from "bun:test";
import { runBrowserFixture } from "./browserFixture";

test(
    "a refusal for one brain shows under that brain only, and doesn't undo the other brain's accepted code",
    async () => {
        const { checks, error } = await runBrowserFixture("test/fixtures/brainErrors.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
        expect(error, "the fixture threw").toBe("");
        expect(checks.codex.some((a: string) => a.includes("No space left on the disk"))).toBe(true);
        expect(checks.claude, "Codex's refusal shows under Claude Code").toEqual([]);
        expect(checks.codeField, "the accepted code is asked for again").toBe(false);
        expect(checks.uncaught).toEqual([]);
    },
    180_000,
);
