// Projects the service couldn't read as it started (real browser): Home's
// Couldn't load has a Try again that asks the service to read them again,
// over the real service on a real daemon (test/fixtures/unreadableFixture.tsx).
import { describe, expect, test } from "bun:test";
import { browserFixture } from "./browserFixture";

const TIMEOUT = 180_000;

describe("projects the service couldn't read as it started", () => {
    test(
        "Home's Try again reads them again: the toast says why while they stay unreadable, and goes once they're read",
        async () => {
            const { checks, error } = await browserFixture("unreadable");
            expect(error, "the fixture threw").toBe("");
            expect(checks.uncaught, "the panel threw").toEqual([]);
            expect(checks.said).toContain("Couldn't read the projects");
            expect(checks.offered).toBe(true);
            expect(checks.again).toContain("Couldn't read the projects");
            expect(checks.canMake).toBe(true);
        },
        TIMEOUT,
    );
});
