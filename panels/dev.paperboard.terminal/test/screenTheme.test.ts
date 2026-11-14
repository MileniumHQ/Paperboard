import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { panelFiles, startService, stopServices } from "./helpers/service";

setDefaultTimeout(90_000);

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }], activeTabId: "tab1" };
const frames = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`;
// the color the screen writes text in, and the theme's text color around it (the screen's paper carries it)
const colors = `(() => {
    const xterm = document.querySelector(".xterm");
    return { screen: getComputedStyle(xterm.querySelector(".xterm-rows")).color, theme: getComputedStyle(xterm.parentElement).color };
})()`;

async function opened(): Promise<{ page: Page; stop: () => Promise<void> }> {
    await panelFiles({ "tabs.json": TABS });
    await startService();
    const served = await servePanel();
    const page = await openPage(served.url);
    await page.waitFor(`document.querySelectorAll(".xterm").length === 1 && document.body.innerText.includes("$")`, "the first shell");
    return {
        page,
        stop: async () => {
            await page.close();
            served.stop();
        },
    };
}

// xterm draws with colors it was handed, not with the stylesheet, so a screen
// that read the theme once would stay light in a dark app.
describe("a screen's look", () => {
    test("its colors follow the app's theme when it switches", async () => {
        const { page, stop } = await opened();
        try {
            // the shell sets the theme it resolved on the panel's document
            await page.evaluate(`document.documentElement.setAttribute("data-paperui-theme", "light")`);
            await page.evaluate(frames);
            const light = await page.evaluate<{ screen: string; theme: string }>(colors);
            expect(light.screen).toBe(light.theme);

            await page.evaluate(`document.documentElement.setAttribute("data-paperui-theme", "dark")`);
            await page.evaluate(frames);
            const dark = await page.evaluate<{ screen: string; theme: string }>(colors);
            expect(dark.theme).not.toBe(light.theme);
            expect(dark.screen).toBe(dark.theme);

            expect(page.exceptions).toEqual([]);
        } finally {
            await stop();
        }
    });

    test("once the code font is in, its rows are as tall as the font's and fill the screen's height", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        // the code font arrives after the screen has opened and measured its cells with the fallback
        const served = await servePanel({ hold: /SuseMono/i });
        const page = await openPage(served.url, { until: "parsed" });
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1 && document.body.innerText.includes("$")`, "the first shell");
            const font = `(() => { const rows = getComputedStyle(document.querySelector(".xterm-rows")); return rows.fontSize + " " + rows.fontFamily; })()`;
            expect(await page.evaluate<boolean>(`document.fonts.check(${font})`)).toBe(false);
            served.release();
            // nothing on the page changes when a font arrives, so the wait is on the font itself
            await page.evaluate(`document.fonts.load(${font})`);
            // the screen measures again as the font arrives, and draws its rows on the frames after
            await page.evaluate(frames);
            const fit = await page.evaluate<{ rows: number; rowHeight: number; fontHeight: number; height: number }>(`(() => {
                const xterm = document.querySelector(".xterm");
                const rows = xterm.querySelector(".xterm-rows");
                // xterm sizes a cell from this element: a run of characters in the screen's font
                const measure = xterm.querySelector(".xterm-char-measure-element").getBoundingClientRect();
                return { rows: rows.children.length, rowHeight: rows.children[0].getBoundingClientRect().height, fontHeight: Math.floor(measure.height), height: xterm.parentElement.clientHeight };
            })()`);
            // a row is a line of the code font, and the box holds as many whole rows as fit
            expect(fit.rowHeight).toBe(fit.fontHeight);
            expect(fit.rows).toBe(Math.floor(fit.height / fit.rowHeight));

            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
