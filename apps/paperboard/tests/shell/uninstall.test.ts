// Uninstalling a panel from the real shell: its data stays unless the
// person asks for it to go.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { API_DEMO, bootShell, clickText, WIDGET_DEMO, type Shell } from "./support/shell";

let shell: Shell;
const API_DEMO_ID = "dev.paperboard.apidemo";

beforeAll(async () => {
    shell = await bootShell({ panels: [WIDGET_DEMO, API_DEMO] });
});

afterAll(async () => {
    await shell?.close();
});

const row = (panelId: string) => `label[data-value='${panelId}']`;

/** opens the panel's Uninstall dialog from its menu in the sidebar, and confirms it */
async function uninstall(panelId: string, name: string): Promise<void> {
    const { page } = shell;
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    await page.waitFor(`document.querySelector("${row(panelId)}")`, `${panelId} in the sidebar`);
    await page.click(row(panelId), "right");
    await page.waitFor(`document.querySelector("[data-context-item='Uninstall Panel']")`, "the panel's menu");
    await page.click("[data-context-item='Uninstall Panel']");
    // the dialog asks about the panel by name, in a line a person reads at a glance
    const dialog = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes(${JSON.stringify(`Uninstall ${name}?`)}))`;
    await page.waitFor(`!!${dialog} && ${dialog}.innerText.includes("Its settings and files stay")`, `the Uninstall dialog asking about ${name}`);
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

    await uninstall(id, "API Demo");
    expect(fs.existsSync(path.join(shell.dataDir, "panels", id))).toBe(false);
    expect(fs.readFileSync(config, "utf8")).toBe('{ "kept": true }');
    expect(fs.readFileSync(file, "utf8")).toBe("kept");
    expect(shell.page.exceptions).toEqual([]);
});
