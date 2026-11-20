// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

const item = (name: string) => `[data-item="${name}"]`;

// Inventory: PaperListItem — a press in an item's actions is theirs.
describe("PaperListItem actions", () => {
    test("a press on an action, a switch, or between them neither chooses the item nor reaches its onClick", async () => {
        page = await browser.open("listActions");
        await page.click("#delete");
        await page.click("#note");
        await page.click('[role="switch"][aria-label="On"]');
        await page.frames();
        expect(await page.eval("[t.value(), t.rowClicks, t.deletes, t.on()]")).toEqual(["alpha", 0, 1, true]);
        // the rest of the item still chooses it
        await page.click(`${item("beta")} [class*="itemText"]`);
        await page.waitFor(`t.value() === "beta"`, "a press on the text to choose it");
        expect(await page.eval("t.rowClicks")).toBeGreaterThan(0);
    });

    test("a drag that starts on an action moves nothing", async () => {
        page = await browser.open("listActions");
        const start = await page.center("#delete");
        const end = await page.center(item("alpha"));
        await page.mouse("mouseMoved", start);
        await page.mouse("mousePressed", start);
        for (let i = 1; i <= 8; i++) await page.mouse("mouseMoved", { x: start.x, y: start.y + ((end.y - start.y) * i) / 8 });
        expect(await page.eval(`document.querySelector('${item("beta")}').style.transform || ""`)).toBe("");
        await page.mouse("mouseReleased", end);
        await page.frames();
        expect(await page.eval("t.reorders")).toBe(0);
    });
});
