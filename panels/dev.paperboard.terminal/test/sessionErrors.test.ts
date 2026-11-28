import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { clearWorkloads } from "./helpers/crane";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { panelFiles, PANEL_ID, startService, stopServices } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

setDefaultTimeout(90_000);

const browser = panelBrowser();

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const NOT_SAVED = "isn't being saved";
// the shell's warning, not a toast's
const warning = `[...document.querySelectorAll("[role=alert]")].find((el) => !el.closest("[data-paper-toasts]") && el.innerText.includes(${JSON.stringify(NOT_SAVED)}))`;
const screenShows = (text: string) => `(document.querySelector(".xterm-rows")?.innerText ?? "").includes(${JSON.stringify(text)})`;
const run = async (page: Page, line: string, shows: string) => {
    await page.evaluate(`document.querySelector(".xterm-helper-textarea").focus()`);
    await page.insertText(line);
    await page.press("Enter");
    await page.waitFor(screenShows(shows), `the shell to print ${shows}`);
};
const savingFails = (state: any) => Boolean(state.sessionErrors.tab1?.scrollback);

describe("a shell's warning that was put away", () => {
    test("shows again when it stops standing and comes back", async () => {
        const dir = await panelFiles({ "tabs.json": { tabs: [{ id: "tab1", label: "One" }], activeTabId: "tab1" } });
        await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        const scrollback = path.join(dir, "terminal-scrollback", "tab1.json");
        try {
            await page.waitFor(screenShows("$"), "the prompt");
            fs.chmodSync(scrollback, 0o444);
            await run(page, "echo one-$((1+1))", "one-2");
            await page.waitFor(`Boolean(${warning})`, "the warning that the scrollback isn't saved");
            await page.evaluate(`${warning}.querySelector("[aria-label=Dismiss]").click()`);
            await page.waitFor(`!${warning}`, "the warning to be put away");

            fs.chmodSync(scrollback, 0o644);
            await run(page, "echo two-$((2+2))", "two-4");
            await stateWhere(PANEL_ID, (state) => !savingFails(state), "the scrollback to save again");

            fs.chmodSync(scrollback, 0o444);
            await run(page, "echo three-$((3+3))", "three-6");
            await stateWhere(PANEL_ID, savingFails, "the scrollback to fail again");
            await page.waitFor(`Boolean(${warning})`, "the same warning to show again");
            expect(page.exceptions).toEqual([]);
        } finally {
            if (fs.existsSync(scrollback)) fs.chmodSync(scrollback, 0o644);
            await page.close();
            served.stop();
        }
    });
});
