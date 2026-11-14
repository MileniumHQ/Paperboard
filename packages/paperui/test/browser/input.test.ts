// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

const shown = (id: string) => page.eval<string>(`document.getElementById(${JSON.stringify(id)}).value`);

/** focuses a field, puts the caret at its end and types */
async function typeInto(id: string, text: string) {
    await page.click(`#${id}`);
    await page.eval(`(() => { const f = document.getElementById(${JSON.stringify(id)}); f.setSelectionRange(f.value.length, f.value.length); })()`);
    await page.type(text);
}

/** what the field shows a task after an edit is left: any resync has run */
async function settled(id: string) {
    await page.eval("new Promise((resolve) => setTimeout(resolve, 20))");
    return shown(id);
}

// Inventory: Menus and form controls — A controlled field keeps what is typed until its parent answers.
describe("a controlled PaperInput", () => {
    test("a parent that saves on blur reads what was typed, and the field keeps it", async () => {
        page = await browser.open("input");
        await typeInto("on-blur", " world");
        await page.click("#elsewhere");

        expect(await page.eval("t.saved")).toEqual(["Survival world"]);
        expect(await settled("on-blur")).toBe("Survival world");
        expect(await page.eval("t.stored()")).toBe("Survival world");
    });

    test("a parent whose save takes a while is waited for: the field never shows the old value", async () => {
        page = await browser.open("input");
        await typeInto("slow", " world");
        await page.press("Tab");

        await page.waitFor("t.slowSaved.length === 1", "the slow save");
        expect(await page.eval("t.slowSaved")).toEqual(["Survival world"]);
        const seen = await page.eval<string[]>("t.slowSeen");
        expect(seen.length).toBeGreaterThan(0);
        expect(new Set(seen)).toEqual(new Set(["Survival world"]));
        expect(await settled("slow")).toBe("Survival world");
    });

    test("a parent that reshapes each keystroke is followed, never fought", async () => {
        page = await browser.open("input");
        await typeInto("sanitised", "ab1c");
        expect(await shown("sanitised")).toBe("ABC");
        expect(await page.eval("t.code()")).toBe("ABC");
        // the caret stays where typing goes on
        expect(await page.eval(`document.getElementById("sanitised").selectionStart`)).toBe(3);

        await page.type("d");
        expect(await shown("sanitised")).toBe("ABCD");
        await page.click("#elsewhere");
        expect(await settled("sanitised")).toBe("ABCD");
    });

    test("a parent that refuses the edit has the field show its value once the edit is left", async () => {
        page = await browser.open("input");
        await typeInto("refused", "!!");
        // while typing, the text stays
        expect(await shown("refused")).toBe("fixed!!");
        await page.click("#elsewhere");

        expect(await page.eval("t.refused")).toEqual(["fixed!!"]);
        expect(await settled("refused")).toBe("fixed");
    });

    test("an Enter that commits the edit while the field keeps focus also goes back to a refused value", async () => {
        page = await browser.open("input");
        await typeInto("refused", "?");
        await page.press("Enter");
        expect(await settled("refused")).toBe("fixed");
        expect(await page.eval("document.activeElement.id")).toBe("refused");
    });
});
