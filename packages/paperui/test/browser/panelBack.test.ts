// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

// a phone, below PAPER_PANEL_COMPACT_WIDTH (520)
const PHONE = { width: 390, height: 844, touch: true };
const PAGE = '[role="region"]';
const MENU = '[class*="_PaperMenu_"]';
const entry = (label: string) => `label:has(input[value="${label}"])`;

const layout = () =>
    page.eval<{ pageInert: boolean; menuInert: boolean; title: string | null; pageLeft: number }>(`(() => {
        const region = document.querySelector('${PAGE}');
        const menu = document.querySelector('${MENU}');
        return {
            pageInert: region.inert,
            menuInert: menu.closest("[inert]") !== null,
            title: region.getAttribute("aria-label"),
            pageLeft: region.getBoundingClientRect().left,
        };
    })()`);

/** waits for the page's slide to settle (open: at the left edge; closed: off-screen right) */
const settled = (open: boolean) =>
    page.waitFor(
        `(() => { const r = document.querySelector('${PAGE}').getBoundingClientRect(); return ${open} ? Math.abs(r.left) < 1 : r.left >= ${PHONE.width} - 1; })()`,
        open ? "the page to slide in" : "the page to slide out",
    );

async function openSettings() {
    page = await browser.open("panel", PHONE);
    await page.tap(entry("settings"));
    await settled(true);
}

// Inventory: Layout and navigation — Panel phone layout and Back.
describe("PaperPanel phone layout", () => {
    test("below the compact width the menu shows with the page inert; tapping an entry, even the selected one, opens it and Back returns", async () => {
        page = await browser.open("panel", PHONE);
        expect(await layout()).toMatchObject({ pageInert: true, menuInert: false });
        expect(await page.eval(`document.querySelector('${MENU}').getBoundingClientRect().width`)).toBe(PHONE.width);

        await page.tap(entry("settings"));
        await settled(true);
        expect(await layout()).toMatchObject({ pageInert: false, menuInert: true, title: "Settings" });
        expect(await page.eval(`document.getElementById("settings-page") !== null`)).toBe(true);

        await page.tap(`${PAGE} button[aria-label="Back"]`);
        await settled(false);
        expect(await layout()).toMatchObject({ pageInert: true, menuInert: false });

        // the entry already selected still opens its page
        await page.tap(entry("settings"));
        await settled(true);
        expect(await layout()).toMatchObject({ pageInert: false, menuInert: true, title: "Settings" });
    });

    test("a cancelable paperboard:back closes the top modal, then the page, then is left for the host", async () => {
        await openSettings();
        await page.eval("t.openModal()");
        await page.waitFor(`document.querySelector('[role="dialog"][aria-modal="true"]') !== null`, "the modal to open");

        expect(await page.eval("t.back()")).toBe(true);
        expect(await page.eval("t.modalOpen()")).toBe(false);
        expect((await layout()).pageInert).toBe(false);

        expect(await page.eval("t.back()")).toBe(true);
        expect((await layout()).pageInert).toBe(true);

        // nothing left to close: uncancelled, so the host's own Back runs
        expect(await page.eval("t.back()")).toBe(false);
    });

    test("a rightward swipe on the open page goes back", async () => {
        await openSettings();
        await page.touchDrag([
            { x: 60, y: 400 },
            { x: 100, y: 402 },
            { x: 180, y: 404 },
            { x: 300, y: 406 },
        ]);
        await settled(false);
        expect((await layout()).menuInert).toBe(false);
    });
});

// Inventory: Layout and navigation — Panel phone layout and Back (a swipe goes back exactly once).
describe("PaperSlidePage swipe back", () => {
    const swipe = [
        { x: 60, y: 300 },
        { x: 100, y: 302 },
        { x: 180, y: 304 },
        { x: 320, y: 306 },
    ];

    test("a rightward swipe on the page's content goes back exactly once", async () => {
        page = await browser.open("slidePage", PHONE);
        await page.touchDrag(swipe);
        await page.waitFor("t.backs > 0", "the swipe to go back");
        await page.frames();
        expect(await page.eval("t.backs")).toBe(1);
        expect(await page.eval("t.isOpen()")).toBe(false);
    });

    test("a rightward swipe on the page's top bar goes back exactly once", async () => {
        page = await browser.open("slidePage", PHONE);
        const bar = await page.center(`${PAGE} > header`);
        await page.touchDrag(swipe.map((p) => ({ x: p.x, y: bar.y })));
        await page.waitFor("t.backs > 0", "the swipe to go back");
        await page.frames();
        expect(await page.eval("t.backs")).toBe(1);
    });

    test("a leftward or vertical drag does not go back", async () => {
        page = await browser.open("slidePage", PHONE);
        await page.touchDrag([
            { x: 300, y: 300 },
            { x: 200, y: 302 },
            { x: 60, y: 304 },
        ]);
        await page.touchDrag([
            { x: 100, y: 200 },
            { x: 104, y: 300 },
            { x: 108, y: 500 },
        ]);
        await page.frames();
        expect(await page.eval("t.backs")).toBe(0);
        expect(await page.eval("t.isOpen()")).toBe(true);
    });
});
