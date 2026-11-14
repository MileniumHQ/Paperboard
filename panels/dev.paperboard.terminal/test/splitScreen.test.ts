import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { panelBrowser, servePanel } from "./helpers/browser";
import { panelFiles, runBlock, startService, stopServices } from "./helpers/service";

setDefaultTimeout(90_000);

const browser = panelBrowser();

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }], activeTabId: "tab1" };
// the first shell's screen: the first xterm of the tab's layer
const firstScreen = `document.querySelectorAll(".xterm")[0]`;

// A split puts a second shell beside the first. The first is the same live
// screen before, during and after: splitting or closing the split never
// rebuilds it, so what it showed stays and nothing is fetched again.
describe("splitting a tab", () => {
    test("Split and Close Split keep the first shell's screen and what it showed", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1 && document.body.innerText.includes("$")`, "the first shell");
            // output only the shell makes: the command line itself does not show it
            await runBlock("type-in-tab", { tab: "tab1", text: "echo first-$((40+2))\n" });
            await page.waitFor(`${firstScreen}.querySelector(".xterm-rows").innerText.includes("first-42")`, "the first shell's output");
            await page.evaluate(`${firstScreen}.dataset.kept = "yes"`);

            await page.click('button[aria-label="Split"]');
            await page.clickText("[role=menuitem]", "Split Right");
            await page.waitFor(`document.querySelectorAll(".xterm").length === 2`, "the second shell");
            await page.waitFor(`document.querySelector('button[aria-label="Close Split"]')`, "the split to show");
            expect(await page.evaluate<string | undefined>(`${firstScreen}.dataset.kept`)).toBe("yes");
            expect(await page.evaluate<string>(`${firstScreen}.querySelector(".xterm-rows").innerText`)).toContain("first-42");

            await page.click('button[aria-label="Close Split"]');
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the split to close");
            expect(await page.evaluate<string | undefined>(`${firstScreen}.dataset.kept`)).toBe("yes");
            expect(await page.evaluate<string>(`${firstScreen}.querySelector(".xterm-rows").innerText`)).toContain("first-42");

            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
