// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

// pages open under the CSP panels run with, so pdf.js's worker, its data
// files and documents made in the page as blob: URLs are proven to load
// where panels use them
const open = (query = "") => browser.open("pdf", { query: `csp=panel${query ? `&${query}` : ""}` });

const ALERT = '[role="alert"]';
const PAGES = '[role="document"]';

/** how many pages have a drawn canvas, and whether page `n`'s has ink on it */
const drawn = () => page.eval<number>(`document.querySelectorAll("[data-page] canvas").length`);
const inked = (n: number) =>
    page.eval<boolean>(`(() => {
        const canvas = document.querySelector('[data-page="${n}"] canvas');
        if (!canvas || !canvas.width) return false;
        const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.length; i += 4) if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) return true;
        return false;
    })()`);
const firstDrawn = () => page.waitFor(`document.querySelector('[data-page="1"] canvas')`, "page 1 to draw");
const textOf = (n: number) => page.eval<string>(`document.querySelector('[data-page="${n}"] [class*="textLayer"]')?.textContent ?? ""`);
const readouts = () => page.eval<string[]>(`[...document.querySelectorAll('[role="toolbar"] [class*="readout"]')].map((r) => r.textContent.trim())`);
const pageBox = (n: number) =>
    page.eval<{ width: number; height: number }>(`(() => {
        const r = document.querySelector('[data-page="${n}"]').getBoundingClientRect();
        return { width: r.width, height: r.height };
    })()`);
const press = (label: string) => page.eval(`document.querySelector('button[aria-label="${label}"]').click()`);

