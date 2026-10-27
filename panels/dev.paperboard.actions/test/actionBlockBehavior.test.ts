// Behavior contract for ActionBlock's editable fields (real browser).
//
// The panel's own components are bundled with Vite (PaperUI aliased to a DOM
// stub) and mounted in headless Chrome; the fixture drives clicks, variable
// insertion, Backspace and Enter and reports what happened. This is the only
// harness that can prove the picker is requested on a chip click, that one
// Backspace removes a chip's invisible anchors with it, and that the builtin
// Text action alone gets a multiline field.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const runFixture = (chrome: string) =>
    runBrowserFixture(chrome, "test/fixtures/actionBlockFixture.html", {
        "@mileniumhq/paperui": "test/fixtures/paperuiStub.tsx",
    });

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("action editable field behavior", () => {
    behaviorTest(
        chrome
            ? "the picker stays reachable, chips delete cleanly, and Text is the only multiline field (headless Chrome)"
            : "the picker stays reachable, chips delete cleanly, and Text is the only multiline field (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runFixture(chrome);
            expect(results.error, "the fixture threw").toBe("");
            const checks = results.checks;

            expect(checks.multilineFieldFound, "Text action field is not multiline").toBe(true);
            expect(checks.multilineEnterKeptFocus, "Enter blurred the multiline field").toBe(true);
            expect(
                checks.multilineAfterEnterDom,
                "Enter did not put a line break in the field",
            ).toContain("\\n");
            expect(
                checks.multilineCommittedValue,
                "the multiline value lost its line break",
            ).toBe("one\ntwo");

            expect(checks.joinFieldMultiline, "Join Text field must be single-line").toBe(false);
            expect(
                checks.lockedWrapWidth,
                "focus did not lock the field's footprint in the row",
            ).toMatch(/^[\d.]+px$/);
            expect(checks.singleLineEnterBlurred, "Enter must commit a single-line field").toBe(true);
            expect(checks.releasedWrapWidth, "blur left the row width locked").toBe("");

            expect(
                checks.pickerRequestsAfterFocus,
                "focusing the field did not request the picker",
            ).toBe(1);
            expect(
                checks.pickerRequestsAfterFieldClick,
                "a click must not request the picker twice",
            ).toBe(1);
            expect(checks.pickerAnchorIsField, "the picker was not anchored to its field").toBe(true);
            expect(checks.chipInserted, "inserting the variable produced no chip").toBe(true);
            expect(checks.chipCommittedValue).toBe("{{blk1:Username:person}}");
            expect(
                checks.pickerRequestsAfterChipClick,
                "clicking the chip did not request the picker",
            ).toBe(2);

            expect(checks.backspacePrevented, "the component ignored Backspace").toBe(true);
            expect(checks.chipRemoved, "one Backspace did not remove the chip").toBe(true);
            expect(
                checks.zeroWidthResidue,
                "invisible anchor characters survived the chip deletion",
            ).toBe(0);
            expect(checks.cleanCommittedValue).toBe("");
            expect(
                checks.selectionDeleteResidue,
                "deleting a selected chip stranded invisible anchor characters",
            ).toBe(0);

            expect(
                checks.clearableStartsUnselected,
                "a clearable options input did not start unselected",
            ).toBe(true);
            expect(
                checks.clearablePickerValues,
                "the picker did not offer the unselected entry first",
            ).toEqual([null, "qwen3:8b", "llama3:8b"]);
            expect(
                checks.clearableSelectedValue,
                "the unselected entry was not the picker's current value",
            ).toBe(true);
            expect(
                checks.clearableAnchorIsPill,
                "the option picker was not anchored to its pill",
            ).toBe(true);
            expect(checks.clearableChosenValue, "choosing an option did not set its value").toBe(
                "qwen3:8b",
            );
            expect(
                checks.clearableClearsToUndefined,
                "choosing the empty entry did not clear the value",
            ).toBe(true);
            expect(
                checks.clearableBackToEmptyLabel,
                "the pill did not return to its empty label after clearing",
            ).toBe(true);
            expect(
                checks.plainOptionsDefault,
                "a non-clearable options input stopped defaulting to its first option",
            ).toBe(true);

            expect(
                checks.anchorPointerDownCloseCalls,
                "pointerdown inside the picker's field closed the menu",
            ).toBe(0);
            expect(
                checks.outsidePointerDownCloseCalls,
                "pointerdown outside the menu did not close it",
            ).toBe(1);

            expect(
                checks.deprecatedNoteText,
                "a deprecated block must say what to do instead",
            ).toBe("Remove this step; it goes away after v0.2.");
            expect(checks.deprecatedNoteVisible, "the deprecation note is not visible").toBe(true);
            expect(checks.currentActionHasNote, "a current action must not show a note").toBe(false);

            expect(checks.listGroupName, "the item group needs its input's name").toBe("Items");
            expect(checks.listAfterFirst, "leaving the add field must add an item").toEqual(["red"]);
            expect(checks.listAfterSecond).toEqual(["red", "green"]);
            expect(checks.listItemFields).toBe(2);
            expect(checks.listAfterClear, "clearing an item must remove it").toEqual(["green"]);
            expect(checks.listItemFieldsAfterClear).toBe(1);

            expect(checks.limitProblemBefore, "an empty field breaks no limit").toBeNull();
            expect(checks.limitProblemAfter, "a broken limit must show before running").toBe(
                "\"Text 1\" holds at most 3 characters (it has 7)",
            );
            expect(checks.limitFieldInvalid).toBe("true");
            expect(checks.limitProblemFixed).toBeNull();
        },
        60_000,
    );
});
