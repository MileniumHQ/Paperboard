// A new project left without a block by closing its window (real browser):
// no page tells the service it was left, so the service still holds it as a
// draft. The whole panel runs over the real service, on a real daemon
// (test/fixtures/projectsFixture.tsx).
import { describe, expect, test } from "bun:test";
import { browserFixture } from "./browserFixture";

const TIMEOUT = 180_000;

describe("a new project whose window closed before it had a block", () => {
    test(
        "isn't listed, and takes no name from the next new project, made from home or from the editor",
        async () => {
            const { checks, error } = await browserFixture("projects");
            expect(error, "the fixture threw").toBe("");
            expect(checks.uncaught, "the panel threw").toEqual([]);
            expect(checks.first).toBe("Untitled project");
            expect(checks.emptyState).toBe(true);
            expect(checks.shown).toBe(0);
            expect(checks.fromHome).toBe("Untitled project");
            expect(checks.fromMenu).toBe("Untitled project");
        },
        TIMEOUT,
    );
});
