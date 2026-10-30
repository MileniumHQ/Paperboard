// The canvas as a person meets it (real browser): the real App on real
// PaperUI over a fake Actions service. It proves a canvas that can't load
// says why and can be retried, that a pressed or edited block rises above
// every layer the canvas saved, that a function's call is never lost or
// nested when dropped into its own body, and that a failed apply is shown
// with its reason and a retry. On the way it checks a project card's
// switch survives the service's announcement and the name renames in place.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("canvas behavior", () => {
    behaviorTest(
        chrome
            ? "loading, stacking, refused drops and sync failures (headless Chrome)"
            : "loading, stacking, refused drops and sync failures (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/canvasBehaviorFixture.html", {
                "@mileniumhq/paperapi": "test/fixtures/canvasSyncApi.ts",
            });
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;

            expect(c.homeShowsProject, "Actions must open on its projects").toBe(true);
            expect(c.switchTurnedOff, "a card's switch must follow the service").toBe(true);
            expect(c.switchKeptItsCard, "a card was rebuilt when its project changed, cutting the switch's slide").toBe(true);
            expect(c.editorNamesProject, "the editor's top bar must name the open project").toBe(true);
            expect(c.backButtonSquare, "the top bar squashed its back button").toBe(true);

            expect(c.loadFailureTitled, "a canvas that can't load needs a titled alert").toBe(true);
            expect(c.loadFailureReason, "the alert must give the reason on its own").toBe(true);
            expect(c.loadFailureRetry, "a canvas that can't load needs a retry").toBe(true);

            expect(c.pressedLayer, "a pressed block stayed under the canvas's saved layers").toBeGreaterThan(60);
            expect(c.editedAbovePressed, "an edited block must rise above the last one pressed").toBe(true);
            expect(c.editedLayer, "an edited block must stay a normal layer").toBeLessThan(1000);

            expect(c.topRefusalShown, "dropping a call into its own function must say why").toBe(true);
            expect(c.topRefusalReason).toContain("\"Greet\" can't go inside its own function");
            expect(c.topCallerStaysOnCanvas, "the refused call must stay on the canvas").toBe(true);
            expect(c.topCallerBackWhereItWas, "the refused call must go back where it was").toEqual({ x: 420, y: 440 });
            expect(c.topBodyStaysEmpty, "the function must not call itself").toBe(true);
            expect(c.topRefusalDismissed, "the refusal must dismiss").toBe(true);

            expect(c.childRefusalShown, "a refused call from a flow must say why").toBe(true);
            expect(c.childReturnedToFlow, "the refused call must go back to its flow").toEqual(["nested"]);
            expect(c.childBodyStaysEmpty, "the function must not call itself").toBe(true);
            expect(c.childStillOnScreen, "the refused call vanished from the flow").toBe(true);

            expect(c.syncErrorTitled, "a failed apply needs a titled alert").toBe(true);
            expect(c.syncErrorReason, "the alert must say what failed").toBe(true);
            expect(c.syncErrorRetry, "a failed apply needs a retry").toBe(true);
            expect(c.syncErrorCleared, "a successful retry must clear the alert").toBe(true);

            expect(c.renamedInPlace, "Enter in the name field must rename the project").toBe(true);
            expect(c.refusedNameReverted, "a refused name must go back to the saved one").toBe(true);
            expect(c.refusedNameSaysWhy, "a refused name must say why").toBe(true);
        },
        60_000,
    );
});
