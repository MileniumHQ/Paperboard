// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

// the detail's page, once collapsed
const PAGE = `document.querySelector('#detail')?.closest('[role="region"]')`;
const row = (name: string) => `label[data-value="${name}"]`;

async function openDetail(name: string) {
    await page.click(row(name));
    await page.waitFor(
        `(() => { const p = ${PAGE}; return p && !p.inert && document.querySelector('#detail').textContent === ${JSON.stringify(name)}
            && new DOMMatrix(getComputedStyle(p).transform).m41 === 0; })()`,
        `${name}'s detail page to slide in`,
    );
}

async function closeDetail(name: string) {
    const closes = await page.eval<number>("t.closes");
    await page.click(`#split [role="region"] [aria-label="Back"]`);
    // it slides away still showing who it was about; the selection clears after
    expect(await page.eval(`document.querySelector('#detail').textContent`)).toBe(name);
    await page.waitFor(`t.closes === ${closes + 1} && ${PAGE}.inert`, "the detail page to slide away and close");
}

// Inventory: Layout and navigation — Compact list rows reopen.
describe("PaperList rows in a collapsed PaperSplit", () => {
    test("PaperSplit reports crossing between collapsed and side by side", async () => {
        page = await browser.open("listSplit");
        await page.waitFor("t.collapsed.at(-1) === true", "the 400px split to report collapsed");

        await page.eval("t.setWidth(900)");
        await page.waitFor("t.collapsed.at(-1) === false", "the 900px split to report side by side");
        expect(await page.eval(`document.querySelector('#split #detail') !== null && !${PAGE}`)).toBe(true);

        await page.eval("t.setWidth(400)");
        await page.waitFor("t.collapsed.at(-1) === true", "the split to collapse again");
    });

    test("a row that prevents default opens its detail on every click, the same row again after closing", async () => {
        page = await browser.open("listSplit");
        await page.waitFor("t.collapsed.at(-1) === true", "the split to collapse");

        for (let round = 1; round <= 3; round++) {
            await openDetail("Alex");
            await closeDetail("Alex");
            expect(await page.eval("t.closes")).toBe(round);
        }
        await openDetail("Sam");
        await closeDetail("Sam");
        await openDetail("Alex");

        expect(await page.eval("t.opens")).toEqual(["Alex", "Alex", "Alex", "Sam", "Alex"]);
        expect(await page.eval("t.closes")).toBe(4);
    });
});
