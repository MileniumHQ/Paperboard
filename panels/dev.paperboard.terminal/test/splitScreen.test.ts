import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { answered, panelBrowser, servePanel } from "./helpers/browser";
import { PANEL_ID, panelFiles, runBlock, startService, stopServices } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

setDefaultTimeout(90_000);

const browser = panelBrowser();

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }], activeTabId: "tab1" };
// the first shell's screen: the first xterm of the tab's layer
const firstScreen = `document.querySelectorAll(".xterm")[0]`;

// A split puts a second shell beside the first. The first is the same live
// screen before, during and after: splitting or closing the split never
// rebuilds it, so what it showed stays and nothing is fetched again.
describe("splitting a tab", () => {
    test("Split and Close Split keep the first shell's screen and what it showed", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1 && document.body.innerText.includes("$")`, "the first shell");
            // output only the shell makes: the command line itself does not show it
            await runBlock("type-in-tab", { tab: "tab1", text: "echo first-$((40+2))\n" });
            await page.waitFor(`${firstScreen}.querySelector(".xterm-rows").innerText.includes("first-42")`, "the first shell's output");
            await page.evaluate(`${firstScreen}.dataset.kept = "yes"`);

            await page.click('button[aria-label="Split"]');
            await page.clickText("[role=menuitem]", "Split Right");
            await page.waitFor(`document.querySelectorAll(".xterm").length === 2`, "the second shell");
            await page.waitFor(`document.querySelector('button[aria-label="Close Split"]')`, "the split to show");
            expect(await page.evaluate<string | undefined>(`${firstScreen}.dataset.kept`)).toBe("yes");
            expect(await page.evaluate<string>(`${firstScreen}.querySelector(".xterm-rows").innerText`)).toContain("first-42");

            await page.click('button[aria-label="Close Split"]');
            await page.waitFor(`document.querySelectorAll(".xterm").length === 1`, "the split to close");
            expect(await page.evaluate<string | undefined>(`${firstScreen}.dataset.kept`)).toBe("yes");
            expect(await page.evaluate<string>(`${firstScreen}.querySelector(".xterm-rows").innerText`)).toContain("first-42");

            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    // A program writes for the size its screen is: a line that wraps, then a
    // move up over it, as a shell redraws the line it is editing. Shown
    // again in a window of another size, the second shell's screen is what
    // it was, not drawn over the line above it.
    test("a split's second shell shows what it showed after a reload at another size", async () => {
        await panelFiles({ "tabs.json": { tabs: [{ id: "tab1", label: "One", split: { direction: "right", session: { id: "pane1" } } }], activeTabId: "tab1" } });
        await startService();
        const served = await servePanel();
        const rows = `[...document.querySelectorAll(".xterm")[1].querySelectorAll(".xterm-rows > div")].map((r) => r.textContent.trimEnd()).filter(Boolean)`;
        let page = await browser.open(served.url);
        try {
            await page.resize(900, 700);
            await stateWhere<any>(PANEL_ID, (s) => Boolean(s.live?.tab1?.program && s.live?.pane1?.program), "both shells to run");
            await answered(page);
            await page.evaluate(`document.querySelectorAll(".xterm")[1].querySelector("textarea").focus()`);
            // a line five past the screen's width, then up the one row it wrapped onto
            await page.insertText(`w=$(stty size | cut -d' ' -f2); printf "%$((w+5))s\\033[1A\\rdrawn-over\\n" end; echo done-$((6*7))`);
            await page.press("Enter");
            await page.waitFor(`${rows}.some((r) => r.startsWith("done-42"))`, "the second shell's output");
            const before = await page.evaluate<string[]>(rows);
            expect(before[0]).toStartWith("$ w=$(stty size");
            expect(before.some((r) => r.startsWith("drawn-over"))).toBe(true);
        } finally {
            await page.close();
        }
        page = await browser.open(served.url);
        try {
            await page.resize(1300, 700);
            await page.waitFor(`${rows}.some((r) => r.startsWith("done-42"))`, "the second shell's output again");
            await answered(page);
            const after = await page.evaluate<string[]>(rows);
            // the command line is still there, and the move up landed on the line that wrapped
            expect(after[0]).toStartWith("$ w=$(stty size");
            expect(after.some((r) => r.startsWith("drawn-over"))).toBe(true);
            expect(after.find((r) => r.startsWith("done-42"))).toBe("done-42");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    // a desktop window at 860 leaves the panel about 620 wide: a side list there would leave each shell a third of that
});
