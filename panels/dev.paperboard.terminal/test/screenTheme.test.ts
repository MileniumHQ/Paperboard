import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { panelFiles, startService, stopServices } from "./helpers/service";

setDefaultTimeout(90_000);

const browser = panelBrowser();

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }], activeTabId: "tab1" };
// the color the screen writes text in, and the theme's text color around it (the screen's paper carries it)
const colors = `(() => {
    const xterm = document.querySelector(".xterm");
    return { screen: getComputedStyle(xterm.querySelector(".xterm-rows")).color, theme: getComputedStyle(xterm.parentElement).color };
})()`;

async function opened(): Promise<{ page: Page; stop: () => Promise<void> }> {
    await panelFiles({ "tabs.json": TABS });
    await startService();
    const served = await servePanel();
    const page = await browser.open(served.url);
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
            await page.waitFor(`(${colors}).screen === (${colors}).theme`, "the screen to draw in the light theme's text color");
            const light = await page.evaluate<{ screen: string; theme: string }>(colors);
            expect(light.screen).toBe(light.theme);

            await page.evaluate(`document.documentElement.setAttribute("data-paperui-theme", "dark")`);
            await page.waitFor(`(${colors}).theme !== ${JSON.stringify(light.theme)} && (${colors}).screen === (${colors}).theme`, "the screen to draw in the dark theme's text color");
            const dark = await page.evaluate<{ screen: string; theme: string }>(colors);
            expect(dark.theme).not.toBe(light.theme);
            expect(dark.screen).toBe(dark.theme);

            expect(page.exceptions).toEqual([]);
        } finally {
            await stop();
        }
    });
});
