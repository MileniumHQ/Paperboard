import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { PANEL_ID, panelFiles, runBlock, serviceState, startService, stopServices } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

setDefaultTimeout(90_000);

const browser = panelBrowser();

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

// the first tab is split; the second is a tab of its own. Neither was
// named, so each is called by what runs in it. The test daemon's shell is a
// plain sh, which marks nothing: bash marks each command it runs
const TABS = {
    tabs: [
        { id: "tab1", label: "Tab 1", shell: "/bin/bash", split: { direction: "right", session: { id: "pane1", shell: "/bin/bash" } } },
        { id: "tab2", label: "Tab 2" },
    ],
    activeTabId: "tab1",
};
const LOOP = "for i in 1 2 3; do sleep 300; done";
// a tab's tooltip: what it is called (the tab itself cuts a long one short), then its folder
const tooltip = (id: string) => `(() => { const el = document.querySelector('label[data-value="${id}"]'); return (el?.title || el?.querySelector('[title]')?.title || '').split(String.fromCharCode(10)); })()`;
const tabText = (id: string) => `${tooltip(id)}[0]`;
const dialog = `document.querySelector("[role=dialog]")`;

async function opened(): Promise<{ page: Page; stop: () => Promise<void> }> {
    await panelFiles({ "tabs.json": TABS });
    await startService();
    const served = await servePanel();
    const page = await browser.open(served.url);
    await stateWhere<any>(PANEL_ID, (s) => Boolean(s.live?.tab1?.program && s.live?.pane1?.program), "both shells of the first tab to run");
    await page.waitFor(`document.querySelectorAll(".xterm").length >= 2 && document.body.innerText.includes("$")`, "the shells");
    return {
        page,
        stop: async () => {
            await page.close();
            served.stop();
        },
    };
}

describe("a command running in a tab", () => {
    // what runs is the program in front, not the command line that started it
    test("names the tab by the program it runs, not the line typed, and the tab goes back to its shell's name after", async () => {
        const { page, stop } = await opened();
        try {
            await runBlock("type-in-tab", { tab: "tab1", text: `clear; ${LOOP}\n` });
            await stateWhere<any>(PANEL_ID, (s) => s.live?.tab1?.program === "sleep", "sleep in front of the loop");
            await page.waitFor(`${tabText("tab1")} === "sleep"`, "the tab named by the program in front");

            await runBlock("type-in-tab", { tab: "tab1", text: "\x03" });
            await page.waitFor(`${tabText("tab1")} === "bash"`, "the tab named by its shell again");
            expect(page.exceptions).toEqual([]);
        } finally {
            await stop();
        }
    });

    test("a tab's folder in the home folder shows from ~", async () => {
        const { page, stop } = await opened();
        try {
            await runBlock("type-in-tab", { tab: "tab1", text: "mkdir -p logs && cd logs\n" });
            await page.waitFor(`${tooltip("tab1")}[1] === "~/logs"`, "the folder from ~");
            await runBlock("type-in-tab", { tab: "tab1", text: "cd\n" });
            await page.waitFor(`${tooltip("tab1")}[1] === "~"`, "the home folder as ~");
            expect(page.exceptions).toEqual([]);
        } finally {
            await stop();
        }
    });

    test("closing its tab asks first, naming the command; Cancel keeps it running, Close Tab closes the tab and its split only, and an idle tab closes at once", async () => {
        const { page, stop } = await opened();
        try {
            await runBlock("type-in-tab", { tab: "tab1", text: "sleep 300\n" });
            await stateWhere<any>(PANEL_ID, (s) => s.live?.tab1?.program === "sleep", "sleep in front");
            await page.waitFor(`${tabText("tab1")} === "sleep"`, "the program running");

            await page.click('label[data-value="tab1"] button[aria-label="Close"]');
            await page.waitFor(`${dialog}?.innerText.includes("Stop sleep 300?")`, "the close, asked about by the command");
            await page.clickText("[role=dialog] button", "Cancel");
            await page.waitFor(`!${dialog}`, "the ask to close");
            expect((await serviceState<{ tabs: { id: string }[] }>()).tabs.map((t) => t.id)).toEqual(["tab1", "tab2"]);
            expect((await serviceState<{ live: Record<string, { program: string }> }>()).live.tab1.program).toBe("sleep");

            await page.click('label[data-value="tab1"] button[aria-label="Close"]');
            await page.clickText("[role=dialog] button", "Close Tab");
            const after = await stateWhere<{ tabs: { id: string; split?: unknown }[] }>(PANEL_ID, (s) => s.tabs.length === 1, "the tab to close");
            // its own split went with it; the other tab is untouched
            expect(after.tabs).toEqual([expect.objectContaining({ id: "tab2" })]);
            await page.waitFor(`!document.querySelector('label[data-value="tab1"]') && !document.querySelector('label[data-value="pane1"]') && document.querySelector('label[data-value="tab2"]')`, "only the other tab listed");

            await page.waitFor(`!${dialog}`, "the ask to close");
            // nothing runs in the other tab: it closes at once
            await page.click('label[data-value="tab2"] button[aria-label="Close"]');
            await stateWhere<{ tabs: { id: string }[] }>(PANEL_ID, (s) => !s.tabs.some((t) => t.id === "tab2"), "the idle tab to close");
            expect(await page.evaluate<boolean>(`!!${dialog}`)).toBe(false);
            expect(page.exceptions).toEqual([]);
        } finally {
            await stop();
        }
    });
});
