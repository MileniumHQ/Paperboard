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

// Inventory: PaperModal — Blur is its own switch, apart from motion.
describe("a PaperModal's backdrop blur", () => {
    const open = async (beforeLoad?: string) => {
        page = await browser.open("modalLeave", beforeLoad ? { beforeLoad } : {});
        await page.waitFor(`document.querySelector('${DIALOG}')?.getAttribute("aria-modal") === "true"`, "the dialog to open");
        await page.waitFor(`document.getAnimations().every((a) => a.playState === "finished")`, "the dialog's entrance to end");
    };
    const backdropFilter = () => page.eval<string>(`getComputedStyle(document.querySelector('${DIALOG}').parentElement).backdropFilter`);
    const onRoot = (name: string, value: string) => `document.documentElement.setAttribute("${name}", "${value}")`;
    // a switch may fade the blur in or out; what matters is where it settles
    const settlesAt = (value: string) =>
        page.waitFor(`getComputedStyle(document.querySelector('${DIALOG}').parentElement).backdropFilter === "${value}"`, `the backdrop filter to be ${value}`);

    test("is the light blur by default, none while the host's data-paperui-blur is off, and back when it isn't", async () => {
        await open();
        expect(await backdropFilter()).toBe("blur(5px)");
        // Paperboard writes it on the document's root, live, with the dialog open
        await page.eval(onRoot("data-paperui-blur", "off"));
        await settlesAt("none");
        await page.eval(onRoot("data-paperui-blur", "auto"));
        await settlesAt("blur(5px)");
    });

    test("reduced motion leaves it alone", async () => {
        await open();
        await page.eval(onRoot("data-paperui-motion", "reduced"));
        expect(await backdropFilter()).toBe("blur(5px)");
    });

    test("is none under the operating system's reduced transparency", async () => {
        await open();
        await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
        await settlesAt("none");
    });
});
