// The editor's Load backup window when the backups can't be listed (real
// browser): it says why in place, never in a toast, and its Try again lists
// them (test/fixtures/backupsFixture.tsx), over the real service on a real daemon.
import { describe, expect, test } from "bun:test";
import { browserFixture } from "./browserFixture";

const TIMEOUT = 180_000;

describe("backups that can't be listed", () => {
    test(
        "the Load backup window says why in place with Try again, which lists them once the daemon answers",
        async () => {
            const { checks, error } = await browserFixture("backups");
            expect(error, "the fixture threw").toBe("");
            expect(checks.uncaught, "the panel threw").toEqual([]);
            expect(checks.said).toContain("Couldn't list the backups");
            // why: the daemon's own refusal, in words
            expect(checks.said).toContain("Cross-panel access refused");
            expect(checks.toasted, "a toast said the list that stays unread").toBe(false);
            // the window keeps its close button, Cancel and Load backup: no second Try again
            expect(checks.footerButtons).toEqual(["close", "Cancel", "Load backup"]);
            expect(checks.loadHeld).toBe(true);
            expect(checks.gone).toBe(true);
        },
        TIMEOUT,
    );
});
