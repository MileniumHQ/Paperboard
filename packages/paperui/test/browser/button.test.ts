// @vitest-environment node
import { describe, expect, test } from "vitest";
import { useBrowser } from "./support/browser";

const browser = useBrowser();

// Inventory: Menus and form controls — An enabled button looks enabled.
describe("PaperButton", () => {
    test("a button enabled again loses its disabled grey as fast as its fade, never reading disabled after it", async () => {
        const page = await browser.open("button");
        await page.eval(`t.setDisabled(false)`);
        // every part of the disabled look eases out together: the grey is gone by the time the fade is
        const ends = await page.eval<Record<string, number>>(`Object.fromEntries(document.querySelector("#saving").getAnimations().map((a) => [a.transitionProperty, a.effect.getComputedTiming().endTime]))`);
        expect(ends.opacity).toBeGreaterThan(0);
        expect(ends.filter).toBeLessThanOrEqual(ends.opacity);
    });
});
