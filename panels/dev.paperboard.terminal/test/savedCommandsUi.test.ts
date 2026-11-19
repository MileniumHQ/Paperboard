// Saved commands as a person uses them: added, run and removed in the panel's
// modal, run from the toolbar's menu, and run from the Home widget.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
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
    test("at 680 by 510, with a full list, the form to add one is in view beside the list", async () => {
        const commands = ["Disk use", "Sync log", "Backups", "Ports"].map((label, i) => ({ id: `cmd_${i}`, label, command: `du -sh ~/data${i}` }));
        const lastRuns = Object.fromEntries(
            commands.map((c, i) => [c.id, { state: "exited", startedAt: 1000, endedAt: 2000, exitCode: 0, output: Array.from({ length: 4 }, (_, n) => `${n + 1}.${i}G\t/home/ada/data${i}/part${n}`).join("\n") }]),
        );
        await panelFiles({ "tabs.json": TABS, "saved-commands.json": { version: 1, commands, lastRuns, running: [] } });
        await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.resize(680, 510);
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the shell");
            await openManager(page);
            await page.waitFor(rowShowing("Ports", "part3"), "the last command's output");
            const inView = (selector: string) =>
                `(() => { const r = ${dialog}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; })()`;
            const saveButton = `[...${dialog}.querySelectorAll("button")].find((b) => b.innerText.includes("Save"))`;
            await page.evaluate(`${saveButton}.dataset.test = "save"`);
            expect(await page.evaluate<boolean>(inView("input"))).toBe(true);
            expect(await page.evaluate<boolean>(inView('[data-test="save"]'))).toBe(true);
            // every row is still there to reach, by scrolling the list
            await page.evaluate(`${dialog}.querySelector('[data-value="cmd_3"]').scrollIntoView()`);
            expect(await page.evaluate<boolean>(inView('[data-value="cmd_3"]'))).toBe(true);
            expect(await page.evaluate<boolean>(inView('[data-test="save"]'))).toBe(true);
        } finally {
            await page.close();
            served.stop();
        }
    });

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
    test("the list is its own card beside the text and the form, and the Save button is as tall as its field", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the shell");
            await openManager(page);
            await fill(page, "Command", "uptime -p");
            await page.press("Enter");
            await page.waitFor(rowShowing("uptime -p", "Not run yet"), "the saved command's row");
            const looks = await page.evaluate<{ borders: number[]; radius: number; save: number; field: number }>(`(() => {
                const list = ${dialog}.querySelector("[data-value]").closest("[class*='_PaperList_']");
                const style = getComputedStyle(list);
                const save = [...${dialog}.querySelectorAll("button")].find((b) => b.innerText.trim().endsWith("Save"));
                const field = [...${dialog}.querySelectorAll("label")].find((l) => l.innerText.includes("Command")).closest("[class*='_PaperInput_']");
                return {
                    borders: ["Top", "Right", "Bottom", "Left"].map((side) => parseFloat(style["border" + side + "Width"])),
                    radius: parseFloat(style.borderTopLeftRadius),
                    save: save.getBoundingClientRect().height,
                    field: field.getBoundingClientRect().height,
                };
            })()`);
            expect(looks.borders.every((width) => width > 0)).toBe(true);
            expect(looks.radius).toBeGreaterThan(0);
            expect(looks.save).toBe(looks.field);
        } finally {
            await page.close();
            served.stop();
        }
    });

    // the modal's error in place of the list, saying why: never a toast, which would go while the file stays unread
    const failure = `${dialog}?.querySelector("[data-paper-error][role=region][aria-label=\\"Couldn't read the saved commands\\"]")`;
    const tryAgain = `[...(${failure}?.querySelectorAll("button") ?? [])].find((b) => b.innerText.includes("Try again"))`;

    test("saved commands that can't be read say why in the modal, in place of the list, and no toast", async () => {
        await panelFiles({ "tabs.json": TABS, "saved-commands.json": '{"version": 1, "commands": [' });
        await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the shell");
            await page.click('button[aria-label="Saved commands"]');
            await page.clickText("[role=menuitem]", "Manage saved commands");
            await page.waitFor(`Boolean(${failure}?.innerText.includes("Saved commands could not be read"))`, "the modal's error saying why");
            expect(await page.evaluate<boolean>(`Boolean(${tryAgain})`)).toBe(true);
            expect(await page.evaluate<boolean>(`${dialog}.innerText.includes("No saved commands")`)).toBe(false);
            expect(await page.evaluate<boolean>(toastShows("Couldn't read the saved commands", ""))).toBe(false);
            // the error is the modal's: it goes with it
            await page.press("Escape");
            await page.waitFor(`!${dialog} && !document.querySelector("[data-paper-error]")`, "the modal and its error to close");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("Try again reads them again: still damaged, the error stays and says why; mended, the list comes", async () => {
        const dir = await panelFiles({ "tabs.json": TABS, "saved-commands.json": '{"version": 1, "commands": [' });
        await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the shell");
            await page.click('button[aria-label="Saved commands"]');
            await page.clickText("[role=menuitem]", "Manage saved commands");
            await page.waitFor(`Boolean(${tryAgain})`, "Try again on the modal's error");
            // still damaged: the read again is refused, and the error says so with Try again ready once more
            await page.evaluate(`${tryAgain}.click()`);
            await page.waitFor(`Boolean(${tryAgain}) && !${tryAgain}.disabled && ${failure}.innerText.includes("Saved commands could not be read")`, "the error still saying why");
            expect(await page.evaluate<boolean>(toastShows("Couldn't read the saved commands", ""))).toBe(false);

            fs.writeFileSync(path.join(dir, "saved-commands.json"), JSON.stringify({ version: 1, commands: [{ id: "cmd_a", label: "Build", command: "make" }], lastRuns: {}, running: [] }));
            await page.evaluate(`${tryAgain}.click()`);
            await page.waitFor(rowShowing("Build", "make"), "the list read again");
            expect(await page.evaluate<boolean>(`Boolean(${failure})`)).toBe(false);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("a failed run shows what it printed, an unnamed command is said once, and a labelled field doesn't repeat its label as a placeholder", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const command = "echo before-the-error; ls /nonexistent-qa";
        const id = await call.saveCommand({ label: "", command });
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the shell");
            await openManager(page);
            expect(await page.evaluate<string[]>(`[...${dialog}.querySelectorAll("input")].map((i) => i.placeholder).filter(Boolean)`)).toEqual([]);
            expect(await page.evaluate<boolean>(`[...${dialog}.querySelectorAll("input")].some((i) => i.placeholder === "git pull")`)).toBe(false);
            // the row names the command once
            const row = `${dialog}.querySelector('[data-value="${id}"]')`;
            await page.waitFor(row, "the command's row");
            expect(await page.evaluate<number>(`${row}.innerText.split(${JSON.stringify(command)}).length - 1`)).toBe(1);

            await press(page, `[role=dialog] button[aria-label="Run ${command}"]`);
            // why it failed: the last lines it printed, stderr with stdout
            await page.waitFor(`${row}.innerText.includes("Exit 2") && ${row}.innerText.includes("before-the-error") && /No such file/.test(${row}.innerText)`, "the failed run's output");
            expect(await page.evaluate<number>(`${row}.innerText.split(${JSON.stringify(command)}).length - 1`)).toBe(1);
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

    test("says saved commands that can't be read, never that there are none", async () => {
        await panelFiles({ "tabs.json": TABS, "saved-commands.json": '{"version": 1, "commands": [' });
        await startService();
        const served = await servePanel();
        const page = await browser.open(widgetUrl(served.url, "pinned-command", { command: "anything" }, { w: 2, h: 1 }));
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
