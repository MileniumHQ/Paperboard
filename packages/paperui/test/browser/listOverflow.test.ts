// @vitest-environment node
import { describe, expect, test } from "vitest";
import { useBrowser } from "./support/chrome";

const browser = useBrowser();

/** how one list's row lays out its long title against its actions */
const row = (list: string) => `(() => {
    const item = document.querySelector("#${list} [data-value=long]");
    const title = item.querySelector("[class*=listTitle] > span");
    const actions = item.querySelector("[class*=itemActions]");
    return {
        titleRight: title.getBoundingClientRect().right,
        actionsLeft: actions.getBoundingClientRect().left,
        itemRight: item.getBoundingClientRect().right,
        actionsRight: actions.getBoundingClientRect().right,
        // one box per line the text takes
        titleLines: (() => { const range = document.createRange(); range.selectNodeContents(title); return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size; })(),
        clipped: title.scrollWidth > title.clientWidth,
        ellipsis: getComputedStyle(title).textOverflow,
    };
})()`;

// Inventory: Layout and navigation — a long list title never covers its row's actions.
describe("PaperListItem with a long unbroken title", () => {
    test.each(["regular", "compact"])("a %s list's title ends in an ellipsis on one line, short of its actions", async (list) => {
        const page = await browser.open("listOverflow", { width: 400, height: 800 });
        const r = await page.eval<Record<string, number | boolean | string>>(row(list));
        expect(r.titleRight).toBeLessThanOrEqual(r.actionsLeft as number);
        // the actions keep their place at the row's end, inside it
        expect(r.actionsRight).toBeLessThanOrEqual(r.itemRight as number);
        expect(r.titleLines).toBe(1);
        expect(r.clipped).toBe(true);
        expect(r.ellipsis).toBe("ellipsis");
    });
});
