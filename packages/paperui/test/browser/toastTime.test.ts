// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

const TOAST = "[data-paper-toasts] [role]";
type Box = { left: number; right: number; bottom: number };
type Line = { duration: string; state: string; time: number; scale: number; color: string; line: Box; toast: Box };
const line = () => page.eval<Line | null>("t.line()");
const toasts = () => page.eval<number>(`document.querySelectorAll('${TOAST}').length`);

/**
 * Lets `ms` of real time pass. What is tested here is that a held toast
 * outlives its own time, which only time passing can show.
 */
async function letPass(ms: number) {
    // quiet: the toast must outlive its time while held; no event says that, only the clock
    await page.waitFor(`(window.until ??= performance.now() + ${ms}) && performance.now() > window.until && !(window.until = undefined)`, `${ms}ms to pass`, ms + 5000);
}

/**
 * Whether the code block under `root` reads whole: nothing scrolls sideways,
 * and no line of it sits under its copy button.
 */
const READS_WHOLE = (root: string) => `(() => {
    const pre = document.querySelector(${JSON.stringify(`${root} pre`)});
    const button = document.querySelector(${JSON.stringify(`${root} [aria-label="Copy code"]`)}).getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(pre);
    const covered = [...range.getClientRects()].some((r) => r.width > 0 && r.left < button.right && button.left < r.right && r.top < button.bottom && button.top < r.bottom);
    return { scrolls: pre.scrollWidth > pre.clientWidth + 1, covered };
})()`;

// Inventory: PaperToast — every toast goes by itself, and says how long it has left.
describe("a toast that goes by itself", () => {
    test("a danger toast goes after ten seconds, its red line hugging the bottom and shrinking as it runs out", async () => {
        page = await browser.open("toastTime");
        await page.eval(`t.fail("Couldn't save the server", "The disk is full")`);
        await page.waitFor(`document.querySelector('${TOAST}')`, "the failure toast");
        const start = await line();
        expect(start?.duration).toBe("10s");
        // the line is in the toast's colour: the same red as its icon
        expect(start?.color).toBe(await page.eval(`getComputedStyle(document.querySelector('${TOAST} > :first-child')).color`));
        // the toast's whole bottom edge, from its very left to its very right
        expect(Math.abs(start!.line.left - start!.toast.left)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(start!.line.right - start!.toast.right)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(start!.line.bottom - start!.toast.bottom)).toBeLessThanOrEqual(0.5);
        await page.waitFor(`t.line()?.time > 1000`, "a second of its time to pass");
        const later = await line();
        expect(later?.scale).toBeLessThan(0.95);
        expect(later?.scale).toBeGreaterThan(0);
        // a failure is never kept on screen: it goes by itself
        await page.waitFor(`!document.querySelector('${TOAST}')`, "the danger toast to go by itself", 15_000);
    });

    test("at phone width a toast's Details wrap long lines, and the copy button covers none", async () => {
        page = await browser.open("toastTime", { width: 390, height: 844, touch: true });
        await page.eval(`t.show({ variant: "danger", title: "Couldn't install the server", message: "SteamCMD exited with code 8", details: "Logging in anonymously...\\nERROR! Failed to install app '2394010' (Disk write failure) into /srv/paperboard/servers/palworld-community/steamapps/common/PalServer", duration: 60000 })`);
        await page.waitFor(`document.querySelector('${TOAST} button[aria-expanded="false"]')`, "the toast's Details");
        await page.click(`${TOAST} button[aria-expanded="false"]`);
        await page.waitFor(`document.querySelector('${TOAST} button[aria-expanded="true"]')`, "the details to open");
        expect(await page.eval(READS_WHOLE(TOAST))).toEqual({ scrolls: false, covered: false });
    });

    test("warning toasts stay ten seconds too, and the rest six", async () => {
        page = await browser.open("toastTime");
        await page.eval(`t.show({ variant: "warning", title: "Can't follow backups" })`);
        await page.waitFor("t.line()", "the warning toast");
        expect((await line())?.duration).toBe("10s");
        await page.eval(`document.querySelector('${TOAST} [aria-label="Close"]').click()`);
        await page.waitFor(`!document.querySelector('${TOAST}')`, "the warning toast to close");
        await page.eval(`t.show({ variant: "success", title: "Saved" })`);
        await page.waitFor("t.line()", "the success toast");
        expect((await line())?.duration).toBe("6s");
    });

    test("pointing at it holds its time and its line; leaving lets both run on from where they were", async () => {
        page = await browser.open("toastTime");
        await page.eval(`t.show({ variant: "danger", title: "Couldn't start the server", duration: 1500 })`);
        await page.waitFor(`document.querySelector('${TOAST}')`, "the toast");
        await page.mouse("mouseMoved", await page.center(TOAST));
        await page.waitFor(`t.line()?.state === "paused"`, "the line to hold");
        const held = (await line())!.time;
        expect(held).toBeLessThan(1500);
        // well past its own time, it is still there, and its line hasn't moved
        await letPass(3000);
        expect(await toasts()).toBe(1);
        expect((await line())!.time).toBe(held);

        await page.mouse("mouseMoved", await page.center("#elsewhere"));
        await page.waitFor(`t.line()?.state === "running"`, "the line to run on");
        // on from where it was, not from the start
        expect((await line())!.time).toBeGreaterThanOrEqual(held);
        await page.waitFor(`!document.querySelector('${TOAST}')`, "the toast to go once its time is up", 5000);
    });

    test("a toast that shows up under a resting pointer still goes in its time", async () => {
        page = await browser.open("toastTime");
        // the pointer rests where the toast will show
        await page.eval(`t.show({ variant: "info", title: "Backup finished", duration: 60000 })`);
        await page.waitFor(`document.querySelector('${TOAST}')`, "a first toast");
        const spot = await page.center(TOAST);
        await page.eval(`document.querySelector('${TOAST} [aria-label="Close"]').click()`);
        await page.waitFor(`!document.querySelector('${TOAST}')`, "the first toast to close");
        await page.mouse("mouseMoved", spot);
        await page.eval(`t.show({ variant: "danger", title: "Couldn't start the server", duration: 1500 })`);
        await page.waitFor(`!document.querySelector('${TOAST}')`, "the toast to go in its time", 5000);
    });

    test("focus in it holds it too, and leaving lets it go", async () => {
        page = await browser.open("toastTime");
        await page.eval(`t.show({ variant: "danger", title: "Couldn't start the server", duration: 1500 })`);
        await page.waitFor(`document.querySelector('${TOAST}')`, "the toast");
        await page.eval(`document.querySelector('${TOAST} [aria-label="Close"]').focus()`);
        await page.waitFor(`t.line()?.state === "paused"`, "the line to hold");
        await letPass(3000);
        expect(await toasts()).toBe(1);

        await page.eval(`document.getElementById("elsewhere").focus()`);
        await page.waitFor(`!document.querySelector('${TOAST}')`, "the toast to go once focus leaves it", 5000);
    });

    test("told again, it shows once and its time and line start again", async () => {
        page = await browser.open("toastTime");
        await page.eval(`t.fail("Couldn't save the server", "The disk is full")`);
        await page.waitFor(`t.line()?.time > 1000`, "a second of its time to pass");
        await page.eval(`t.fail("Couldn't save the server", "The disk is still full")`);
        await page.waitFor(`document.querySelector('${TOAST}').textContent.includes("still full")`, "the newest words");
        expect((await line())!.time).toBeLessThan(1000);
        expect(await toasts()).toBe(1);
    });
});
