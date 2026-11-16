// Uninstalling a panel from the real shell: its data stays unless the
// person asks for it to go, and packages the uninstall could not remove are
// told to them in its dialog, which stays open to say so, though the panel
// itself is gone.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { API_DEMO, bootShell, clickText, errorShown, WIDGET_DEMO, type Shell } from "./support/shell";

let shell: Shell;
const API_DEMO_ID = "dev.paperboard.apidemo";
const WIDGET_DEMO_ID = "dev.paperboard.widgetdemo";

beforeAll(async () => {
    shell = await bootShell({ panels: [WIDGET_DEMO, API_DEMO] });
});

afterAll(async () => {
    await shell?.close();
});

const row = (panelId: string) => `label[data-value='${panelId}']`;

/** opens the panel's Uninstall dialog from its menu in the sidebar, and confirms it */
async function uninstall(panelId: string): Promise<void> {
    const { page } = shell;
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    await page.waitFor(`document.querySelector("${row(panelId)}")`, `${panelId} in the sidebar`);
    await page.click(row(panelId), "right");
    await page.waitFor(`document.querySelector("[data-context-item='Uninstall Panel']")`, "the panel's menu");
    await page.click("[data-context-item='Uninstall Panel']");
    await page.waitFor(`[...document.querySelectorAll("[role=dialog]")].some((d) => d.innerText.includes("Uninstall Panel"))`, "the Uninstall dialog");
    await clickText(page, "button", "Uninstall");
    await page.waitFor(`!document.querySelector("${row(panelId)}")`, `${panelId} to leave the sidebar`);
}

// Inventory: Data loss — uninstalling a panel keeps its configuration and files unless asked.
test("a panel uninstalled as the dialog opens keeps its configuration and files", async () => {
    const id = API_DEMO_ID;
    const config = path.join(shell.dataDir, "configs", `${id}.json`);
    const file = path.join(shell.dataDir, "files", id, "kept.txt");
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(config, '{ "kept": true }');
    fs.writeFileSync(file, "kept");

    await uninstall(id);
    expect(fs.existsSync(path.join(shell.dataDir, "panels", id))).toBe(false);
    expect(fs.readFileSync(config, "utf8")).toBe('{ "kept": true }');
    expect(fs.readFileSync(file, "utf8")).toBe("kept");
    expect(shell.page.exceptions).toEqual([]);
});

// Inventory: Core contracts — what an uninstall left behind is told to the person who asked for it.
test("an uninstall whose packages can't be removed says so in its dialog once the panel is gone, until it is closed", async () => {
    const { page } = shell;
    // which panels use which package can't be read, so none can be released
    const users = path.join(shell.dataDir, "packages", "users.json");
    fs.mkdirSync(path.dirname(users), { recursive: true });
    fs.writeFileSync(users, "{ not json");

    await uninstall(WIDGET_DEMO_ID);
    const dialog = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("Panel Uninstalled"))`;
    const title = "Couldn't remove the packages only Widget Demo used";
    await page.waitFor(
        `${errorShown(title, `${WIDGET_DEMO_ID} is uninstalled, but the packages only it used could not be removed`)} && !!${dialog}?.querySelector("[data-paper-error][role=alert]")`,
        "the uninstall's warning, in its dialog",
    );
    expect(fs.existsSync(path.join(shell.dataDir, "panels", WIDGET_DEMO_ID))).toBe(false);
    // nothing more to confirm: the dialog only closes
    expect(await page.evaluate<string[]>(`[...${dialog}.querySelectorAll("button:not([aria-label])")].map((b) => b.innerText.trim())`)).toEqual(["Close"]);
    await clickText(page, "button", "Close");
    await page.waitFor(`![...document.querySelectorAll("[role=dialog]")].some((d) => d.innerText.includes("Panel Uninstalled"))`, "the dialog closed");
    expect(page.exceptions).toEqual([]);
});
