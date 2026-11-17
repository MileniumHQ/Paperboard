// @vitest-environment node
import { describe, expect, test } from "vitest";
import { useBrowser } from "./support/browser";

const browser = useBrowser();

/** how far each item's icon sits from the middle of its text lines, in pixels */
const OFFSETS = `[...document.querySelectorAll("label")].map((label) => {
    const icon = (label.querySelector("[class*=iconImage]") ?? label.querySelector("[class*=itemIcon]")).getBoundingClientRect();
    const text = label.querySelector("[class*=itemText]").getBoundingClientRect();
    return (icon.top + icon.height / 2) - (text.top + text.height / 2);
})`;

// Inventory: Selection and lists — A selector item's icon is centered against its text.
describe("PaperSelectorItem", () => {
    test.each(["light", "dark"])("an icon, a symbol or a logo, is vertically centered against the title and description (%s)", async (theme) => {
        const page = await browser.open("selector", { query: `theme=${theme}` });
        const offsets = await page.eval<number[]>(OFFSETS);
        expect(offsets).toHaveLength(2);
        for (const offset of offsets) expect(Math.abs(offset)).toBeLessThan(1);
    });
});
