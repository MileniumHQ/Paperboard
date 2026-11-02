// Team Fortress 2's setup as a person meets it (real browser, real PaperUI): the install is followed by
// how the server will play, as picture cards, and Finish Setup saves it through the service.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("source setup behavior", () => {
    behaviorTest(
        chrome
            ? "setup asks the game mode, then the starting map, and saves only when finished (headless Chrome)"
            : "setup asks the game mode, then the starting map, and saves only when finished (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/sourceSetup.html?server=s1", {});
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;
            expect(c.uncaught, "nothing may fail out of sight").toEqual([]);
            expect(c.modes, "Capture the Flag, Control Point, Payload and Mixed are offered; Arena has no installed map").toEqual([true, true, true, true, false]);
            expect(c.unlistedMapHidden, "a map whose prefix the game doesn't list is no mode").toBe(true);
            expect(c.modeCounts).toBe(true);
            expect(c.ctfDrawnByItsMap, "a mode is drawn by one of its maps' pictures").toBe("https://wiki.example/ctf_2fort.png");
            expect(c.noPictureNoIcon, "a mode whose maps have no picture has none, not another's").toBeNull();
            expect(c.attribution).toBe(true);
            expect(c.finishWaitsForAMode, "Finish Setup needs a choice").toBe(true);
            expect(c.mapsOfTheMode, "the starting maps are the mode's").toBe(true);
            expect(c.firstMapChosen).toBe(true);
            expect(c.finishOpen).toBe(true);
            expect(c.choiceMoves).toBe(true);
            expect(c.nothingSavedBeforeFinish, "a pick is not a save").toBe(true);
            expect(c.refusalReason, "a refused save is shown with the service's reason").toBe(true);
            expect(c.refusedStays, "setup does not finish on a refused save").toBe(true);
            expect(c.saved).toEqual([{ mode: "ctf", map: "ctf_turbine" }, { mode: "ctf", map: "ctf_turbine" }]);
            expect(c.mixedAllMaps).toBe(true);
            expect(c.mixedDefault, "mixed starts on the game's own default map").toBe(true);
            expect(c.mixedSaved).toEqual([{ mode: null, map: "ctf_2fort" }]);
            expect(c.picturesReason, "a wiki that can't be reached is named where the pictures would be").toBe(true);
            expect(c.modesStillChoosable).toBe(true);
            expect(c.mapsReason).toBe(true);
            expect(c.noChoiceWithoutMaps).toBe(true);
        },
        120_000,
    );
});