describe("PaperPdf", () => {
    test("draws the pages near the view, fitted to the width, with their text to select", async () => {
        page = await open();
        await firstDrawn();
        expect(await inked(1)).toBe(true);
        await page.waitFor(`document.querySelector('[data-page="1"] [class*="endOfContent"]')`, "page 1's text");
        expect(await textOf(1)).toContain("The quick brown fox jumps over the lazy dog.");
        // a drag across a line selects its text, as on any page
        const line = await page.eval<{ x: number; y: number; right: number }>(`(() => {
            const span = [...document.querySelectorAll('[data-page="1"] [class*="textLayer"] span')].find((s) => s.textContent.startsWith("The quick"));
            const r = span.getBoundingClientRect();
            return { x: r.left + 1, y: r.top + r.height / 2, right: r.right - 1 };
        })()`);
        await page.mouse("mouseMoved", line);
        await page.mouse("mousePressed", line);
        for (const t of [0.3, 0.6, 1]) {
            await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: line.x + (line.right - line.x) * t, y: line.y, button: "left", buttons: 1 });
        }
        await page.mouse("mouseReleased", { x: line.right, y: line.y });
        expect(await page.eval("document.getSelection().toString()")).toContain("quick brown fox jumps over the lazy dog");
        expect(await page.eval("document.querySelectorAll('[data-page]').length")).toBe(3);
        expect(await readouts()).toEqual([expect.stringMatching(/^\d+%$/), "1 / 3"]);

        // the third page is landscape: it is measured to its own shape, and
        // being the widest, it is the one fitted to the width
        await page.waitFor(`(() => { const r = document.querySelector('[data-page="3"]').getBoundingClientRect(); return r.width > r.height; })()`, "page 3 to take its landscape size");
        const room = await page.eval<number>(`document.querySelector('${PAGES}').clientWidth`);
        const widest = (await pageBox(3)).width;
        expect(widest).toBeGreaterThan(room * 0.9);
        expect(widest).toBeLessThanOrEqual(room);
        expect((await pageBox(1)).width).toBeCloseTo((widest * 612) / 792, -1);
        expect(await page.eval("t.errors")).toEqual([]);
    });

    test("the page number follows the scroll, and the page keys move by a page", async () => {
        page = await open();
        await firstDrawn();
        await page.eval(`document.querySelector('${PAGES}').focus()`);
        await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 });
        await page.waitFor(`document.querySelector('[role="toolbar"]').textContent.includes("2 / 3")`, "the readout to show page 2");
        const top = await page.eval<number>(`document.querySelector('${PAGES}').getBoundingClientRect().top`);
        const second = await page.eval<number>(`document.querySelector('[data-page="2"]').getBoundingClientRect().top`);
        expect(second - top).toBeGreaterThanOrEqual(0);
        expect(second - top).toBeLessThan(40);
        await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "End", code: "End", windowsVirtualKeyCode: 35 });
        await page.waitFor(`document.querySelector('[role="toolbar"]').textContent.includes("3 / 3")`, "the readout to show page 3");
        await page.waitFor(`document.querySelector('[data-page="3"] canvas')`, "page 3 to draw");
        await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Home", code: "Home", windowsVirtualKeyCode: 36 });
        await page.waitFor(`document.querySelector('[role="toolbar"]').textContent.includes("1 / 3")`, "the readout to show page 1");
    });

    test("zooming resizes the pages at once and draws them sharp once it rests", async () => {
        page = await open();
        await firstDrawn();
        const before = await pageBox(1);
        const fitted = Number((await readouts())[0].replace("%", ""));
        const canvasWidth = () => page.eval<number>(`document.querySelector('[data-page="1"] canvas').width`);
        const drawnWidth = await canvasWidth();

        await press("Zoom in");
        const after = await pageBox(1);
        expect(after.width).toBeGreaterThan(before.width * 1.05);
        // the readout says the new zoom, and Fit width is offered again
        const percent = Number((await readouts())[0].replace("%", ""));
        expect(percent).toBeGreaterThan(fitted);
        expect(await page.eval(`document.querySelector('button[aria-label="Fit width"]').disabled`)).toBe(false);
        await page.waitFor(`document.querySelector('[data-page="1"] canvas').width > ${drawnWidth * 1.05}`, "page 1 to draw at the new zoom");

        // ⌘/Ctrl and the wheel zoom around the pointer: the point of the
        // page under it stays under it, while the column is scaled and once
        // it is laid out at the new zoom
        const at = { x: 300, y: 250 };
        const pointOnPage = () =>
            page.eval<{ fx: number; fy: number; width: number }>(`(() => {
                const r = document.querySelector('[data-page="1"]').getBoundingClientRect();
                return { fx: (${at.x} - r.left) / r.width, fy: (${at.y} - r.top) / r.height, width: r.width };
            })()`);
        const held = await pointOnPage();
        const wheel = async (deltaY: number) => {
            for (let i = 0; i < 3; i++) await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at.x, y: at.y, deltaX: 0, deltaY, modifiers: 2 });
        };
        const rest = () => page.waitFor(`!document.querySelector('[class*="gesturing"]')`, "the wheel zoom to rest");
        await wheel(-100);
        const during = await pointOnPage();
        expect(during.width).toBeGreaterThan(held.width * 1.8);
        expect(during.fx).toBeCloseTo(held.fx, 2);
        expect(during.fy).toBeCloseTo(held.fy, 2);
        await rest();
        const rested = await pointOnPage();
        expect(rested.width).toBeCloseTo(during.width, -1);
        expect(rested.fx).toBeCloseTo(held.fx, 2);
        expect(rested.fy).toBeCloseTo(held.fy, 2);
        await page.waitFor(`document.querySelector('[data-page="1"] canvas').width > ${rested.width * 0.95}`, "page 1 to draw at the wheel's zoom");

        // zoomed out past the width, the pages center, and the column goes
        // there during the gesture too, so nothing jumps when it rests
        await wheel(100);
        await wheel(100);
        const box = () => page.eval<{ left: number; top: number; width: number }>(`(() => { const r = document.querySelector('[data-page="1"]').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width }; })()`);
        const shrinking = await box();
        await rest();
        const shrunk = await box();
        expect(Math.abs(shrunk.left - shrinking.left)).toBeLessThan(4);
        expect(Math.abs(shrunk.top - shrinking.top)).toBeLessThan(4);
        expect(Math.abs(shrunk.width - shrinking.width)).toBeLessThan(4);
        const center = await page.eval<number>(`(() => { const r = document.querySelector('${PAGES}').getBoundingClientRect(); return r.left + r.width / 2; })()`);
        expect(Math.abs(shrunk.left + shrunk.width / 2 - center)).toBeLessThan(2);

        await press("Fit width");
        expect((await pageBox(1)).width).toBeCloseTo(before.width, 0);
        expect(await page.eval(`document.querySelector('button[aria-label="Fit width"]').disabled`)).toBe(true);
    });

    test("two fingers pinch the pages, and one scrolls them", async () => {
        page = await browser.open("pdf", { query: "csp=panel&width=390&height=700", width: 390, height: 700, touch: true });
        await firstDrawn();
        const before = (await pageBox(1)).width;
        const touch = (type: string, points: { x: number; y: number }[]) =>
            page.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, id) => ({ ...p, id })) });
        await touch("touchStart", [{ x: 150, y: 300 }, { x: 240, y: 300 }]);
        for (const spread of [60, 90, 120, 150]) {
            await touch("touchMove", [{ x: 195 - spread, y: 300 }, { x: 195 + spread, y: 300 }]);
        }
        await touch("touchEnd", []);
        await page.waitFor(`!document.querySelector('[class*="gesturing"]')`, "the pinch to rest");
        expect((await pageBox(1)).width).toBeGreaterThan(before * 2.5);
        await page.waitFor(`document.querySelector('[data-page="1"] canvas').width > ${before * 2.5}`, "page 1 to draw at the pinched zoom");

        const top = await page.eval<number>(`document.querySelector('${PAGES}').scrollTop`);
        await page.touchDrag([{ x: 200, y: 500 }, { x: 200, y: 400 }, { x: 200, y: 300 }]);
        await page.waitFor(`document.querySelector('${PAGES}').scrollTop > ${top + 50}`, "one finger to scroll");
    });

    test("where no worker can start, PDFs are read on the page's thread instead", async () => {
        page = await browser.open("pdf", {
            query: "csp=panel",
            beforeLoad: `window.Worker = class { constructor() { throw new Error("workers are off"); } };`,
        });
        await firstDrawn();
        expect(await inked(1)).toBe(true);
        expect(page.warnings.some((w) => w.includes("PaperPdf: the PDF worker didn't start"))).toBe(true);
        expect(await page.eval("t.errors")).toEqual([]);
    });

    test("a password-protected PDF says so in place and to onError", async () => {
        page = await open("src=/files/pdf-locked.pdf");
        await page.waitFor(`document.querySelector('${ALERT}')`, "the failure to show");
        expect(await page.eval(`document.querySelector('${ALERT}').textContent`)).toContain("This PDF is password-protected");
        expect(await page.eval("t.errors")).toEqual(["This PDF is password-protected"]);
        // trying again can't open it, so there's no Retry
        expect(await page.eval(`document.querySelector('${ALERT} button')`)).toBe(null);
    });

    test("a damaged PDF says so in place and to onError", async () => {
        page = await open("src=/files/pdf-damaged.pdf");
        await page.waitFor(`document.querySelector('${ALERT}')`, "the failure to show");
        expect(await page.eval(`document.querySelector('${ALERT}').textContent`)).toContain("This PDF is damaged");
        expect(await page.eval("t.errors")).toEqual(["This PDF is damaged"]);
    });

    test("a missing PDF offers Retry, which opens the next source given", async () => {
        page = await open("src=/files/missing.pdf");
        await page.waitFor(`document.querySelector('${ALERT}')`, "the failure to show");
        expect(await page.eval(`document.querySelector('${ALERT}').textContent`)).toContain("Can't load PDF");
        expect(await page.eval(`document.querySelector('${ALERT} button').textContent`)).toContain("Retry");
        expect(await page.eval("t.errors")).toEqual(["Can't load PDF"]);
        await page.eval(`document.querySelector('${ALERT} button').click()`);
        await page.waitFor(`document.querySelector('${ALERT}')`, "the retry to fail again");
        expect(await page.eval("t.errors")).toEqual(["Can't load PDF", "Can't load PDF"]);
    });

    test("a new source replaces the document, and an older load that answers late is dropped", async () => {
        page = await open();
        await firstDrawn();
        // two sources in a row: only the last may show
        await page.eval(`t.setSrc(t.makePdf(40)); t.setSrc(t.makePdf(7));`);
        await page.waitFor(`document.querySelectorAll('[data-page]').length === 7 && document.querySelector('[data-page="1"] canvas')`, "the 7-page document to show");
        await page.waitFor(`document.querySelector('[data-page="1"] [class*="endOfContent"]')`, "page 1's text");
        expect(await textOf(1)).toContain("Page 1");
        expect(await readouts()).toEqual([expect.stringMatching(/%$/), "1 / 7"]);
        // quiet: proving the 40-page load never lands needs time to pass, not a condition to poll
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await page.eval("document.querySelectorAll('[data-page]').length")).toBe(7);
        expect(await page.eval("t.errors")).toEqual([]);
    });

    test("a 500-page document opens at once and draws only the pages near the view", async () => {
        page = await open();
        await firstDrawn();
        const started = await page.eval<number>("performance.now()");
        await page.eval(`t.setSrc(t.makePdf(500))`);
        await page.waitFor(`document.querySelectorAll('[data-page]').length === 500 && document.querySelector('[data-page="1"] canvas')`, "the long document to show");
        const opened = (await page.eval<number>("performance.now()")) - started;
        expect(opened).toBeLessThan(3000);
        // every page is laid out, so the scrollbar is right before any is drawn
        const scrollHeight = await page.eval<number>(`document.querySelector('${PAGES}').scrollHeight`);
        expect(scrollHeight).toBeGreaterThan((await pageBox(1)).height * 500);
        await page.frames();
        expect(await drawn()).toBeLessThan(10);

        // jump to the middle: those pages draw, and the first ones are freed
        await page.eval(`(() => { const s = document.querySelector('${PAGES}'); s.scrollTop = s.scrollHeight / 2; })()`);
        await page.waitFor(`/^2\\d\\d \\/ 500$/.test([...document.querySelectorAll('[role="toolbar"] [class*="readout"]')][1].textContent.trim())`, "the readout to follow");
        await page.waitFor(`[...document.querySelectorAll("[data-page] canvas")].some((c) => Number(c.parentElement.dataset.page) > 240)`, "the middle pages to draw");
        await page.waitFor(`!document.querySelector('[data-page="1"] canvas')`, "page 1 to be freed");
        expect(await drawn()).toBeLessThan(16);
        expect(await page.eval("t.errors")).toEqual([]);
    });

    test("renderPdfThumbnail draws page 1 as a PNG with its longer edge the size asked", async () => {
        page = await open();
        // the sample's first page is portrait: 612 × 792 points
        expect(await page.eval(`t.thumbnail("/files/pdf-sample.pdf", 240)`)).toEqual({ type: "image/png", width: 185, height: 240 });
        expect(await page.eval(`t.thumbnailError("/files/pdf-locked.pdf")`)).toBe("This PDF is password-protected");
        expect(await page.eval(`t.abortedThumbnail("/files/pdf-sample.pdf")`)).toBe("AbortError");
    });
});
