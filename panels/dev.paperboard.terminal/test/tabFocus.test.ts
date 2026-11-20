import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { panelFiles, serviceState, startService, stopServices } from "./helpers/service";

setDefaultTimeout(90_000);

const browser = panelBrowser();

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
// the calls the page made to the service, by name
const callsTo = (page: Page, name: string) => page.sentFrames.filter((f) => f.includes(`"command.call-${name}"`)).length;

async function opened(tabs: unknown): Promise<{ page: Page; stop: () => Promise<void> }> {
    await panelFiles({ "tabs.json": tabs });
    await startService();
    const served = await servePanel();
    const page = await browser.open(served.url);
    await page.waitFor(`document.querySelectorAll(".xterm").length >= 1 && document.body.innerText.includes("$")`, "the first shell");
    return {
        page,
        stop: async () => {
            await page.close();
            served.stop();
        },
    };
}

describe("the panel's screens", () => {
    test("a new tab takes the keyboard, and what is typed next reaches its shell, not the button", async () => {
        const { page, stop } = await opened(TABS);
        try {
            // New Tab: the button was clicked, yet typing goes to the new shell
            await page.click('button[aria-label="New Tab"]');
            await page.waitFor(`document.querySelectorAll(".xterm").length === 2`, "the second tab");
            await page.waitFor(keyboardInShownScreen, "the new tab to have the keyboard");

            // Enter on a button that kept the keyboard would open a third tab
            await page.insertText("echo typed-$((3+4))");
            await page.press("Enter");
            await page.waitFor(`[...document.querySelectorAll(".xterm")].find((x) => x.getClientRects().length)?.innerText.includes("typed-7")`, "the new shell to run what was typed");
            expect(callsTo(page, "create-tab")).toBe(1);
            expect((await serviceState<{ tabs: unknown[] }>()).tabs).toHaveLength(2);
            expect(await page.evaluate<number>(`document.querySelectorAll(".xterm").length`)).toBe(2);

            expect(page.exceptions).toEqual([]);
        } finally {
            await stop();
        }
    });

});
