// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

const DIALOG = '[role="dialog"][aria-modal="true"]';
const row = (name: string) => `label[data-value="${name}"]`;

async function openDetail(name: string) {
    await page.click(row(name));
    await page.waitFor(
        `document.querySelector('${DIALOG}')?.textContent.includes(${JSON.stringify(name)}) && document.querySelector('[aria-label="Close modal"]')?.getBoundingClientRect().width > 0`,
        `${name}'s detail to open`,
    );
}

async function closeDetail() {
    await page.waitFor(
        `(() => { const b = document.querySelector('${DIALOG} [aria-label="Close modal"]'); if (!b) return false; const r = b.getBoundingClientRect();
            return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("button") === b; })()`,
        "the close button to take presses",
    );
    await page.click(`${DIALOG} [aria-label="Close modal"]`);
    await page.waitFor(`!document.querySelector('[role="dialog"]')`, "the detail modal to leave");
}

// Inventory: Layout and navigation — Compact list rows reopen.
describe("PaperList rows in a collapsed PaperSplit", () => {
    test("PaperSplit reports crossing between collapsed and side by side", async () => {
        page = await browser.open("listSplit");
        await page.waitFor("t.collapsed.at(-1) === true", "the 400px split to report collapsed");

        await page.eval("t.setWidth(900)");
        await page.waitFor("t.collapsed.at(-1) === false", "the 900px split to report side by side");
        expect(await page.eval(`document.querySelector('#split #detail') !== null && !document.querySelector('[role="dialog"]')`)).toBe(true);

        await page.eval("t.setWidth(400)");
        await page.waitFor("t.collapsed.at(-1) === true", "the split to collapse again");
    });

    test("a row that prevents default opens its detail on every click, the same row again after closing", async () => {
        page = await browser.open("listSplit");
        await page.waitFor("t.collapsed.at(-1) === true", "the split to collapse");

        for (let round = 1; round <= 3; round++) {
            await openDetail("Alex");
            await closeDetail();
            expect(await page.eval("t.closes")).toBe(round);
        }
        await openDetail("Sam");
        await closeDetail();
        await openDetail("Alex");

        expect(await page.eval("t.opens")).toEqual(["Alex", "Alex", "Alex", "Sam", "Alex"]);
        expect(await page.eval("t.closes")).toBe(4);
    });
});
