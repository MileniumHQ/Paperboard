// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

const TOAST = '[data-paper-toasts] [role="alert"]';

// Inventory: createRead — a view that couldn't load.
describe("a createRead with a failure, for a view with nothing to show", () => {
    test("the body says it couldn't load with its own Try again, the toast says why, and an answer clears both", async () => {
        page = await browser.open("failedRead");
        await page.waitFor(`document.querySelector('${TOAST}')`, "the failure toast");
        expect(await page.eval(`document.querySelector('${TOAST}').innerText`)).toContain("Couldn't load the worlds\nThe server didn't answer: it may be offline");
        expect(await page.eval(`document.getElementById("failed").textContent`)).toContain("Couldn't load");

        // closed, it stays closed while the same failure stands
        await page.click(`${TOAST} [aria-label="Close"]`);
        await page.waitFor(`!document.querySelector('${TOAST}')`, "the toast to close");

        // the body's Try again: failing again says so again
        await page.click("#failed button");
        await page.waitFor(`t.reads === 2 && document.querySelector('${TOAST}')`, "the second failure's toast");

        await page.eval("t.answer()");
        await page.click("#failed button");
        await page.waitFor(`document.getElementById("worlds")`, "the worlds to show");
        expect(await page.eval(`!document.querySelector('${TOAST}') && !document.getElementById("failed")`)).toBe(true);
    });
});
