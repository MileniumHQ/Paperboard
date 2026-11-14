import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { panelFiles, startService, stopServices } from "./helpers/service";

setDefaultTimeout(90_000);

const browser = panelBrowser();

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }], activeTabId: "tab1" };
const screen = `document.querySelector(".xterm-rows").innerText`;
const screenShows = (text: string) => `${screen}.includes(${JSON.stringify(text)})`;
const dialog = `document.querySelector("[role=dialog]")`;
const textarea = `document.querySelector(".xterm-helper-textarea")`;
// a clipboard paste into the terminal, as Ctrl+V delivers it
const paste = (page: Page, text: string) =>
    page.evaluate(`(() => { const dt = new DataTransfer(); dt.setData("text/plain", ${JSON.stringify(text)}); ${textarea}.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
const run = async (page: Page, line: string, shows: string) => {
    await page.evaluate(`${textarea}.focus()`);
    await page.insertText(line);
    await page.press("Enter");
    await page.waitFor(screenShows(shows), `the shell to print ${shows}`);
};

// Lines pasted at a prompt run as soon as they land, so the panel asks first.
describe("a paste that would run commands", () => {
    test("is asked about, and runs only once it is let through", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(screenShows("$"), "the prompt");
            // the test daemon's /bin/sh marks no prompt of its own: one is marked the way the shell
            // integration marks it (OSC 133 A), with bracketed paste off where /bin/sh is a bash
            // (a bracketed paste waits for Enter, so it isn't asked about)
            await run(page, `bind 'set enable-bracketed-paste off' 2> /dev/null; printf '\\033]133;A\\007'; echo ready-$((3*3))`, "ready-9");

            const lines = "echo one-$((1+1))\necho two-$((2+2))\n";
            await paste(page, lines);
            await page.waitFor(`${dialog}?.innerText.includes("Paste 2 lines?")`, "the paste to be asked about");
            expect(await page.evaluate<string>(`${dialog}.innerText`)).toContain("echo one-$((1+1))\necho two-$((2+2))");
            await page.clickText("[role=dialog] button", "Cancel");
            await page.waitFor(`!${dialog}`, "the question to close");
            await run(page, "echo after-$((5*5))", "after-25");
            expect(await page.evaluate<string>(screen)).not.toContain("one-2");

            await run(page, `printf '\\033]133;A\\007'; echo again-$((4*4))`, "again-16");
            await paste(page, lines);
            await page.waitFor(`${dialog}?.innerText.includes("Paste 2 lines?")`, "the paste to be asked about again");
            await page.clickText("[role=dialog] button", "Paste");
            await page.waitFor(`${screenShows("one-2")} && ${screenShows("two-4")}`, "both pasted lines to run");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
