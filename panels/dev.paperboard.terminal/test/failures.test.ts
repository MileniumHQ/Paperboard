import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { call, panelFiles, startService, stopServices } from "./helpers/service";

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

// Failures are shown.
describe("failures are shown", () => {
    test("a write into a session that couldn't be created and an open that failed reject with the daemon's reason", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const write = call("write-to-terminal", { tabId: REFUSED, text: "echo hi\n" });
        await expect(write).rejects.toThrow(`Terminal session "${REFUSED}" could not be created; keystrokes were not sent:`);
        await expect(write).rejects.toThrow(DAEMON_REASON);
        await expect(call("open-tab", { id: REFUSED, cols: 80, rows: 24 })).rejects.toThrow(DAEMON_REASON);
        // the other tab is unaffected
        expect(typeof (await call("open-tab", { id: "tab1", cols: 80, rows: 24 }))).toBe("string");
    });

    test("in the panel, a terminal that can't open, a lost session, a refused rename and a refused new tab say why", async () => {
        await panelFiles({ "tabs.json": TABS });
        const service = await startService();
        const served = await servePanel();
        const page = await openPage(served.url);
        try {
            // the active tab's shell could not start: its screen says why, never blank
            await page.waitFor(screenShows(1, `Could not open this terminal: Request failed: ${DAEMON_REASON}`), "the refused tab to say why");

            // a keystroke the daemon refuses (a paste past the 64 KiB one
            // write may carry): the terminal says it lost the session, and why
            await page.click('label[data-value="tab1"]');
            await page.waitFor(screenShows(0, "$"), "the working tab's prompt");
            await page.evaluate(`document.querySelectorAll(".xterm-helper-textarea")[0].focus()`);
            await page.insertText("y".repeat(70_000));
            await page.waitFor(
                screenShows(0, 'Lost this terminal: Request failed: Parameter "data" exceeds 65536 characters'),
                "the refused write to be reported",
            );
            expect(await page.evaluate<string>(`(${screens})[0]`)).toContain("Press any key to try again.");

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
