// Every game's Players tab as a person meets it (real browser, real
// PaperUI): one roster, one Kick and Ban, and every failure shown with the
// player it failed for and the service's reason.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;
const label = (what: string) => (chrome ? `${what} (headless Chrome)` : `${what} (skipped: no Chrome)`);

describe("shared roster behavior", () => {
    behaviorTest(
        label("Terraria and Team Fortress 2 list, kick and ban through one roster"),
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/rosterBehavior.html?server=online", {});
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;
            expect(c.uncaught, "nothing may fail out of sight").toEqual([]);
            expect(c.terrariaRows, "who joined and who is banned are listed, online first").toEqual(["Alex", "Sam"]);
            expect(c.terrariaOnlineCanBeKicked).toBe(true);
            expect(c.terrariaDetailsAddress).toBe(true);
            expect(c.terrariaKick).toEqual({ action: "terraria-kick", input: { name: "Alex" } });
            expect(c.banDialogNote, "the ban dialog says what Terraria bans, then what happens to an online player").toBe(true);
            expect(c.banRefusalTitled, "a refused ban names the player").toBe(true);
            expect(c.banRefusalReason, "a refused ban carries the service's reason").toBe(true);
            expect(c.sourceRows, "players who share a name are told apart by Steam id; a bot keeps its name").toEqual(["Bot Heavy", "Pat (STEAM_0:1:1)", "Pat (STEAM_0:1:2)"]);
            expect(c.botCannotBeBanned, "a bot has no account to ban").toBe(true);
            expect(c.botHasNoDetails).toBe(true);
        },
        120_000,
    );

    behaviorTest(
        label("a roster the service cannot read is quoted with its reason"),
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/rosterBehavior.html?server=offline", {});
            expect(results.error, "the fixture threw").toBe("");
            expect(results.checks.uncaught).toEqual([]);
            expect(results.checks.loadFailureReason).toBe(true);
        },
        120_000,
    );
});
