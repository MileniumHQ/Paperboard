// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

// The visible box of each control in a row: an input's is its PaperInput
// frame, a button's is itself.
const heights = (row: string) =>
    page.eval<Record<string, number>>(`(() => {
        const out = {};
        document.querySelectorAll('[data-size="${row}"] [data-control]').forEach((el) => {
            const box = el.closest('[class*="_PaperInput_"]') ?? el;
            out[el.getAttribute("data-control")] = box.getBoundingClientRect().height;
        });
        return out;
    })()`);

// Inventory: PaperButton, PaperInput and PaperSelectMenu sizes — one height per size.
describe("field sizes", () => {
    for (const [size, px] of [
        ["small", 32],
        ["medium", 40],
        ["large", 48],
    ] as const) {
        test(`a ${size} input, labelled input, button, labelled icon button, and icon button are all ${px}px`, async () => {
            page = await browser.open("controlHeights");
            const row = await heights(size);
            expect(Object.keys(row).length).toBe(6);
            for (const [control, height] of Object.entries(row)) expect([control, height]).toEqual([control, px]);
        });
    }

    test("a default menu, input, and button in a row are one height", async () => {
        page = await browser.open("controlHeights");
        const row = await page.eval<number[]>(`(() => {
            const row = document.querySelector('[data-size="menu"]');
            const menu = row.querySelector('[class*="_PaperSelectMenu_"] [class*="_trigger_"]');
            const input = row.querySelector('[data-row="input"]').closest('[class*="_PaperInput_"]');
            const button = row.querySelector('[data-row="button"]');
            return [menu, input, button].map((el) => el.getBoundingClientRect().height);
        })()`);
        expect(row).toEqual([40, 40, 40]);
    });
});
