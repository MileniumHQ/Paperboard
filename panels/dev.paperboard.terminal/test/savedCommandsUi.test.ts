// Saved commands as a person uses them from the Home widget.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { widgetUrl } from "testkit/panelUi";
import { panelBrowser, servePanel } from "./helpers/browser";
import { call, panelFiles, startService, stopServices } from "./helpers/service";

setDefaultTimeout(90_000);

const browser = panelBrowser();

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }], activeTabId: "tab1" };

describe("the Pinned command widget", () => {
    // the widget's own document, in its frame
    const widget = (expr: string) => `(() => { const doc = document.getElementById("widget").contentDocument; return ${expr}; })()`;
    const shows = (text: string) => widget(`Boolean(doc?.body?.innerText.includes(${JSON.stringify(text)}))`);

    test("runs its command and shows the exit, then says when the command is removed", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const id = await call.saveCommand({ label: "Build", command: "exit 3" });
        const served = await servePanel();
        const page = await browser.open(widgetUrl(served.url, "pinned-command", { command: id }, { w: 2, h: 1 }));
        try {
            await page.waitFor(`window.widgetSaid.includes("paperboard:ready")`, "the widget to be ready");
            await page.waitFor(shows("Not run yet"), "the command's tile");
            await page.evaluate(widget(`doc.querySelector('button[aria-label="Run Build"]').click()`));
            await page.waitFor(shows("Exit 3"), "the exit");

            await call.removeSavedCommand({ id });
            await page.waitFor(shows("Command removed"), "the removed command to be said");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
