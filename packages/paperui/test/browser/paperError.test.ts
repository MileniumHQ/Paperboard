// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

/** What a screen reader is told: its role, its name, and the words it holds. */
const said = (id: string) =>
    page.eval<{ role: string | null; name: string; text: string }>(`(() => {
        const el = document.getElementById(${JSON.stringify(id)});
        return { role: el.getAttribute("role"), name: el.getAttribute("aria-label") ?? "", text: el.innerText };
    })()`);

/** The middle of the button in `id` that says `label`. */
const buttonIn = (id: string, label: string) =>
    page.eval<{ x: number; y: number }>(`(() => {
        const button = [...document.querySelectorAll(${JSON.stringify(`#${id} button`)})].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
        const r = button.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);

// Inventory: PaperError — a failure that stands, said where it happens.
describe("PaperError", () => {
    test("says what failed and why from a raw error, in a labelled region, and its action is a button that works", async () => {
        page = await browser.open("paperError");
        const inline = await said("inline");
        expect(inline.role).toBe("region");
        expect(inline.name).toBe("Couldn't load the newest backups");
        expect(inline.text).toContain("The backup folder is on a drive that isn't connected");
        await page.click("#inline button");
        expect(await page.eval("t.retries")).toBe(1);

        // one that came of a press is said at once
        expect((await said("alert")).role).toBe("alert");
    });

    test("a reason's first line is shown, and the rest folds under Details until it is opened", async () => {
        page = await browser.open("paperError");
        // where the words are, and whether they can be read: under a closed Details they can't
        const readable = (words: string) =>
            page.eval<boolean | null>(`(() => {
                const walk = document.createTreeWalker(document.getElementById("details"), NodeFilter.SHOW_TEXT);
                for (let node = walk.nextNode(); node; node = walk.nextNode())
                    if (node.textContent.includes(${JSON.stringify(words)})) return !node.parentElement.closest("[inert]");
                return null;
            })()`);
        expect(await readable("SteamCMD exited with code 8")).toBe(true);
        expect(await readable("Disk write failure")).toBe(false);
        await page.click('#details button[aria-expanded="false"]');
        await page.waitFor(`document.querySelector('#details button[aria-expanded="true"]')`, "the details to open");
        expect(await readable("Disk write failure")).toBe(true);
        await page.clickAt(await buttonIn("details", "Open settings"));
        expect(await page.eval("t.opens")).toBe(1);
    });

    test("at phone width a long reason wraps and nothing scrolls sideways", async () => {
        page = await browser.open("paperError", { width: 390, height: 844, touch: true });
        expect(await page.eval("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
        const box = await page.eval<{ right: number }>(`document.getElementById("long").getBoundingClientRect().toJSON()`);
        expect(box.right).toBeLessThanOrEqual(390);
        expect((await said("long")).text).toContain("paste it in Settings.");
    });

    test("filling a view, it sits in the middle of the space left, and its Try again works", async () => {
        page = await browser.open("paperError", { query: "view=fill" });
        const fill = await said("fill");
        expect(fill.name).toBe("Couldn't load the worlds");
        expect(fill.text).toContain("connection refused on port 25575");
        const title = await page.eval<{ x: number; y: number }>(
            `(() => { const r = document.querySelector("#fill [data-preset='label']").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
        );
        expect(Math.abs(title.x - 600)).toBeLessThan(24);
        expect(Math.abs(title.y - 400)).toBeLessThan(120);
        await page.click("#fill button");
        expect(await page.eval("t.retries")).toBe(1);
    });
});
