// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();

const TOAST = '[data-paper-toasts] [role="alert"]';

const SIZES = [
    { name: "a phone", width: 400, height: 760, touch: true },
    { name: "a small window", width: 860, height: 560 },
    { name: "a desktop", width: 1440, height: 900 },
];

/** The controls matching `selector` that something else is drawn over, at their center. */
function covered(page: Page, selector: string): Promise<string[]> {
    return page.eval<string[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(hit && (el === hit || el.contains(hit) || hit.contains(el)));
    }).map((el) => el.id)`);
}

/** Says two failures and waits for them to settle where they show. */
async function failTwice(page: Page) {
    await page.eval("t.fail(2)");
    await page.waitFor(`document.querySelectorAll('${TOAST}').length === 2`, "both failure toasts");
    await page.waitFor(`document.getAnimations().every((a) => a.playState === "finished")`, "the toasts to settle");
}

// Inventory: PaperToast — toasts never cover the buttons a person needs.
describe("where toasts show", () => {
    for (const size of SIZES) {
        test(`on ${size.name}, two failures cover none of the page's buttons, along its top bar or its bottom`, async () => {
            const page = await browser.open("toastCover", size);
            await failTwice(page);
            // the top bar's middle and corners, a wizard's buttons, a composer: all clear
            expect(await covered(page, "[data-control]")).toEqual([]);
            // and the toasts themselves are where a press finds them
            expect(await covered(page, `${TOAST} [aria-label="Close"]`)).toEqual([]);
            page.expectNoErrors();
        });

        test(`on ${size.name}, in a dialog they show inside it, above its buttons, covering nothing in it`, async () => {
            const page = await browser.open("toastCover", { ...size, query: "dialog" });
            await page.waitFor(`document.querySelector('[role="dialog"]')?.getAttribute("aria-modal") === "true"`, "the dialog to open");
            await failTwice(page);
            expect(await covered(page, "[data-dialog-control]")).toEqual([]);
            expect(await page.eval(`!!document.querySelector('[data-paper-toasts]').closest('[role="dialog"]')`)).toBe(true);
            // between the content and the footer, in that order
            const order = await page.eval<number[]>(`(() => {
                const top = (sel) => document.querySelector(sel).getBoundingClientRect().top;
                return [top("#sign-in"), top(${JSON.stringify(TOAST)}), top("#install")];
            })()`);
            expect([...order].sort((a, b) => a - b)).toEqual(order);
            expect(await covered(page, `${TOAST} [aria-label="Close"]`)).toEqual([]);

            // what the dialog is about, told again, keeps it open: its toasts and the field being typed in stay
            await page.eval(`document.getElementById("key").focus()`);
            expect(await page.eval(`document.activeElement?.id`)).toBe("key");
            await page.eval("t.renew()");
            await page.frames();
            expect(await page.eval(`document.querySelectorAll('${TOAST}').length`)).toBe(2);
            expect(await page.eval(`document.activeElement?.id`)).toBe("key");

            // closed, the dialog gives them back to the page, the same elements: a failure is never lost with it
            await page.eval(`document.querySelector('${TOAST}').dataset.kept = "yes"`);
            await page.eval("t.setOpen(false)");
            await page.waitFor(`!document.querySelector('[data-paper-toasts]').closest('[role="dialog"]')`, "the toasts back on the page");
            expect(await page.eval(`document.querySelector('${TOAST}').dataset.kept`)).toBe("yes");
            expect(await page.eval(`document.querySelectorAll('${TOAST}').length`)).toBe(2);
            page.expectNoErrors();
        });
    }

    test("the region draws no box of its own, in either theme", async () => {
        for (const theme of ["light", "dark"]) {
            const page = await browser.open("toastCover", { query: `theme=${theme}` });
            await failTwice(page);
            expect(await page.eval(`getComputedStyle(document.querySelector("[data-paper-toasts]")).backgroundColor`)).toBe("rgba(0, 0, 0, 0)");
        }
    });

    test("a failure's details open under Details, whole, and copy", async () => {
        const page = await browser.open("toastCover");
        await page.eval("t.fail(1)");
        await page.waitFor(`document.querySelector('${TOAST}')`, "the failure toast");
        const toast = await page.eval<string>(`document.querySelector('${TOAST}').innerText`);
        expect(toast).toContain("SteamCMD exited with code 8");
        // the rest waits, folded, under Details
        const details = `document.querySelector('${TOAST} [role="region"]')`;
        const shown = `${details}.getBoundingClientRect().height`;
        expect(await page.eval(shown)).toBe(0);
        await page.click(`${TOAST} button[aria-expanded]`);
        await page.waitFor(`${shown} > 0 && document.getAnimations().every((a) => a.playState === "finished")`, "the details to open");
        expect(await page.eval(`${details}.innerText`)).toContain("Logging in anonymously...\nERROR! Failed to install app '2394010' (Disk write failure)");
        expect(await covered(page, `${TOAST} [role="region"] pre`)).toEqual([]);
        expect(await covered(page, `${TOAST} [aria-label="Copy code"]`)).toEqual([]);
        page.expectNoErrors();
    });
});
