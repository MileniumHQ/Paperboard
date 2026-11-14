// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

/** what the switch, its checkbox and the listener each say */
const state = (id: string, log: string) =>
    page.eval<{ ariaChecked: string; checked: boolean; changes: boolean[] }>(`({
        ariaChecked: document.querySelector('#${id} [role="switch"]').getAttribute("aria-checked"),
        checked: document.querySelector('#${id} input[type="checkbox"]').checked,
        changes: t.${log},
    })`);

// Inventory: Menus and form controls — A toggle changes once per press.
describe("PaperToggle in a label", () => {
    test("a click on the switch or on the label text changes it exactly once", async () => {
        page = await browser.open("toggle");

        await page.click('#free [role="switch"]');
        expect(await state("free", "changes")).toEqual({ ariaChecked: "true", checked: true, changes: [true] });

        await page.click("#free-text");
        expect(await state("free", "changes")).toEqual({ ariaChecked: "false", checked: false, changes: [true, false] });

        await page.click('#free [role="switch"]');
        await page.click("#free-text");
        await page.click("#free-text");
        expect(await state("free", "changes")).toEqual({ ariaChecked: "true", checked: true, changes: [true, false, true, false, true] });
    });

    test("Space and Enter each toggle once", async () => {
        page = await browser.open("toggle");
        await page.eval(`document.querySelector('#free [role="switch"]').focus()`);

        await page.press(" ");
        expect(await state("free", "changes")).toEqual({ ariaChecked: "true", checked: true, changes: [true] });
        await page.press("Enter");
        expect(await state("free", "changes")).toEqual({ ariaChecked: "false", checked: false, changes: [true, false] });
    });

    test("a controlled toggle follows its checked prop", async () => {
        page = await browser.open("toggle");
        await page.click("#controlled-text");
        expect(await state("controlled", "controlledChanges")).toEqual({ ariaChecked: "true", checked: true, changes: [true] });

        await page.eval("t.setControlled(false)");
        expect(await state("controlled", "controlledChanges")).toEqual({ ariaChecked: "false", checked: false, changes: [true] });

        await page.click('#controlled [role="switch"]');
        expect(await state("controlled", "controlledChanges")).toEqual({ ariaChecked: "true", checked: true, changes: [true, true] });
    });

    test("a disabled toggle ignores clicks on the switch and the label", async () => {
        page = await browser.open("toggle");
        await page.click('#disabled [role="switch"]');
        await page.click("#disabled-text");
        expect(await state("disabled", "disabledChanges")).toEqual({ ariaChecked: "false", checked: false, changes: [] });
    });
});

const haptics = () => page.eval<string[]>("t.haptics");
const checkedOf = (id: string) => page.eval<string>(`document.querySelector('#${id} [role="switch"]').getAttribute("aria-checked")`);

// Inventory: Menus and form controls — A toggle thumps for its own flip only.
describe("PaperToggle's thump", () => {
    test("follows the user's own flip, from the switch or the label", async () => {
        page = await browser.open("toggle");
        await page.click('#free [role="switch"]');
        await page.click("#free-text");
        await page.click('#controlled [role="switch"]');
        await page.click("#controlled-text");
        expect(await haptics()).toEqual(["toggle", "toggle", "toggle", "toggle"]);

        // a change nobody pressed for moves the knob without one
        await page.eval("t.setControlled(true)");
        expect(await checkedOf("controlled")).toBe("true");
        expect(await haptics()).toHaveLength(4);
    });

    test("a refused flip leaves nothing waiting for a later change", async () => {
        page = await browser.open("toggle");
        await page.click('#refusing [role="switch"]');
        await page.click("#refusing-text");
        expect(await checkedOf("refusing")).toBe("false");

        await page.eval("t.setRefusing(true)");
        expect(await checkedOf("refusing")).toBe("true");
        expect(await haptics()).toEqual([]);
    });

    test("waits for a save the parent returns, and not past it", async () => {
        page = await browser.open("toggle");
        await page.click('#saving [role="switch"]');
        expect(await haptics()).toEqual([]);
        await page.eval("t.answerSave(true)");
        expect(await checkedOf("saving")).toBe("true");
        expect(await haptics()).toEqual(["toggle"]);

        // a save that keeps the old state, then an unrelated change
        await page.click('#saving [role="switch"]');
        await page.eval("t.answerSave(false)");
        expect(await checkedOf("saving")).toBe("true");
        await page.eval("t.setSaved(false)");
        expect(await checkedOf("saving")).toBe("false");
        expect(await haptics()).toEqual(["toggle"]);
    });
});
