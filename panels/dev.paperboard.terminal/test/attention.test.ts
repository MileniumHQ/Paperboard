import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { call, panelFiles, runBlock, startService, stopServices } from "./helpers/service";
import { within } from "./helpers/wait";

setDefaultTimeout(90_000);

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }, { id: "tab2", label: "Two" }], activeTabId: "tab1" };
// what a tab's entry in the tab list shows in front of its title
const item = (tab: string) => `document.querySelector('label[data-value="${tab}"]')`;
const rangBell = (tab: string) => `${item(tab)}?.innerText.includes("notifications_active")`;
const finishedMark = (tab: string) => `Boolean(${item(tab)}?.querySelector("svg [class*=success]"))`;
const plain = (tab: string) => `(${item(tab)}?.innerText.includes("terminal") && !${item(tab)}?.querySelector("svg"))`;
const frames = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`;
// A hidden screen draws nothing, so what it was written can't be read off it.
// It has the scrollback once the page has its answer to open-tab; xterm
// parses a write on its next task, so after that and a few frames the bell
// in it has rung, or never will.
async function replayed(page: Page, what: string): Promise<void> {
    await within(what, (async () => {
        while (!page.frames.some((f) => f.startsWith("<") && f.includes("rang-42"))) await Bun.sleep(20);
    })());
    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 100))`);
    await page.evaluate(frames);
}

// /bin/sh marks no commands of its own, so the command's end is marked the
// way bash's integration marks it (OSC 133 C, then D with the exit code)
const BELL = `printf 'rang-%s\\007\\n' $((6*7))\n`;
const FINISHED = `printf '\\033]133;C\\007\\033]133;D;0\\007done-%s\\n' $((5*5))\n`;

async function opened(): Promise<{ page: Page; stop: () => Promise<void> }> {
    const served = await servePanel();
    const page = await openPage(served.url);
    await page.waitFor(`document.querySelectorAll(".xterm").length === 2 && document.body.innerText.includes("$")`, "both tabs");
    return {
        page,
        stop: async () => {
            await page.close();
            served.stop();
        },
    };
}

// A tab in the background that rang its bell or finished a command says so
// in the tab list, until it is looked at.
describe("what a hidden tab did", () => {
    test("its bell and finished marks clear when the tab is looked at, and stay cleared", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const { page, stop } = await opened();
        try {
            await runBlock("type-in-tab", { tab: "tab2", text: BELL });
            // the bell shows once the output's busy mark has passed
            await page.waitFor(rangBell("tab2"), "the hidden tab to show its bell");
            await runBlock("type-in-tab", { tab: "tab2", text: FINISHED });
            await page.waitFor(finishedMark("tab2"), "the hidden tab to show its command finished");

            await page.click('label[data-value="tab2"]');
            await page.waitFor(`document.querySelectorAll(".xterm")[1].getClientRects().length > 0`, "the second tab to show");
            await page.waitFor(plain("tab2"), "the tab looked at to show neither mark");
            await page.click('label[data-value="tab1"]');
            await page.waitFor(`document.querySelectorAll(".xterm")[0].getClientRects().length > 0`, "the first tab to show");
            // a screen that is put away may still print (its shell answering the resize), which shows as
            // busy for a moment; once that has passed, neither the bell nor the finished mark is back
            await page.waitFor(plain("tab2"), "the tab looked at to stay without either mark");

            expect(page.exceptions).toEqual([]);
        } finally {
            await stop();
        }
    });

    test("a bell in the scrollback does not mark its tab again after a reload", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        // the bell rings while no window is open, so it lives only in the scrollback
        await call("open-tab", { id: "tab2", cols: 80, rows: 24 });
        await runBlock("type-in-tab", { tab: "tab2", text: BELL });
        await within(
            "the scrollback to hold the bell",
            (async () => {
                while (!(await call<string>("open-tab", { id: "tab2", cols: 80, rows: 24 })).includes("rang-42\u0007")) await Bun.sleep(50);
            })(),
        );
        // opening a tab makes it the one a window opens on: the first is again
        await call("touch-tab", { id: "tab1" });
        const { page, stop } = await opened();
        try {
            // the hidden tab's screen has written its scrollback, bell and all
            await replayed(page, "the hidden tab to replay its scrollback");
            await page.evaluate(frames);
            expect(await page.evaluate<boolean>(plain("tab2"))).toBe(true);

            // and a reload replays it again, still without marking the tab
            page.frames.length = 0;
            await page.reload();
            await page.waitFor(`document.querySelectorAll(".xterm").length === 2`, "both tabs after the reload");
            await replayed(page, "the hidden tab to replay its scrollback after the reload");
            await page.evaluate(frames);
            expect(await page.evaluate<boolean>(plain("tab2"))).toBe(true);

            expect(page.exceptions).toEqual([]);
        } finally {
            await stop();
        }
    });
});
