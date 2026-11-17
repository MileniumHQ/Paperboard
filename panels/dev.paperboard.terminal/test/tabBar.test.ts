import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { panelBrowser, servePanel } from "./helpers/browser";
import { panelFiles, startService, stopServices } from "./helpers/service";

setDefaultTimeout(90_000);

const browser = panelBrowser();

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

// the colour drawn behind an element: its own, or the first one an ancestor paints
const backdrop = (from: string) => `(() => {
    for (let el = ${from}; el; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
    }
    return null;
})()`;

test("the toolbar beside the tabs sits on the tab strip's surface, so the bar reads as one", async () => {
    await panelFiles({ "tabs.json": { tabs: [{ id: "tab1", label: "One" }], activeTabId: "tab1" } });
    await startService();
    const served = await servePanel();
    const page = await browser.open(served.url);
    try {
        await page.waitFor(`document.querySelectorAll(".xterm").length >= 1 && !!document.querySelector('button[aria-label="New Tab"]')`, "the first tab and the toolbar");
        const tabs = await page.evaluate<string | null>(backdrop(`document.querySelector("input[name='terminal-tabs']").closest("[class*='_PaperList_']")`));
        const toolbar = await page.evaluate<string | null>(backdrop(`document.querySelector('button[aria-label="New Tab"]').parentElement`));
        expect(tabs).not.toBeNull();
        expect(toolbar).toBe(tabs);
    } finally {
        await page.close();
        served.stop();
    }
});
