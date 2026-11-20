// A damaged backup locations file stands in Computer Info, and setting it
// aside keeps it.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { bootShell, errorGone, errorShown, type Shell } from "./support/shell";

let shell: Shell;
const rail = (label: string) => `[role=radio][aria-label=${JSON.stringify(label)}]`;
const LOCAL = rail("This Computer (127.0.0.1)");
// presses the button reading `label` in the failure titled so, in the view on screen
const pressIn = async (title: string, label: string) => {
    await shell.page.evaluate(`(() => {
        for (const el of document.querySelectorAll("[data-press]")) delete el.dataset.press;
        const failure = [...document.querySelectorAll("[data-paper-error]")].find((e) => e.getAttribute("aria-label") === ${JSON.stringify(title)} && e.offsetParent !== null);
        [...failure.querySelectorAll("button")].find((b) => b.textContent.includes(${JSON.stringify(label)})).dataset.press = "";
    })()`);
    await shell.page.click("[data-press]");
};

beforeAll(async () => {
    shell = await bootShell();
});

afterAll(async () => {
    await shell?.close();
});

async function openInfo(railItem: string): Promise<void> {
    const { page } = shell;
    await page.click(railItem, "right");
    await page.waitFor(`document.querySelector("[data-context-item='Computer Info']")`, "the computer's menu");
    await page.click("[data-context-item='Computer Info']");
}

// Inventory: Backups — a damaged backup locations file stands in Backups, with why and the way to set it aside.
test("a damaged backup locations file stands in Backups until it is set aside", async () => {
    const { page } = shell;
    const file = path.join(shell.dataDir, "backups", "destinations.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    // Computer Info reads its sections again as it comes back into view
    await page.click(rail("Home"));
    await openInfo(LOCAL);
    const title = "The backup locations file is damaged";
    await page.waitFor(errorShown(title, "Set Aside and Start Fresh"), "the damaged file, said in Backups");
    expect(await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Add Location").disabled`)).toBe(true);
    // set aside, never deleted
    await pressIn(title, "Set Aside and Start Fresh");
    await page.waitFor(errorGone(title), "the failure gone once the file is set aside");
    const kept = fs.readdirSync(path.dirname(file)).map((name) => path.join(path.dirname(file), name)).filter((p) => p !== file && fs.statSync(p).isFile());
    expect(kept.some((p) => fs.readFileSync(p, "utf8") === "{ not json")).toBe(true);
    expect(page.exceptions).toEqual([]);
});
