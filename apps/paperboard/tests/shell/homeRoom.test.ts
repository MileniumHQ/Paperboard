// Home with no room left for a widget: pressing it in the gallery says so and
// changes nothing, instead of doing nothing.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { bootShell, clickText, type Shell } from "./support/shell";

let shell: Shell;
const layoutFile = () => path.join(shell.dataDir, "local", "shell-home-layout.json");

// four columns of 4×2 flags, every row down to the grid's last: 16 widgets,
// far fewer than Home holds, and not one free cell in the columns on screen
const FILLED = JSON.stringify({
    version: 2,
    items: Array.from({ length: 16 }, (_, i) => ({
        id: `flag-${i}`,
        computerId: "local",
        widgetId: "flag",
        size: "4x2",
        x: 0,
        y: i * 2,
        source: "builtin",
        options: { flag: "pride" },
    })),
});

beforeAll(async () => {
    shell = await bootShell({ seed: (dataDir) => fs.writeFileSync(path.join(dataDir, "local", "shell-home-layout.json"), FILLED) });
});

afterAll(async () => {
    await shell?.close();
});

const toastSays = (text: string) =>
    `[...document.querySelectorAll("[aria-label=Notifications] [role=status], [aria-label=Notifications] [role=alert]")].some((t) => t.innerText.includes(${JSON.stringify(text)}))`;

// Inventory: Core contracts — a button that can't do what it says tells the person why.
test("adding a widget when no spot on screen fits says there's no room, and saves nothing", async () => {
    const { page } = shell;
    // the gallery leaves four columns of Home beside it, all of them filled
    await page.resize(760, 900);
    await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent === "Edit Home")`, "Home with its flags");
    await clickText(page, "button", "Edit Home");
    await page.waitFor(`document.querySelector("button[aria-label^='Add Uptime']")`, "the gallery's Uptime");
    await page.click("button[aria-label^='Add Uptime']");
    await page.waitFor(toastSays("No room for Uptime"), "a toast saying Uptime has no room");
    await page.settled();
    expect(fs.readFileSync(layoutFile(), "utf8")).toBe(FILLED);
    expect(page.exceptions).toEqual([]);
});
