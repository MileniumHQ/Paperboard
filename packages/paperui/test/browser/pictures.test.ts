// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

// Inventory: Display — PaperIcon and PaperMediaCard pictures.
describe("picture addresses", () => {
    test("a tinted icon's relative address is read against the page, not the stylesheet", async () => {
        page = await browser.open("pictures");
        // the stencil is fetched once it is painted: from where the page is
        const fetched = await page.waitFor<{ path: string; status: number }>(
            `(() => {
                const entry = performance.getEntriesByType("resource").find((e) => e.initiatorType === "css" && e.name.endsWith("mark.svg"));
                return entry && { path: new URL(entry.name).pathname, status: entry.responseStatus };
            })()`,
            "the tinted icon's picture to be fetched",
        );
        expect(fetched).toEqual({ path: "/pictures/mark.svg", status: 200 });
        expect(page.errors).toEqual([]);
    });

    test("a media card draws any picture address as a picture, and a glyph name as a glyph", async () => {
        page = await browser.open("pictures");
        const icon = (card: string) =>
            page.eval<{ img: string | null; glyph: string | null }>(`(() => {
                const card = document.querySelector("#${card}");
                return { img: card.querySelector("img")?.getAttribute("src") ?? null, glyph: card.querySelector(".material-symbols-rounded, [class*='_PaperIcon_']")?.textContent ?? null };
            })()`);
        expect(await icon("scheme")).toEqual({ img: "panel://dev.example/icon.png", glyph: null });
        expect(await icon("relative")).toEqual({ img: "pictures/card.svg", glyph: null });
        expect(await icon("glyph")).toEqual({ img: null, glyph: "dns" });
        expect(page.errors).toEqual([]);
    });
});
