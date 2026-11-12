import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { clearWorkloads, testDaemon } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { call, panelFiles, runBlock, startService, stopServices } from "./helpers/service";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

// A tab the daemon refuses to start a shell for: its id is longer than the
// 128 characters a session id may be (a tabs.json from elsewhere), so every
// create, probe and attach for it is refused with the daemon's reason.
const REFUSED = "t".repeat(140);
const DAEMON_REASON = 'Parameter "id" exceeds 128 characters';
const TABS = { tabs: [{ id: "tab1", label: "Works" }, { id: REFUSED, label: "Refused" }], activeTabId: REFUSED };

// the text each tab's xterm shows, by its tab's place in the list
const screens = `[...document.querySelectorAll(".xterm-rows")].map((rows) => rows.innerText)`;
const screenShows = (index: number, text: string) => `(${screens})[${index}]?.includes(${JSON.stringify(text)})`;
const alertShows = (title: string, text: string) =>
    `[...document.querySelectorAll("[role=alert]")].some((q) => q.innerText.includes(${JSON.stringify(title)}) && q.innerText.includes(${JSON.stringify(text)}))`;

const textarea = `document.querySelectorAll(".xterm-helper-textarea")[0]`;
// a clipboard paste into the first terminal, as Ctrl+V delivers it; `text` is a page expression
const paste = (page: Page, text: string) =>
    page.evaluate(`(() => { const dt = new DataTransfer(); dt.setData("text/plain", ${text}); ${textarea}.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
// Enter, down and up, so xterm takes typed text again after it
const pressEnter = (page: Page) =>
    page.evaluate(`for (const type of ["keydown", "keyup"]) ${textarea}.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }))`);

// Failures are shown.
describe("failures are shown", () => {
    test("a write into a session that couldn't be created and an open that failed reject with the daemon's reason", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const write = runBlock("type-in-tab", { tab: REFUSED, text: "echo hi\n" });
        await expect(write).rejects.toThrow(`Terminal session "${REFUSED}" could not be created; keystrokes were not sent:`);
        await expect(write).rejects.toThrow(DAEMON_REASON);
        await expect(call("open-tab", { id: REFUSED, cols: 80, rows: 24 })).rejects.toThrow(DAEMON_REASON);
        // the other tab is unaffected
        expect(typeof (await call("open-tab", { id: "tab1", cols: 80, rows: 24 }))).toBe("string");
    });

    test("in the panel, a terminal that can't open, a large paste, a refused rename and a refused new tab say why", async () => {
        await panelFiles({ "tabs.json": TABS });
        const service = await startService();
        const served = await servePanel();
        const page = await openPage(served.url);
        try {
            // the active tab's shell could not start: its screen says why, never blank
            await page.waitFor(screenShows(1, `Could not open this terminal: Request failed: ${DAEMON_REASON}`), "the refused tab to say why");

            // a paste past the 64 KiB one daemon write may carry reaches the
            // shell whole and in order; one past the panel's paste cap is
            // refused whole, says why, and leaves the session working
            await page.click('label[data-value="tab1"]');
            await page.waitFor(screenShows(0, "$"), "the working tab's prompt");
            await page.evaluate(`document.querySelectorAll(".xterm-helper-textarea")[0].focus()`);
            const lines = Array.from({ length: 100 }, (_, i) => `${String(i).padStart(3, "0")}${"y".repeat(997)}\n`).join("");
            await page.insertText(`echo reading-$((0+1)); head -n 100 > "$HOME/paste.txt"; echo pasted-$((1+1))`);
            await pressEnter(page);
            // the shell turns bracketed paste off before it runs the line, so
            // once the line's first output shows, head reads the paste bare
            await page.waitFor(screenShows(0, "reading-1"), "the shell to run the line");
            await paste(page, JSON.stringify(lines));
            await page.waitFor(screenShows(0, "pasted-2"), "the pasted lines to be read");
            expect(fs.readFileSync(path.join((await testDaemon()).home, "paste.txt"), "utf8")).toBe(lines);
            await paste(page, `"z".repeat(${17 * 1024 * 1024})`);
            await page.waitFor(alertShows("Nothing pasted", "a terminal takes at most 16 MB at once. Nothing was sent."), "the refused paste");
            await page.insertText("echo alive-$((2+2))");
            await pressEnter(page);
            await page.waitFor(screenShows(0, "alive-4"), "the session to keep working");
            expect(await page.evaluate<string>(`(${screens})[0]`)).not.toContain("Lost this terminal");

            // a rename the service refuses (the tab was closed from another
            // window meanwhile) keeps the modal open with the reason
            await page.evaluate(`document.querySelector('label[data-value="tab1"]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 10 }))`);
            await page.waitFor(`[...document.querySelectorAll("[data-context-item]")].some((i) => i.innerText.includes("Rename Tab"))`, "the tab menu");
            await page.evaluate(`[...document.querySelectorAll("[data-context-item]")].find((i) => i.innerText.includes("Rename Tab")).click()`);
            await page.waitFor(`document.querySelector("[role=dialog] input")`, "the rename modal");
            await call("close-tab", { id: "tab1" });
            await page.waitFor(`!document.querySelector('label[data-value="tab1"]')`, "the closed tab to leave the tab bar");
            await page.evaluate(`document.querySelector("[role=dialog] input").select()`);
            await page.insertText("Renamed");
            await page.evaluate(`[...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.trim() === "Save").click()`);
            await page.waitFor(alertShows("Tab not renamed", 'Unknown terminal tab "tab1"'), "the refused rename");
            expect(await page.evaluate<boolean>(`Boolean(document.querySelector("[role=dialog] input"))`)).toBe(true);
            await page.evaluate(`[...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.trim() === "Cancel").click()`);
            await page.waitFor(`!document.querySelector("[role=dialog] input")`, "the rename modal to close");

            // with the service gone, a new tab can't open, and the panel says so
            await service.crash();
            await page.click('button[aria-label="New Tab"]');
            await page.waitFor(alertShows("Tab not opened", "create-tab"), "the refused new tab");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
