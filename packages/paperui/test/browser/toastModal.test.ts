// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

const DIALOG = '[role="dialog"]';
const TOAST = '[data-paper-toasts] [role="alert"]';
const CLOSE = `${TOAST} [aria-label="Close"]`;

async function failWithDialogOpen() {
    page = await browser.open("toastModal");
    await page.waitFor(`document.querySelector('${DIALOG}')?.getAttribute("aria-modal") === "true"`, "the dialog to open");
    await page.waitFor(`document.activeElement?.closest('${DIALOG}')`, "focus to go into the dialog");
    await page.eval(`t.fail("The name is taken by another world")`);
    await page.waitFor(`document.querySelector('${TOAST}')`, "the failure toast");
    await page.waitFor(`document.getAnimations().every((a) => a.playState === "finished" || a.effect?.target?.matches("[data-paper-toast-time]"))`, "the toast and dialog to settle (its time line runs on)");
}

// Inventory: PaperToast — a failure said while a dialog is open.
describe("a failure toast over an open PaperModal", () => {
    test("shows in the corner above the scrim, is read, takes the press on its close, and the dialog stays open", async () => {
        await failWithDialogOpen();
        // on the page, not in the dialog, in the window's bottom-right corner
        expect(await page.eval(`!document.querySelector('[data-paper-toasts]').closest('${DIALOG}')`)).toBe(true);
        const corner = await page.eval<{ right: number; bottom: number; width: number; height: number }>(
            `(() => { const r = document.querySelector('${TOAST}').getBoundingClientRect(); return { right: innerWidth - r.right, bottom: innerHeight - r.bottom, width: innerWidth, height: innerHeight }; })()`,
        );
        expect(corner.right).toBeGreaterThan(0);
        expect(corner.right).toBeLessThan(corner.width / 10);
        expect(corner.bottom).toBeGreaterThan(0);
        expect(corner.bottom).toBeLessThan(corner.height / 10);
        const close = await page.center(CLOSE);
        // what a press there hits is the toast, not the scrim or the page under it
        expect(await page.eval(`!!document.elementFromPoint(${close.x}, ${close.y})?.closest('[data-paper-toasts]')`)).toBe(true);
        expect(await page.eval(`document.querySelector('${TOAST}').textContent`)).toContain("The name is taken by another world");

        // and the dialog, being aria-modal, doesn't keep it from a screen reader
        const { nodes } = await page.send<{ nodes: { ignored: boolean; role?: { value: string }; name?: { value: string } }[] }>("Accessibility.getFullAXTree");
        const alert = nodes.find((n) => n.role?.value === "alert");
        expect(alert?.ignored).toBe(false);
        const button = nodes.find((n) => n.role?.value === "button" && n.name?.value === "Close");
        expect(button?.ignored).toBe(false);

        await page.clickAt(close);
        await page.waitFor(`!document.querySelector('${TOAST}')`, "the toast to close");
        expect(await page.eval("t.isOpen()")).toBe(true);
        expect(await page.eval("t.presses")).toBe(0);
    });

});
