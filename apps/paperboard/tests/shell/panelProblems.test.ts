// What a panel's service couldn't do with no button waiting, shown on the
// panel's row in the sidebar: counted, listed, dismissed by the person, and
// gone once the panel clears it.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as path from "node:path";
import { bootShell, type DevPanel, type Shell } from "./support/shell";

// a service that reports two problems as it starts, and clears one on `fix`
const PROBLEMS: DevPanel = {
    source: path.join(import.meta.dir, "support/problems-panel"),
    pages: ["panel.ts"],
    service: "service.ts",
    html: ["index.html"],
};
const ID = "dev.paperboard.testproblems";
const KEY = `local::${ID}`;
const row = `document.querySelector("label[data-value='${ID}']")`;
const badge = (label: string) => `${row}?.querySelector("button[aria-label='Weather Station: ${label}']")`;
const popover = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.textContent.includes("Weather Station"))`;
// textContent: the list is in the page while the popover is still opening
const listed = `[...(${popover}?.querySelectorAll("[data-problem]") ?? [])].map((item) => item.textContent)`;


let shell: Shell;

beforeAll(async () => {
    shell = await bootShell({ panels: [PROBLEMS] });
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — a failure no button waited for still reaches the person.
test("a service's problems show on its row, can be dismissed, and go once the panel clears them", async () => {
    const { page } = shell;
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    await page.waitFor(badge("2 problems"), "the row to count both problems");

    // in the narrowest window the badge takes none of the name's room
    await page.resize(860, 560);
    expect(await page.evaluate(`(() => {
        const name = [...${row}.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === "Weather Station");
        return name.scrollWidth > name.clientWidth;
    })()`)).toBe(false);

    await page.click(`label[data-value='${ID}'] button[aria-label='Weather Station: 2 problems']`);
    await page.waitFor(`${listed}.length === 2`, "the problems listed");
    const shown = await page.evaluate<string[]>(listed);
    expect(shown[0]).toContain("The forecast couldn't be read");
    expect(shown[0]).toContain("api.weather.example answered 503 Service Unavailable");
    expect(shown[1]).toContain("Yesterday's readings weren't saved");
    expect(shown[1]).toContain("Paperboard isn't allowed to open /var/lib/weather-station/history/readings/2026-11-14.json.8cf067e8f3d1c5a7.tmp.");
    // opening the list left the panel unopened
    expect(await page.evaluate(`!!document.querySelector("iframe[data-panel-key='${KEY}']")`)).toBe(false);

    // the badge is the whole control: no button padding taller or wider than it
    const footprint = await page.evaluate<{ wider: number; taller: number }>(`(() => {
        const button = ${badge("2 problems")}.getBoundingClientRect();
        const pill = ${badge("2 problems")}.querySelector("[class*=PaperBadge]").getBoundingClientRect();
        return { wider: Math.round(button.width - pill.width), taller: Math.round(button.height - pill.height) };
    })()`);
    expect(footprint.taller).toBeLessThanOrEqual(0);
    expect(footprint.wider).toBeLessThanOrEqual(8);
    // each problem reads whole: nothing cut short or running past the list's edge
    expect(await page.evaluate(`(() => {
        const box = ${popover}.getBoundingClientRect();
        return [...${popover}.querySelectorAll("[data-problem] *")].filter((el) => el.children.length === 0 && el.textContent.trim()).filter((el) => {
            const at = el.getBoundingClientRect();
            return el.scrollWidth > el.clientWidth || at.right > box.right || at.left < box.left;
        }).map((el) => el.textContent);
    })()`)).toEqual([]);

    // the person dismisses one, once the list has opened: it is gone from the computer, not only the list
    await page.motionSettled();
    await page.evaluate(`[...${popover}.querySelectorAll("[data-problem]")].find((i) => i.textContent.includes("readings"))?.querySelector("button[aria-label^=Dismiss]")?.setAttribute("data-dismiss", "")`);
    await page.click("[data-dismiss]");
    await page.waitFor(`${badge("1 problem")} && ${listed}.length === 1`, "the dismissed problem gone");

    // the panel fixes the other: the row has nothing left to say
    await page.click(`label[data-value='${ID}']`);
    const frame = `document.querySelector("iframe[data-panel-key='${KEY}']")`;
    await page.waitFor(`typeof ${frame}?.contentWindow?.fix === "function"`, "the panel's page");
    await page.evaluate(`${frame}.contentWindow.fix()`);
    await page.waitFor(`!${row}.querySelector("button[aria-label^='Weather Station:']") && !${popover}`, "the row's problems gone");
});
