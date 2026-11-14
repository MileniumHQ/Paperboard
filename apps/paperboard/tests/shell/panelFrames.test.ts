// Open panels in the real shell, each in its own frame: what restarting one
// does to the others, a page with unsaved work having its say before the
// shell takes it away, and a panel that can't load saying why, or whose
// service can't start saying what the service said.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { API_DEMO, bootShell, WIDGET_DEMO, type DevPanel, type Shell } from "./support/shell";

// an editor whose note is unsaved until Save, and asks before it goes
const NOTES: DevPanel = {
    source: path.join(import.meta.dir, "support/notes-panel"),
    pages: ["panel.ts"],
    service: "service.ts",
    html: ["index.html"],
};

// a panel whose service throws as it starts
const FAILING: DevPanel = {
    source: path.join(import.meta.dir, "support/failing-panel"),
    pages: ["panel.ts"],
    service: "service.ts",
    html: ["index.html"],
};

let shell: Shell;
const WIDGETS = "local::dev.paperboard.widgetdemo";
const API = "local::dev.paperboard.apidemo";
const frame = (key: string) => `document.querySelector("iframe[data-panel-key='${key}']")`;
// a panel's page has loaded and told the shell it is ready
const loaded = (key: string) => `${frame(key)}?.contentDocument?.readyState === "complete" && ${frame(key)}.contentDocument.location.href !== "about:blank"`;

beforeAll(async () => {
    shell = await bootShell({ panels: [WIDGET_DEMO, API_DEMO, NOTES, FAILING] });
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

const NOTES_KEY = "local::dev.paperboard.testnotes";
// the note's page, reached from the shell (its own policy allows no eval)
const notesDoc = `${frame(NOTES_KEY)}.contentDocument`;
const notesWin = `${frame(NOTES_KEY)}.contentWindow`;

/** resolves once `check` holds in the note's page; page.waitFor watches the shell's document only */
const inNotes = (check: string, what: string) =>
    shell.page.evaluate(`new Promise((resolve, reject) => {
        const doc = ${notesDoc};
        const ok = () => ${check};
        if (ok()) return resolve(true);
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error(${JSON.stringify(`Timed out waiting for ${what}`)})); }, 20000);
        const observer = new MutationObserver(() => { if (ok()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
        observer.observe(doc, { subtree: true, childList: true, attributes: true });
    })`);

async function restartFromMenu(panelId: string): Promise<void> {
    await shell.page.click(`label[data-value='${panelId}']`, "right");
    await shell.page.waitFor(`document.querySelector("[data-context-item='Restart Panel']")`, "the panel's menu");
    await shell.page.click("[data-context-item='Restart Panel']");
}

// Inventory: Data loss — a page holding unsaved work is asked before the shell restarts it.
test("restarting a panel with an unsaved note asks the panel first: Stay keeps the page, Discard restarts it", async () => {
    const { page } = shell;
    await open("dev.paperboard.testnotes", NOTES_KEY);
    await page.evaluate(`(() => { const note = ${notesDoc}.getElementById("note"); note.value = "groceries"; note.dispatchEvent(new (${notesWin}).Event("input")); ${notesWin}.kept = true; })()`);
    // looking at another panel: the shell brings the note back to ask
    await open("dev.paperboard.apidemo", API);

    await restartFromMenu("dev.paperboard.testnotes");
    await inNotes(`!doc.getElementById("ask").hidden`, "the note to ask about its unsaved changes");
    // the note is the panel in view while it asks
    expect(await page.evaluate(`${frame(NOTES_KEY)}.parentElement.className.includes("_away_")`)).toBe(false);
    await page.evaluate(`${notesDoc}.getElementById("stay").click()`);
    await inNotes(`doc.getElementById("ask").hidden`, "the note's dialog to close");
    // a stay leaves the page, and its note, as they were
    expect(await page.evaluate(`${notesWin}.kept === true && ${notesDoc}.getElementById("note").value`)).toBe("groceries");
    expect(await page.evaluate(`document.body.innerText.includes("Restarting panel service")`)).toBe(false);

    await restartFromMenu("dev.paperboard.testnotes");
    await inNotes(`!doc.getElementById("ask").hidden`, "the note to ask again");
    await page.evaluate(`${notesDoc}.getElementById("discard").click()`);
    await page.waitFor(`${loaded(NOTES_KEY)} && !${frame(NOTES_KEY)}.contentWindow.kept`, "the note to restart");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — an installed panel that can't load says why where the panels are listed.
test("a panel whose manifest is broken is listed with why it can't load", async () => {
    const { page } = shell;
    const broken = path.join(shell.dataDir, "panels", "dev.example.broken");
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(broken, "manifest.json"), "{ this is not a manifest");
    // choosing the computer lists its panels again
    await page.click("[role=radio][aria-label='Home']");
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    await page.waitFor(
        `[...document.querySelectorAll("[role=alert]")].some((a) => a.offsetParent !== null && a.innerText.includes("Panel can't load") && a.innerText.includes("dev.example.broken"))`,
        "the broken panel, with why, in the panel list",
    );
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a panel whose service can't start says what the service said, where its page fails.
test("a panel whose service can't start shows the service's own reason under the failure", async () => {
    const { page } = shell;
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    await page.waitFor(`document.querySelector("label[data-value='dev.paperboard.testfailing']")`, "the failing panel in the sidebar");
    await page.click("label[data-value='dev.paperboard.testfailing']");
    await page.waitFor(
        `[...document.querySelectorAll("[role=alert]")].some((a) => a.offsetParent !== null && a.nextElementSibling?.innerText === "Its service stopped: the config file is unreadable")`,
        "the service's reason under the panel's failure",
    );
    expect(page.exceptions).toEqual([]);
});
