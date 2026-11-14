// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

const item = (name: string) => `[data-item="${name}"]`;

// Inventory: Layout and navigation — a drag-reorder in a list chooses nothing.
describe("PaperList drag-reorder", () => {
    test("a press chooses; a drag called off and let go chooses nothing and reaches no onClick", async () => {
        page = await browser.open("listReorder");
        await page.click(item("gamma"));
        await page.waitFor(`t.value() === "gamma"`, "the press to choose gamma");
        const clicked = await page.eval<[string[], number]>("[t.itemClicks, t.listClicks]");
        expect(clicked[0]).toContain("gamma");
        expect(clicked[1]).toBeGreaterThan(0);

        // carried over another item, called off, then let go: the click the
        // release makes belongs to the drag
        const start = await page.center(item("beta"));
        const end = await page.center(item("alpha"));
        await page.mouse("mouseMoved", start);
        await page.mouse("mousePressed", start);
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
            await page.mouse("mouseMoved", { x: start.x, y: start.y + ((end.y - start.y) * i) / steps });
        }
        await page.press("Escape");
        await page.mouse("mouseReleased", end);
        await page.frames();
        expect(await page.eval("t.reorders")).toEqual([]);
        expect(await page.eval("t.value()")).toBe("gamma");
        expect(await page.eval("[t.itemClicks, t.listClicks]")).toEqual(clicked);
    });
});
