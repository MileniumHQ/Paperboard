// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

// the folded iPhone Duo: under PAPER_PANEL_COMPACT_WIDTH (520), so a
// panel's tab is a page, inside the app's own page for the server
const FOLDED = { width: 466, height: 678, touch: true };
const entry = (value: string) => `label:has(input[value="${value}"])`;

/** the page bars on screen, each as what it reads */
const bars = () =>
    page.eval<string[]>(`[...document.querySelectorAll('[role="region"] > header')]
        .filter((bar) => { const r = bar.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < innerWidth; })
        .map((bar) => bar.innerText.replace(/\\s*chevron_right\\s*/g, " › ").replace(/arrow_back|group/g, "").trim())`);

/** waits, once a press has had its frames, for every page to stop sliding */
async function settled() {
    await page.frames();
    await page.waitFor(`document.getAnimations().length === 0`, "the pages to stop sliding");
}

// Inventory: Layout and navigation — nested phone pages share one bar.
describe("pages opened inside a page", () => {
    test.each(["light", "dark"])("at 466px (%s), a tab page and a detail page inside an app's page show one bar naming all three, and Back goes back one at a time", async (theme) => {
        page = await browser.open("nestedPages", { ...FOLDED, query: `theme=${theme}` });
        expect(await bars()).toEqual(["My Server"]);

        await page.tap(entry("players"));
        await settled();
        expect(await bars()).toEqual(["My Server › Players"]);

        await page.tap(entry("Sam"));
        await settled();
        expect(await bars()).toEqual(["My Server › Players › Sam"]);
        expect(await page.eval(`document.getElementById("detail").getBoundingClientRect().top >= document.querySelector('[role="region"] > header').getBoundingClientRect().bottom - 1`)).toBe(true);

        await page.tap('[role="region"] > header button[aria-label="Back"]');
        await settled();
        expect(await bars()).toEqual(["My Server › Players"]);

        await page.tap('[role="region"] > header button[aria-label="Back"]');
        await settled();
        expect(await bars()).toEqual(["My Server"]);
        expect(await page.eval("t.serverBacks")).toBe(0);
        expect(page.errors).toEqual([]);
    });

    test("wide, the same panel draws no page bar at all", async () => {
        page = await browser.open("nestedPages", { width: 1200, height: 800 });
        await page.click(entry("Sam"));
        await page.waitFor(`document.getElementById("detail").innerText === "Sam"`, "the detail to show Sam");
        expect(await bars()).toEqual([]);
        expect(page.errors).toEqual([]);
    });
});
