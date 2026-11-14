// Saved commands as a person uses them: added, run and removed in the panel's
// modal, run from the toolbar's menu, and run from the Home widget.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { alertShows, panelBrowser, servePanel, type Page } from "./helpers/browser";
import { call, panelFiles, startService, stopServices } from "./helpers/service";

setDefaultTimeout(90_000);

const browser = panelBrowser();

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }], activeTabId: "tab1" };
const dialog = `document.querySelector("[role=dialog]")`;
// the modal's row for a command: a list row, keyed by the command's id
const rowShowing = (label: string, text: string) =>
    `[...${dialog}.querySelectorAll("[data-value]")].some((row) => row.innerText.includes(${JSON.stringify(label)}) && row.innerText.includes(${JSON.stringify(text)}))`;
const press = (page: Page, selector: string) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

/** types into the modal's field with this label */
async function fill(page: Page, label: string, text: string) {
    await page.evaluate(`[...${dialog}.querySelectorAll("label")].find((l) => l.innerText.includes(${JSON.stringify(label)})).closest("div").querySelector("input").focus()`);
    await page.insertText(text);
}

describe("saved commands in the panel", () => {
    test("are added, run and removed in the modal, and a run the menu couldn't start is said there", async () => {
        await panelFiles({ "tabs.json": TABS });
        const service = await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the shell");
            await page.click('button[aria-label="Saved commands"]');
            await page.waitFor(`document.body.innerText.includes("No saved commands")`, "the empty menu");
            await page.clickText("[role=menuitem]", "Manage saved commands");
            await page.waitFor(dialog, "the modal");

            await fill(page, "Name", "Greet");
            await fill(page, "Command", "exit 0");
            await page.clickText("[role=dialog] button", "Save");
            await page.waitFor(rowShowing("Greet", "Not run yet"), "the saved command's row");
            await fill(page, "Name", "Fails");
            await fill(page, "Command", "exit 3");
            await page.press("Enter");
            await page.waitFor(rowShowing("Fails", "exit 3"), "the second row");

            await press(page, '[role=dialog] button[aria-label="Run Greet"]');
            await page.waitFor(rowShowing("Greet", "Exit 0"), "the run's exit");
            await press(page, '[role=dialog] button[aria-label="Run Fails"]');
            await page.waitFor(rowShowing("Fails", "Exit 3"), "the failing run's exit");

            await press(page, '[role=dialog] button[aria-label="Remove Fails"]');
            await page.waitFor(`!(${rowShowing("Fails", "exit 3")})`, "the removed row to go");
            expect(await page.evaluate<boolean>(rowShowing("Greet", "Exit 0"))).toBe(true);
            await page.press("Escape");
            await page.waitFor(`!${dialog}`, "the modal to close");

            // the service is gone: a run from the menu can't start, and the modal says why
            await service.crash();
            await page.click('button[aria-label="Saved commands"]');
            await page.clickText("[role=menuitem]", "Greet");
            await page.waitFor(`${dialog} && ${alertShows("Command not started", "run-saved-command")}`, "the refused run in the modal");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});

describe("the Pinned command widget", () => {
    // the widget's own document, in its frame
    const widget = (expr: string) => `(() => { const doc = document.getElementById("widget").contentDocument; return ${expr}; })()`;
    const shows = (text: string) => widget(`Boolean(doc?.body?.innerText.includes(${JSON.stringify(text)}))`);

    test("runs its command and shows the exit, then says when the command is removed", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const id = await call<string>("save-command", { label: "Build", command: "exit 3" });
        const served = await servePanel();
        const page = await browser.open(`${served.url}/widget-host.html?command=${id}`);
        try {
            await page.waitFor(`window.widgetSaid.includes("paperboard:ready")`, "the widget to be ready");
            await page.waitFor(shows("Not run yet"), "the command's tile");
            await page.evaluate(widget(`doc.querySelector('button[aria-label="Run Build"]').click()`));
            await page.waitFor(shows("Exit 3"), "the exit");

            await call("remove-saved-command", { id });
            await page.waitFor(shows("Command removed"), "the removed command to be said");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("says saved commands that can't be read, never that there are none", async () => {
        await panelFiles({ "tabs.json": TABS, "saved-commands.json": '{"version": 1, "commands": [' });
        await startService();
        const served = await servePanel();
        const page = await browser.open(`${served.url}/widget-host.html?command=anything`);
        try {
            await page.waitFor(shows("Saved commands unreadable"), "the unreadable file to be said");
            expect(await page.evaluate<boolean>(shows("Command removed"))).toBe(false);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
