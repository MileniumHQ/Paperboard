// Home in the narrowest window Paperboard opens: its widgets share the
// window's width instead of running off its right edge.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, type Shell } from "./support/shell";

let shell: Shell;

beforeAll(async () => {
    shell = await bootShell();
});

afterAll(async () => {
    await shell?.close();
});

const TILES = `[...document.querySelectorAll("[data-home-item]")]`;

// Inventory: Core contracts — every widget on Home is in view without scrolling sideways.
test("the first Home fits a window of 860 by 560 without scrolling sideways", async () => {
    const { page } = shell;
    await page.resize(860, 560);
    await page.waitFor(`${TILES}.length >= 7`, "Home's first widgets");
    await page.settled();
    const fit = await page.evaluate<{ overflow: number; cut: string[] }>(`(() => {
        const tiles = ${TILES};
        let scroller = tiles[0].parentElement;
        while (getComputedStyle(scroller).overflowX !== "auto") scroller = scroller.parentElement;
        const right = scroller.getBoundingClientRect().right;
        return {
            overflow: scroller.scrollWidth - scroller.clientWidth,
            cut: tiles.filter((t) => t.getBoundingClientRect().right > right).map((t) => t.dataset.homeItem),
        };
    })()`);
    expect(fit).toEqual({ overflow: 0, cut: [] });
    expect(page.exceptions).toEqual([]);
});
