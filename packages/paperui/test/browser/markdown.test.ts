// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

/** the nth heading (from 0) with this text in a block, by its block's id */
const heading = (block: string, text: string, nth = 0) =>
    `[...document.querySelectorAll('#${block} h2')].filter((h) => h.textContent === ${JSON.stringify(text)})[${nth}]`;

/** waits until the heading rests at the top of the scroller, focused */
async function landsOn(block: string, text: string, nth = 0) {
    await page.waitFor(
        `(() => {
            const h = ${heading(block, text, nth)};
            const top = h.getBoundingClientRect().top - document.querySelector("#scroller").getBoundingClientRect().top;
            return document.activeElement === h && top >= 0 && top < 40;
        })()`,
        `${block}'s "${text}" heading (#${nth}) at the top, focused`,
    );
}

const link = (block: string, text: string) =>
    page.eval(`(() => {
        const a = [...document.querySelectorAll('#${block} a')].find((a) => a.textContent === ${JSON.stringify(text)});
        a.setAttribute("data-test-link", "");
        a.scrollIntoView({ block: "center" });
    })()`).then(() => `#${block} a[data-test-link]`);

const clearLink = () => page.eval(`document.querySelectorAll("[data-test-link]").forEach((a) => a.removeAttribute("data-test-link"))`);

// Inventory: Text — A Markdown #link reaches its heading in the same block.
describe("PaperMarkdown in-page links", () => {
    test("a #link scrolls to its heading in the same block and focuses it, without touching the page's hash", async () => {
        page = await browser.open("markdownAnchors");

        await page.click(await link("first", "Details"));
        await landsOn("first", "Details");
        await clearLink();

        await page.click(await link("first", "Second details"));
        await landsOn("first", "Details", 1);
        await clearLink();

        await page.click(await link("first", "Café"));
        await landsOn("first", "Café");
        await clearLink();

        expect(await page.eval("location.hash")).toBe("");
        page.expectNoErrors();
    });

    test("the same slug in another block, or an element of the page, is never the target", async () => {
        page = await browser.open("markdownAnchors");

        await page.click(await link("second", "Details"));
        await landsOn("second", "Details");
        expect(await page.eval(`document.activeElement === document.querySelector("#details")`)).toBe(false);
        expect(await page.eval(`document.querySelectorAll("#first h2[id], #second h2[id]").length`)).toBe(0);
    });
});
