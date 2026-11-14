import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { panelFiles, startService, stopServices } from "./helpers/service";

setDefaultTimeout(90_000);

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }], activeTabId: "tab1" };
// the screen that has the keyboard, and whether it is the one in view
const keyboardInShownScreen = `(() => {
    const el = document.activeElement;
    return Boolean(el?.classList.contains("xterm-helper-textarea") && el.closest(".xterm")?.getClientRects().length);
})()`;

describe("the panel's screens", () => {
    test("a new tab takes the keyboard", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const served = await servePanel();
        const page = await openPage(served.url);
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1 && document.body.innerText.includes("$")`, "the first shell");
            // New Tab: the button was clicked, yet typing goes to the new shell
            await page.click('button[aria-label="New Tab"]');
            await page.waitFor(`document.querySelectorAll(".xterm").length === 2`, "the second tab");
            await page.waitFor(keyboardInShownScreen, "the new tab to have the keyboard");

            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
