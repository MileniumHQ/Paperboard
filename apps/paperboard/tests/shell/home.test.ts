// Home in the real shell, and what it keeps on disk: a layout that can't be
// read is shown as an error and never saved over, an arrangement made with
// the mouse or the keyboard lands in the layout file, and a save that fails
// says so in place and is saved by Try again.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { waitFor } from "testkit/wait";
import { bootShell, clickText, errorGone, errorShown, type Shell } from "./support/shell";

let shell: Shell;
// the window's Home layout, beside the daemon's own state
const layoutFile = () => path.join(shell.dataDir, "local", "shell-home-layout.json");
const UNREADABLE = '{ "version": 2, "items": [ { "id": "a"';

beforeAll(async () => {
    shell = await bootShell({
        seed: (dataDir) => fs.writeFileSync(path.join(dataDir, "local", "shell-home-layout.json"), UNREADABLE),
    });
});

afterAll(async () => {
    await shell?.close();
});

type Saved = { items: { widgetId: string; x: number; y: number }[] };

/** resolves once the layout file satisfies `ready`; read again and again, since a folder's watcher (fs.watch) misses writes under Bun */
function savedLayout(ready: (saved: Saved) => boolean, what: string): Promise<Saved> {
    const file = layoutFile();
    return waitFor(what, () => {
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
        const text = fs.readFileSync(file, "utf8");
        // the daemon replaces the file whole; a read can't see half of it
        const saved = text ? (JSON.parse(text) as Saved) : null;
        return saved && ready(saved) ? saved : null;
    }, { timeoutMs: 20_000 });
}

const tile = (name: string) => `[role=button][aria-roledescription='movable widget'][aria-label^='${name},']`;
const alertSays = (text: string) => `[...document.querySelectorAll("[role=alert]")].some((a) => a.offsetParent !== null && a.innerText.includes(${JSON.stringify(text)}))`;

async function press(key: string, code: number): Promise<void> {
    for (const type of ["keyDown", "keyUp"]) await shell.page.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code });
}

// Inventory: Data loss — a Home layout that can't be read is never saved over unless asked.
test("a layout that can't be read is shown with why, and the file stays as it was until Start over", async () => {
    const { page } = shell;
    await page.waitFor(`${errorShown("Couldn't load Home", "Try again")} && [...document.querySelectorAll("button")].some((b) => b.textContent === "Start over with an empty Home")`, "Home to say it couldn't load");
    // looking again reads it again, and still writes nothing
    await clickText(page, "button", "Try again");
    await page.waitFor(errorShown("Couldn't load Home"), "Home to say again it couldn't load");
    await page.settled();
    expect(await page.evaluate(`!!document.querySelector("button") && [...document.querySelectorAll("button")].some((b) => b.textContent === "Edit Home")`)).toBe(false);
    expect(fs.readFileSync(layoutFile(), "utf8")).toBe(UNREADABLE);

    await clickText(page, "button", "Start over with an empty Home");
    await page.waitFor(`document.body.innerText.includes("Welcome home")`, "an empty Home");
    expect((await savedLayout((saved) => Array.isArray(saved.items), "the empty layout")).items).toEqual([]);
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a widget added and moved on Home is where it was put after the save.
test("a widget added from the gallery, dragged and moved with the keyboard, is saved where it was left", async () => {
    const { page } = shell;
    await clickText(page, "button", "Add widgets");
    await page.waitFor(`document.querySelector("button[aria-label^='Add Uptime']")`, "the gallery's Uptime");
    await page.click("button[aria-label^='Add Uptime']");
    const added = await savedLayout((saved) => saved.items.some((item) => item.widgetId === "uptime"), "the added Uptime");
    const at = added.items.find((item) => item.widgetId === "uptime")!;

    // the new tile has come to rest, so the drag starts on it and not where it was a frame ago
    await page.motionSettled();
    // dragged one cell to the right and one down, as a mouse would
    const box = await page.evaluate<{ x: number; y: number; cell: number }>(`(() => {
        const rect = document.querySelector(${JSON.stringify(tile("Uptime"))}).getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, cell: rect.width };
    })()`);
    const mouse = (type: string, x: number, y: number) =>
        page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
    await mouse("mousePressed", box.x, box.y);
    for (let step = 1; step <= 8; step++) await mouse("mouseMoved", box.x + (box.cell * 1.1 * step) / 8, box.y + (box.cell * 1.1 * step) / 8);
    await mouse("mouseReleased", box.x + box.cell * 1.1, box.y + box.cell * 1.1);
    await savedLayout((saved) => saved.items.some((item) => item.widgetId === "uptime" && item.x === at.x + 1 && item.y === at.y + 1), "Uptime dragged");

    await page.evaluate(`document.querySelector(${JSON.stringify(tile("Uptime"))}).focus()`);
    await press("ArrowLeft", 37);
    await savedLayout((saved) => saved.items.some((item) => item.widgetId === "uptime" && item.x === at.x && item.y === at.y + 1), "Uptime moved left");
    await clickText(page, "button", "Done");
    // the gallery slides away from over Home's toolbar
    await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent === "Edit Home") && !document.querySelector("aside[aria-label='Widget gallery']")`, "Home arranged");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Data loss — a Home save that fails says so in place, and Try again saves the arrangement.
test("a save that fails is shown in place, and Try again saves what is on screen", async () => {
    const { page } = shell;
    const before = await savedLayout((saved) => saved.items.length === 1, "the arranged layout");
    const { x, y } = before.items[0];
    // the file can't be replaced while a folder stands where it goes
    fs.rmSync(layoutFile());
    fs.mkdirSync(path.join(layoutFile(), "in-the-way"), { recursive: true });

    await clickText(page, "button", "Edit Home");
    await page.evaluate(`document.querySelector(${JSON.stringify(tile("Uptime"))}).focus()`);
    await press("ArrowRight", 39);
    await page.waitFor(`${errorShown("Couldn't save Home", "Changes to Home aren't saved")} && ${alertSays("Couldn't save Home")}`, "Home to say its save failed");

    fs.rmSync(layoutFile(), { recursive: true });
    await clickText(page, "button", "Try again");
    await savedLayout((saved) => saved.items.length === 1 && saved.items[0].x === x + 1 && saved.items[0].y === y, "the retried save");
    await page.waitFor(errorGone("Couldn't save Home"), "the save failure to go");
    expect(page.exceptions).toEqual([]);
});
