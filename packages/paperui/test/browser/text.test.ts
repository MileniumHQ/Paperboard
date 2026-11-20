// @vitest-environment node
import { describe, expect, test } from "vitest";
import { useBrowser } from "./support/browser";

const browser = useBrowser();

// Inventory: Text — PaperText as a heading or paragraph has no browser margins.
describe("PaperText margins", () => {
    test("a heading or paragraph passed as `as` is spaced only by its layout's gap", async () => {
        const page = await browser.open("textMargins");

        // each element's margins, and the space between it and the one before
        const rows = await page.eval<{ tag: string; margin: string; space: number }[]>(`
            [...document.querySelectorAll("#column > :not(.own-margin)")].map((el) => {
                const prev = el.previousElementSibling;
                return {
                    tag: el.tagName,
                    margin: getComputedStyle(el).margin,
                    space: prev ? Math.round(el.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) : 0,
                };
            })
        `);
        expect(rows).toEqual([
            { tag: "H1", margin: "0px", space: 0 },
            { tag: "H2", margin: "0px", space: 8 },
            { tag: "H3", margin: "0px", space: 8 },
            { tag: "P", margin: "0px", space: 8 },
            { tag: "FIGCAPTION", margin: "0px", space: 8 },
        ]);
        expect(await page.eval(`document.querySelector("#column").getBoundingClientRect().top - document.querySelector("#column > h1").getBoundingClientRect().top`)).toBe(0);
        page.expectNoErrors();
    });

    test("a margin from the caller's own class still applies, wherever its stylesheet loads", async () => {
        const page = await browser.open("textMargins");

        expect(await page.eval(`getComputedStyle(document.querySelector(".own-margin")).marginTop`)).toBe("12px");
        page.expectNoErrors();
    });
});
