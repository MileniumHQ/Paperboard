import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { panelFiles, serviceState, startService, stopServices } from "./helpers/service";

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
// the screens in view, in order, and which of them has the keyboard (-1: none)
const keyboardScreen = `(() => {
    const shown = [...document.querySelectorAll(".xterm")].filter((x) => x.getClientRects().length);
    return shown.indexOf(document.activeElement?.closest(".xterm"));
})()`;
// the calls the page made to the service, by name
const callsTo = (page: Page, name: string) => page.frames.filter((f) => f.startsWith(">") && f.includes(`"command.call-${name}"`)).length;

async function opened(tabs: unknown): Promise<{ page: Page; stop: () => Promise<void> }> {
    await panelFiles({ "tabs.json": tabs });
    await startService();
    const served = await servePanel();
    const page = await openPage(served.url);
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

    test("a split gives its new shell the keyboard", async () => {
        const { page, stop } = await opened(TABS);
        try {
            await page.click('button[aria-label="Split"]');
            await page.clickText("[role=menuitem]", "Split Right");
            await page.waitFor(`document.querySelectorAll(".xterm").length === 2`, "the second shell");
            await page.waitFor(`${keyboardScreen} === 1`, "the new shell to have the keyboard");

            expect(page.exceptions).toEqual([]);
        } finally {
            await stop();
        }
    });

    test("closing the tab in front gives the keyboard to the tab that comes forward", async () => {
        const { page, stop } = await opened({ tabs: [{ id: "tab1", label: "One" }, { id: "tab2", label: "Two" }], activeTabId: "tab2" });
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 2`, "both tabs");
            await page.click('label[data-value="tab2"] button[aria-label="Close"]');
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the tab to close");
            await page.waitFor(keyboardInShownScreen, "the first tab's shell to have the keyboard");

            expect(page.exceptions).toEqual([]);
        } finally {
            await stop();
        }
    });
});
