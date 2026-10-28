// The panel as a person meets it (real browser): the real Main on real
// PaperUI over a fake Agents service. It proves settings stand and say why
// when the brains can't be looked for, that a failed turn names what didn't
// happen, that a refused erase or tool server
// removal is explained inside the confirmation that's still open, and that
// quiet text reads in PaperUI's muted colour, and that an app's card opens
// the app beside the chat, which steps aside, goes, and comes back.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("panel behavior", () => {
    behaviorTest(
        chrome
            ? "settings, refused confirmations and quiet text (headless Chrome)"
            : "settings, refused confirmations and quiet text (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/panelBehaviorFixture.html", {
                "@mileniumhq/paperapi": "test/fixtures/agentsApi.ts",
            });
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;

            expect(c.uncaught, "nothing may fail out of sight").toEqual([]);
            expect(c.chatFailureTitled, "a failed turn must name what didn't happen").toBe(true);
            expect(c.cardShown, "an app's card shows its picture, name and what it's for").toBe(true);
            expect(c.cardLinks, "an app's card is never a link").toBe(0);
            expect(c.frameBeforeOpen).toBe(false);
            expect(c.frameOpened, "Open shows the app beside the chat").toBe("about:blank#planner");
            expect(c.addressShown, "the app's address never shows").toBe(false);
            expect(c.chatBesideApp, "the chat stays beside the app").toBe(true);
            expect(c.chatGoneWhenExtended, "extending takes the chat away").toBe(true);
            expect(c.chatBackFromExtended, "and back").toBe(true);
            expect(c.frameAfterClose, "closing takes the app away").toBe(false);
            expect(c.chatFullAfterClose).toBe(true);
            expect(c.appsListed, "the Apps page lists every app, newest first").toEqual(["planner", "clock"]);
            expect(c.deleteAsked, "deleting an app asks first, naming its folder").toBe(true);
            expect(c.deleteCalled).toBe(true);
            expect(c.appsAfterDelete).toEqual(["planner"]);
            expect(c.menuClosedOnOpen, "opening an app from the list closes the menu").toBe(true);
            expect(c.frameFromList).toBe("about:blank#planner");

            expect(c.settingsShown, "settings must show while the brains can't be looked for").toBe(true);
            expect(c.detectFailureShown, "a failed look for the brains must say why").toBe(true);

            expect(c.eraseStillAsking, "a refused erase keeps its confirmation open").toBe(true);
            expect(c.eraseRefusalInModal, "a refused erase must say why where the person is looking").toBe(true);
            expect(c.removeStillAsking, "a refused removal keeps its confirmation open").toBe(true);
            expect(c.removeRefusalInModal, "a refused removal must say why where the person is looking").toBe(true);

            expect(c.routineScheduleColor, "a routine's schedule must be in the muted colour").toBe(c.mutedColor);
            expect(c.routineTextColor, "the routine itself stays in the text colour").not.toBe(c.mutedColor);
        },
        90_000,
    );
});
