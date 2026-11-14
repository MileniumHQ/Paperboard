import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import { clearWorkloads } from "./helpers/crane";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { panelFiles, serviceState, startService, stopServices } from "./helpers/service";
import { until } from "./helpers/wait";

setDefaultTimeout(90_000);

const browser = panelBrowser();

let readOnly: string | null = null;
afterEach(async () => {
    if (readOnly) fs.chmodSync(readOnly, 0o755);
    readOnly = null;
    await stopServices();
    await clearWorkloads();
});

const TABS = {
    tabs: [
        { id: "tab1", label: "One" },
        { id: "tab2", label: "Two" },
        { id: "tab3", label: "Three" },
    ],
    activeTabId: "tab1",
};

// which tab's screen is in view, by its place in the list (-1: none)
const shownScreen = `[...document.querySelectorAll(".xterm")].findIndex((x) => x.getClientRects().length > 0)`;

/** resolves once the page has opened every tab's screen and each open was answered */
async function screensOpened(page: Page, count: number): Promise<void> {
    const opens = () => page.sentFrames.filter((f) => f.includes(`"command.call-open-tab"`)).map((f) => JSON.parse(f).id);
    await until("the page to open every tab's screen", opens, (ids) => ids.length >= count);
    for (const id of opens()) await page.received((f) => JSON.parse(f).id === id, `the answer to open-tab ${id}`);
}

// A window mounts a screen for every tab, the hidden ones too, and each opens
// its shell. That is not the person choosing a tab: the tab they were on
// stays the one the next window opens on, and opening needs no save.
describe("opening a window", () => {
    test("keeps the tab in front as the one the next window opens on, even when the tabs can't be saved", async () => {
        const dir = await panelFiles({ "tabs.json": TABS });
        await startService();
        const served = await servePanel();
        const first = await browser.open(served.url);
        try {
            await screensOpened(first, 3);
            expect(await first.evaluate<number>(shownScreen)).toBe(0);
            expect((await serviceState<{ activeTabId: string }>()).activeTabId).toBe("tab1");
        } finally {
            await first.close();
        }

        // a full or read-only data folder: opening a shell writes nothing, so it still works
        fs.chmodSync(dir, 0o555);
        readOnly = dir;
        const second = await browser.open(served.url);
        try {
            await screensOpened(second, 3);
            expect(await second.evaluate<number>(shownScreen)).toBe(0);
            await second.waitFor(`[...document.querySelectorAll(".xterm")].find((x) => x.getClientRects().length)?.innerText.includes("$")`, "the shell in front's prompt");
            expect(await second.evaluate<string>(`document.body.innerText`)).not.toContain("Could not open this terminal");
            expect((await serviceState<{ activeTabId: string }>()).activeTabId).toBe("tab1");
            expect(second.exceptions).toEqual([]);
        } finally {
            await second.close();
            served.stop();
        }
    });
});
