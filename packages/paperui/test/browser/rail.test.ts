// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

const item = (name: string) => `[data-item="${name}"]`;

/** the pointer down on `from`, carried to `to`'s place, still pressed */
async function carry(from: string, to: string) {
    const start = await page.center(item(from));
    const end = await page.center(item(to));
    await page.mouse("mouseMoved", start);
    await page.mouse("mousePressed", start);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
        await page.mouse("mouseMoved", { x: start.x, y: start.y + ((end.y - start.y) * i) / steps });
    }
    return end;
}

// Inventory: Layout and navigation — A drag-reorder can be called off.
describe("PaperRail drag-reorder", () => {
    test("a drag let go reports the new order", async () => {
        page = await browser.open("railReorder");
        const end = await carry("home", "files");
        await page.mouse("mouseReleased", end);
        expect(await page.eval("t.reorders")).toEqual([["games", "files", "home"]]);
    });

    test("Escape during a drag puts the items back, and letting go reports and selects nothing", async () => {
        page = await browser.open("railReorder");
        const end = await carry("games", "files");
        // under way: the carried item has moved
        expect(await page.eval(`getComputedStyle(document.querySelector('${item("games")}')).transform`)).not.toBe("none");

        await page.press("Escape");
        await page.frames();
        const transforms = await page.eval<string[]>(
            `["home", "games", "files"].map((n) => document.querySelector('[data-item="' + n + '"]').style.transform)`,
        );
        expect(transforms).toEqual(["", "", ""]);

        await page.mouse("mouseReleased", end);
        await page.frames();
        expect(await page.eval("t.reorders")).toEqual([]);
        expect(await page.eval("t.order()")).toEqual(["home", "games", "files"]);
        expect(await page.eval("t.value()")).toBe("home");
    });
});

// Inventory: Layout and navigation — a computer's initials fit its rail item.
describe("PaperRail with monograms", () => {
    test("two wide capitals fit inside their item, so the rail never scrolls sideways", async () => {
        page = await browser.open("railMonogram");
        const fit = await page.eval<{ scrolls: boolean; items: [string, number, number][] }>(`(() => {
            const box = document.getElementById("rail-box");
            return {
                scrolls: box.scrollWidth > box.clientWidth,
                items: ["WO", "MW", "OO"].map((letters) => {
                    const it = document.querySelector('[data-item="' + letters + '"]');
                    const mono = it.querySelector('[class*="monogram"]');
                    return [letters, mono.getBoundingClientRect().width, it.getBoundingClientRect().width];
                }),
            };
        })()`);
        expect(fit.scrolls).toBe(false);
        for (const [letters, width, room] of fit.items) expect([letters, width <= room]).toEqual([letters, true]);
    });
});
