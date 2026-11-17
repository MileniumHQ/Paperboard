// A panel that is still loading is covered by its icon and name over a bar:
// the icon centered on the name beside it, and the bar just under them.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { API_DEMO, bootShell, type Shell } from "./support/shell";

// every panel page stops before its first script, so it never says it is
// ready and its frame stays behind the loader
const HOLD = `if (window !== window.top) window.stop();`;

const ID = "dev.paperboard.apidemo";

let shell: Shell;

beforeAll(async () => {
    shell = await bootShell({ panels: [API_DEMO], init: HOLD });
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — a loading panel's heading is laid out: icon centered on its name, the bar under them.
test("a loading panel's icon sits centered on its name, with the bar close under them", async () => {
    const { page } = shell;
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    await page.waitFor(`document.querySelector("label[data-value='${ID}']")`, "API Demo in the sidebar");
    await page.click(`label[data-value='${ID}']`);
    const overlay = `document.querySelector("iframe[data-panel-key='local::${ID}']")?.parentElement`;
    await page.waitFor(`${overlay}?.querySelector("h1 [aria-hidden]") && ${overlay}.querySelector("[role=progressbar]")`, "the loader, with the panel's icon");
    const box = await page.evaluate<{ icon: DOMRect; name: DOMRect; bar: DOMRect; font: number }>(`(() => {
        const heading = ${overlay}.querySelector("h1");
        const range = document.createRange();
        const text = [...heading.querySelectorAll("*"), heading].flatMap((e) => [...e.childNodes]).find((n) => n.nodeType === 3 && n.textContent.trim() === "API Demo");
        range.selectNodeContents(text);
        return {
            icon: heading.querySelector("[aria-hidden]").getBoundingClientRect().toJSON(),
            name: range.getBoundingClientRect().toJSON(),
            bar: ${overlay}.querySelector("[role=progressbar]").getBoundingClientRect().toJSON(),
            font: parseFloat(getComputedStyle(heading).fontSize),
        };
    })()`);
    const middle = (r: { top: number; height: number }) => r.top + r.height / 2;
    // the icon's middle is the name's middle, to within a pixel
    expect(Math.abs(middle(box.icon) - middle(box.name))).toBeLessThanOrEqual(1);
    // the bar starts within half a line of the name's glyphs, not a whole line under them
    expect(box.bar.top - (box.name.top + box.name.height)).toBeLessThanOrEqual(box.font / 2);
    expect(page.exceptions).toEqual([]);
});
