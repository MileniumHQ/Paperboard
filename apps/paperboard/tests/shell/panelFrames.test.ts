// Open panels in the real shell, each in its own frame: what restarting one
// does to the others.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { API_DEMO, bootShell, WIDGET_DEMO, type Shell } from "./support/shell";

let shell: Shell;
const WIDGETS = "local::dev.paperboard.widgetdemo";
const API = "local::dev.paperboard.apidemo";
const frame = (key: string) => `document.querySelector("iframe[data-panel-key='${key}']")`;
// a panel's page has loaded and told the shell it is ready
const loaded = (key: string) => `${frame(key)}?.contentDocument?.readyState === "complete" && ${frame(key)}.contentDocument.location.href !== "about:blank"`;

beforeAll(async () => {
    shell = await bootShell({ panels: [WIDGET_DEMO, API_DEMO] });
});

afterAll(async () => {
    await shell?.close();
});

async function open(panelId: string, key: string): Promise<void> {
    await shell.page.waitFor(`document.querySelector("label[data-value='${panelId}']")`, `${panelId} in the sidebar`);
    await shell.page.click(`label[data-value='${panelId}']`);
    await shell.page.waitFor(loaded(key), `${panelId}'s page to load`);
}

// Inventory: Core contracts — restarting one panel leaves every other open panel's page alone.
test("restarting one panel reloads only that panel's page", async () => {
    const { page } = shell;
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    await open("dev.paperboard.widgetdemo", WIDGETS);
    await open("dev.paperboard.apidemo", API);
    // each document marked: a reloaded frame holds a new one
    await page.evaluate(`${frame(WIDGETS)}.contentWindow.kept = true; ${frame(API)}.contentWindow.kept = true;`);
    const widgetsSrc = await page.evaluate<string>(`${frame(WIDGETS)}.src`);

    await page.click("label[data-value='dev.paperboard.apidemo']", "right");
    await page.waitFor(`document.querySelector("[data-context-item='Restart Panel']")`, "the panel's menu");
    await page.click("[data-context-item='Restart Panel']");
    await page.waitFor(`${loaded(API)} && !${frame(API)}.contentWindow.kept`, "API Demo to load again");

    expect(await page.evaluate(`${frame(WIDGETS)}.src`)).toBe(widgetsSrc);
    expect(await page.evaluate(`${frame(WIDGETS)}.contentWindow.kept`)).toBe(true);
    expect(page.exceptions).toEqual([]);
});
