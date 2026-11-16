// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

const DIALOG = '[role="dialog"]';
const TOAST = '[data-paper-toasts] [role="alert"]';
const CLOSE = `${TOAST} [aria-label="Close"]`;
const focused = () => page.eval<string>(`(() => { const a = document.activeElement; return a?.id || a?.getAttribute("aria-label") || a?.tagName; })()`);

async function failWithDialogOpen() {
    page = await browser.open("toastModal");
    await page.waitFor(`document.querySelector('${DIALOG}')?.getAttribute("aria-modal") === "true"`, "the dialog to open");
    await page.waitFor(`document.activeElement?.closest('${DIALOG}')`, "focus to go into the dialog");
    await page.eval(`t.fail("The name is taken by another world")`);
    await page.waitFor(`document.querySelector('${TOAST}')`, "the failure toast");
    await page.waitFor(`document.getAnimations().every((a) => a.playState === "finished")`, "the toast and dialog to settle");
}

// Inventory: PaperToast — a failure said while a dialog is open.
describe("a failure toast over an open PaperModal", () => {
    test("shows in the dialog, is read, takes the press on its close, and the dialog stays open", async () => {
        await failWithDialogOpen();
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

    test("a failure outlives the dialog it showed in: back on the page, the same element", async () => {
        await failWithDialogOpen();
        await page.eval(`document.querySelector('${TOAST}').dataset.kept = "yes"`);
        await page.press("Escape");
        await page.waitFor(`!document.querySelector('[data-paper-toasts]').closest('${DIALOG}')`, "the toast back on the page");
        expect(await page.eval(`document.querySelector('${TOAST}')?.dataset.kept`)).toBe("yes");
    });

    test("Tab reaches its close in the dialog's own turn, between its content and its buttons; once it is closed, focus stays in the dialog", async () => {
        await failWithDialogOpen();
        await page.eval(`document.getElementById("name").focus()`);
        await page.press("Tab");
        expect(await focused()).toBe("Close");
        expect(await page.eval(`!!document.activeElement.closest('[data-paper-toasts]')`)).toBe(true);
        await page.press("Tab");
        expect(await focused()).toBe("save");
        // round the cycle, and back the other way
        await page.press("Tab");
        expect(await focused()).toBe("Close modal");
        await page.press("Tab", 8);
        expect(await focused()).toBe("save");
        await page.press("Tab", 8);
        expect(await focused()).toBe("Close");

        await page.press("Enter");
        await page.waitFor(`!document.querySelector('${TOAST}')`, "the toast to close from the keyboard");
        expect(await page.eval("t.isOpen()")).toBe(true);
        // focus went with the toast; Tab brings it back into the dialog, never to the page under it
        await page.press("Tab");
        expect(await page.eval(`!!document.activeElement.closest('${DIALOG}')`)).toBe(true);
        await page.press("Tab", 8);
        expect(await page.eval(`!!document.activeElement.closest('${DIALOG}')`)).toBe(true);
    });
});
