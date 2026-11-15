// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();

/** gives the page a viewport `width` wide and waits for what the scenario shows to follow */
async function resize(page: Page, width: number) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.frames();
}

const shown = (page: Page) => page.eval<string>(`document.getElementById("compact").textContent`);

// Inventory: Layout and navigation — the phone layout outside a PaperPanel.
describe("createPaperCompact", () => {
    test("the phone layout is below PAPER_PANEL_COMPACT_WIDTH (520), and follows the page as it is resized", async () => {
        const page = await browser.open("compact", { width: 519 });
        expect(await shown(page)).toBe("phone");
        await resize(page, 520);
        expect(await shown(page)).toBe("wide");
        await resize(page, 390);
        expect(await shown(page)).toBe("phone");
    });
});
