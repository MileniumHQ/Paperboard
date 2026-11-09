// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

const DIALOG = '[role="dialog"]';

// Inventory: PaperModal — A closed modal really leaves.
describe("a closed PaperModal really leaves", () => {
    test("closing drops aria-modal at once and lets presses through to the page during the exit fade", async () => {
        page = await browser.open("modalLeave");
        await page.waitFor(`document.querySelector('${DIALOG}')?.getAttribute("aria-modal") === "true"`, "the dialog to open");
        const at = await page.center("#modal-body");
        // while open, a press on the dialog is the dialog's
        expect(await page.eval(`document.elementFromPoint(${at.x}, ${at.y}).closest('${DIALOG}') !== null`)).toBe(true);

        const closing = await page.eval<{ ariaModal: string | null; mounted: boolean; hitsPage: boolean }>(`(() => {
            const dialog = document.querySelector('${DIALOG}');
            t.close();
            return {
                ariaModal: dialog.getAttribute("aria-modal"),
                mounted: dialog.isConnected,
                hitsPage: document.elementFromPoint(${at.x}, ${at.y}) === document.getElementById("under"),
            };
        })()`);
        expect(closing).toEqual({ ariaModal: null, mounted: true, hitsPage: true });

        await page.clickAt(at);
        expect(await page.eval("t.presses")).toBe(1);
        await page.waitFor(`!document.querySelector('${DIALOG}')`, "the dialog to leave the DOM");
    });

    test("it leaves the DOM even when the page draws no frames", async () => {
        page = await browser.open("modalLeave");
        await page.waitFor(`document.querySelector('${DIALOG}')?.getAttribute("aria-modal") === "true"`, "the dialog to open");
        // a hidden tab: requestAnimationFrame never calls back and CSS animations never advance
        await page.send("Animation.enable");
        await page.send("Animation.setPlaybackRate", { playbackRate: 0 });
        await page.eval("window.requestAnimationFrame = () => 0; t.close()");

        await page.waitFor(`!document.querySelector('${DIALOG}')`, "the dialog to leave the DOM without a frame", 5_000);
    });
});
