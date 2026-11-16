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

// Inventory: Core contracts — a widget never hides what it lists, or cuts its title, without saying so.
test("with two computers, Home at 860 by 560 cuts no title and says how many rows it left out", async () => {
    const { page } = shell;
    await shell.pairComputer("pxlblade");
    await page.resize(860, 560);
    await page.waitFor(`${TILES}.length >= 7 && document.querySelectorAll("[aria-label^='pxlblade, ']").length === 1`, "Home with both computers");
    await page.settled();
    const seen = await page.evaluate<{ cutTitles: string[]; computers: { shown: string[]; more: number } }>(`(() => {
        const tiles = ${TILES};
        const cutTitles = tiles
            .flatMap((t) => [...t.querySelectorAll("[class*='_heading_'] > [class*='_title_']")])
            .filter((title) => title.scrollWidth > title.clientWidth)
            .map((title) => title.textContent);
        // the rows a person can see: laid out, and inside the list's box
        const list = document.querySelector("[aria-label^='pxlblade, ']").closest("ul");
        const box = list.getBoundingClientRect();
        const shown = [...list.querySelectorAll("button[aria-label]")]
            .filter((row) => {
                const r = row.closest("li").getBoundingClientRect();
                return r.height > 0 && r.left >= box.left && r.right <= box.right + 1 && r.bottom <= box.bottom + 1;
            })
            .map((row) => row.getAttribute("aria-label").split(",")[0]);
        const more = /\\+(\\d+) more/.exec(list.innerText);
        return { cutTitles, computers: { shown, more: more ? Number(more[1]) : 0 } };
    })()`);
    expect(seen.cutTitles).toEqual([]);
    // every computer is either shown or counted
    expect(seen.computers.shown.length + seen.computers.more).toBe(2);
    expect(seen.computers.shown.length).toBeGreaterThan(0);
    expect(page.exceptions).toEqual([]);
});
