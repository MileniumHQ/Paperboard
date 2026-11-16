// Projects the service couldn't read as it started (real browser): Home says
// why in place, never in a toast, with a Try again that asks the service to read them again,
// over the real service on a real daemon (test/fixtures/unreadableFixture.tsx).
import { describe, expect, test } from "bun:test";
import { browserFixture } from "./browserFixture";

const TIMEOUT = 180_000;

describe("projects the service couldn't read as it started", () => {
    test(
        "Home says why in place, and its Try again reads them again: it stays while they're unreadable, and goes once they're read",
        async () => {
            const { checks, error } = await browserFixture("unreadable");
            expect(error, "the fixture threw").toBe("");
            expect(checks.uncaught, "the panel threw").toEqual([]);
            expect(checks.said).toContain("Couldn't read the projects");
            // why: the file's own fault, as the service read it
            expect(checks.why).toContain("JSON Parse error");
            expect(checks.offered).toBe(true);
            expect(checks.toasted, "a toast said the standing failure").toBe(false);
            expect(checks.again).toContain("Couldn't read the projects");
            expect(checks.whyAgain).toBe(checks.why);
            expect(checks.toastedAgain, "a toast said the refused read again").toBe(false);
            expect(checks.gone).toBe(true);
            expect(checks.canMake).toBe(true);
        },
        TIMEOUT,
    );
});
