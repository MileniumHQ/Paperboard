// Saved commands as a person uses them: added, run and removed in the panel's
// modal, run from the toolbar's menu, and run from the Home widget.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { widgetUrl } from "testkit/panelUi";
import { panelBrowser, toastShows, servePanel, type Page } from "./helpers/browser";
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

/**
 * Opens the saved-commands modal from the toolbar and waits until its first
 * field has the keyboard: the modal focuses it as it opens, so a field
 * focused before then loses the keyboard to it mid-typing.
 */
async function openManager(page: Page) {
    await page.click('button[aria-label="Saved commands"]');
    await page.clickText("[role=menuitem]", "Manage saved commands");
    await page.waitFor(dialog, "the modal");
    await page.waitFor(`document.activeElement?.labels?.[0]?.textContent.trim() === "Name (optional)"`, "the name field to have the keyboard");
}

/** types into the modal's field with this label */
async function fill(page: Page, label: string, text: string) {
    await page.evaluate(`[...${dialog}.querySelectorAll("label")].find((l) => l.innerText.includes(${JSON.stringify(label)})).closest("div").querySelector("input").focus()`);
    await page.insertText(text);
}

describe("saved commands in the panel", () => {
    // a small window: the list scrolls under a form that stays in view
    test("are added, run and removed in the modal, and a run the menu couldn't start is said in a toast", async () => {
        await panelFiles({ "tabs.json": TABS });
        const service = await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the shell");
            await page.click('button[aria-label="Saved commands"]');
            await page.waitFor(`document.body.innerText.includes("No saved commands")`, "the empty menu");
            await page.press("Escape");
            // its first field has the keyboard, so a name can be typed at once
            await openManager(page);

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

            // the service is gone: a run from the menu can't start, and a toast says why
            await service.crash();
            await page.click('button[aria-label="Saved commands"]');
            await page.clickText("[role=menuitem]", "Greet");
            await page.waitFor(toastShows("Couldn't start the command", "run-saved-command"), "the refused run's toast");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    // Inventory: Data loss — what is typed into the form while a command saves is kept, and a refused save gives its text back.
    test("the form empties the moment a command is saved, keeps what is typed while it saves, and takes its text back when the save is refused", async () => {
        await panelFiles({ "tabs.json": TABS });
        const service = await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        // the form's fields, set as typing sets them, and the Save button
        const FORM = `(() => {
            const field = (label) => [...${dialog}.querySelectorAll("label")].find((l) => l.innerText.includes(label)).closest("div").querySelector("input");
            const type = (label, text) => { const input = field(label); input.value = text; input.dispatchEvent(new InputEvent("input", { bubbles: true })); };
            const values = () => [field("Name").value, field("Command").value];
            const save = () => [...${dialog}.querySelectorAll("button")].find((b) => b.innerText.includes("Save")).click();
            return { type, values, save };
        })()`;
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the shell");
            await openManager(page);
            // in one turn of the page: the save cannot have come back before the form is read and typed into
            const atOnce = await page.evaluate<string[]>(`(() => {
                const form = ${FORM};
                form.type("Name", "Greet"); form.type("Command", "exit 0");
                form.save();
                const emptied = form.values();
                form.type("Name", "Fails"); form.type("Command", "exit 3");
                return emptied;
            })()`);
            expect(atOnce).toEqual(["", ""]);
            await page.waitFor(rowShowing("Greet", "Not run yet"), "the first command's row");
            // the first save came back, and left the next command as it was typed
            expect(await page.evaluate<string[]>(`${FORM}.values()`)).toEqual(["Fails", "exit 3"]);
            await page.evaluate(`${FORM}.save()`);
            await page.waitFor(rowShowing("Fails", "exit 3"), "the second command's row, under the name typed while the first saved");

            // the service is gone: the save is refused, and what was sent is back in the form
            await service.crash();
            await page.evaluate(`(() => { const form = ${FORM}; form.type("Name", "Lost"); form.type("Command", "exit 9"); form.save(); })()`);
            await page.waitFor(toastShows("Couldn't save the command", ""), "the refused save's toast");
            await page.waitFor(`JSON.stringify(${FORM}.values()) === JSON.stringify(["Lost", "exit 9"])`, "the refused command back in the form");
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
