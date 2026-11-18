// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

// Inventory: PaperList standalone — a list beside other content is its own card.
describe("PaperList standalone", () => {
    test("frames its labels and rows on every side, rounds its corners, and sizes to its rows", async () => {
        page = await browser.open("standaloneList");
        const box = await page.eval<{
            borders: number[];
            radius: number;
            labelInside: boolean;
            rowsInside: boolean;
            hugs: boolean;
            column: number;
            width: number;
        }>(`(() => {
            const list = document.getElementById("list");
            const style = getComputedStyle(list);
            const rect = list.getBoundingClientRect();
            const inside = (el) => {
                const r = el.getBoundingClientRect();
                return r.left >= rect.left + 1 && r.right <= rect.right - 1;
            };
            const rows = [...list.querySelectorAll("[data-item]")];
            const last = rows[rows.length - 1].getBoundingClientRect();
            const column = document.getElementById("column");
            const pad = parseFloat(getComputedStyle(column).paddingLeft) + parseFloat(getComputedStyle(column).paddingRight);
            return {
                borders: ["Top", "Right", "Bottom", "Left"].map((side) => parseFloat(style["border" + side + "Width"])),
                radius: parseFloat(style.borderTopLeftRadius),
                labelInside: inside(document.getElementById("label")),
                rowsInside: rows.every(inside),
                // the list ends at its last row, not at the bottom of the column
                hugs: Math.abs(rect.bottom - last.bottom) <= 2,
                column: column.clientWidth - pad,
                width: rect.width,
            };
        })()`);
        expect(box.borders.every((width) => width > 0)).toBe(true);
        expect(box.radius).toBeGreaterThan(0);
        expect(box.labelInside).toBe(true);
        expect(box.rowsInside).toBe(true);
        expect(box.hugs).toBe(true);
        expect(box.width).toBeCloseTo(box.column, 0);
        // clipped: the rows' square surfaces don't paint over the rounded corners
        expect(await page.eval(`getComputedStyle(document.getElementById("list")).overflowY`)).not.toBe("visible");
    });
});
