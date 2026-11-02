// The Maps tab's Steam Workshop search as a person meets it (real browser, real PaperUI): maps as picture
// cards with Valve's attribution, a chosen one added to the server and the rotation, and every failure shown
// with its reason. Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("source Workshop maps behavior", () => {
    behaviorTest(
        chrome
            ? "the Workshop is searched for maps, a chosen one joins the rotation, and failures say why (headless Chrome)"
            : "the Workshop is searched for maps, a chosen one joins the rotation, and failures say why (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/sourceWorkshop.html?server=s1", {});
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;
            expect(c.uncaught, "nothing may fail out of sight").toEqual([]);
            expect(c.askedPopular, "an empty search lists what is popular").toEqual({ query: "" });
            expect(c.titles).toBe(true);
            expect(c.pictureOfItsOwn, "a Workshop map shows the Workshop's own picture").toBe("https://images.steamusercontent.com/ugc/discovery/");
            expect(c.noPicture, "an item without one says so").toBe(true);
            expect(c.subscribers).toBe(true);
            expect(c.hiddenSaid, "results that are not maps are counted, not silently dropped").toBe(true);
            expect(c.attribution, "Valve's attribution and disclaimers come with the results").toBe(true);
            expect(c.added).toEqual([{ id: "454116880" }]);
            expect(c.joinedSaid, "adding is confirmed").toBe(true);
            expect(c.cardSaysInRotation, "a map already in the rotation says so").toBe(true);
            expect(c.addedBeforeRotation, "a map is added to the server before it is named in the rotation").toBe(true);
            expect(c.rotation).toEqual(["ctf_2fort", "cp_dustbowl", "workshop/454116880"]);
            expect(c.refusalReason, "an item the service refuses says why").toBe(true);
            expect(c.rotationKept).toBe(true);
            expect(c.searchReason).toBe(true);
            expect(c.pasteHint).toBe(true);
            expect(c.queryKept).toBe(true);
            expect(c.askedFor).toEqual({ query: "dustbowl" });
            expect(c.rowSaysWorkshop).toBe(true);
            expect(c.rowPicture).toBe(true);
        },
        120_000,
    );
});
