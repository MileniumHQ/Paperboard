// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

const trigger = (menu: string) => `#${menu} button[aria-haspopup="listbox"]`;
const option = (value: string) => `[role="option"][data-select-value="${value}"]`;
const popupOpen = (value: string) =>
    `document.querySelector('${option(value)}')?.closest('[role="listbox"]')?.getAttribute("aria-hidden") === "false"`;
const triggerText = (menu: string) => page.eval<string>(`document.querySelector('${trigger(menu)}').textContent`);

/** Opens a menu with a real click and waits until `value`'s option is where a press lands. */
async function openMenu(menu: string, value: string) {
    await page.click(trigger(menu));
    await page.waitFor(popupOpen(value), `the ${menu} menu to open`);
    await page.waitFor(
        `(() => { const el = document.querySelector('${option(value)}'); const r = el.getBoundingClientRect();
            return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[role="option"]') === el; })()`,
        `the ${value} option to be under the pointer`,
    );
}

// Inventory: Menus and form controls — Select menu contract.
describe("PaperSelectMenu", () => {
    test("pointer-down leaves the popup open so the click commits, firing input and change from the named input", async () => {
        page = await browser.open("selectMenu");
        await openMenu("free", "banana");
        const at = await page.center(option("banana"));

        await page.mouse("mouseMoved", at);
        await page.mouse("mousePressed", at);
        expect(await page.eval(popupOpen("banana"))).toBe(true);
        await page.mouse("mouseReleased", at);

        expect(await page.eval("t.changes")).toEqual(["banana"]);
        expect(await page.eval("t.formEvents")).toEqual(["input:fruit=banana", "change:fruit=banana"]);
        expect(await page.eval(popupOpen("banana"))).toBe(false);
        expect(await triggerText("free")).toContain("Banana");
    });

    test("a controlled menu changes only when its value does", async () => {
        page = await browser.open("selectMenu");
        expect(await triggerText("controlled")).toContain("Small");

        await openMenu("controlled", "l");
        await page.click(option("l"));
        expect(await page.eval("t.controlledChanges")).toEqual(["l"]);
        expect(await triggerText("controlled")).toContain("Small");
        expect(await page.eval(`document.querySelector('${option("s")}').getAttribute("aria-selected")`)).toBe("true");

        await page.eval('t.setSize("l")');
        expect(await triggerText("controlled")).toContain("Large");
        expect(await page.eval(`document.querySelector('${option("l")}').getAttribute("aria-selected")`)).toBe("true");
    });

    test("the trigger shows the selected option's label, including options added or relabelled after mount", async () => {
        page = await browser.open("selectMenu");
        // no option for the value yet: the value itself, never a blank trigger
        expect((await triggerText("late")).trim()).toMatch(/^x/);

        await page.eval("t.addOption()");
        expect(await triggerText("late")).toContain("Ex");

        await page.eval('t.relabel("Ex, renamed")');
        expect(await triggerText("late")).toContain("Ex, renamed");
    });

    // A phone's keyboard rising for the search field scrolls the page to keep the field in view. Closing on that
    // scroll took the field away, the keyboard fell again, and a searchable menu could never be used on a phone.
    test("a searchable menu stays open while its search field is focused and the page scrolls under it", async () => {
        page = await browser.open("selectMenu");
        await openMenu("searchable", "fast");
        const searchFocused = `document.activeElement?.matches('[role="listbox"] input[type="search"]') === true`;
        await page.waitFor(searchFocused, "the search field to take focus");

        await page.eval("document.dispatchEvent(new Event('scroll'))");
        await page.eval("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
        expect(await page.eval(popupOpen("fast"))).toBe(true);
        expect(await page.eval(searchFocused)).toBe(true);

        await page.click(option("smart"));
        expect(await page.eval("t.changes")).toEqual(["smart"]);
    });

    test("a searchable menu still closes when the page scrolls once its search field isn't focused", async () => {
        page = await browser.open("selectMenu");
        await openMenu("searchable", "fast");
        await page.eval("document.activeElement.blur()");
        await page.eval('document.getElementById("scroller").scrollTop = 200');
        await page.waitFor(`!(${popupOpen("fast")})`, "the scroll to close the menu");
    });
});
