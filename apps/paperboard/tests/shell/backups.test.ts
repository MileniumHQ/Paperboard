// Backup locations in Computer Info, in an Electron window (browser mode
// cannot host a browser sign-in), with the host running main's own Google
// Drive sign-in against a browser tab the person closed. The computer holds
// a Drive location with no sign-in in its vault, so nothing reaches Google.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { ELECTRON_PRELOAD } from "./support/electronPreload";
import { bootShell, clickText, type Shell } from "./support/shell";

const LOCAL = `[role=radio][aria-label="This Computer (127.0.0.1)"]`;
const dialog = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("Add Backup Location"))`;
const button = (text: string) => `[...${dialog}.querySelectorAll("button")].find((b) => b.textContent.includes(${JSON.stringify(text)}))`;

const DRIVE = { id: "d-0123456789ab", kind: "gdrive", label: "Team Drive", drive: { clientId: "browser-suite", folderId: "folder" } };
const reconnectRow = `[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Reconnect") && b.offsetParent !== null)?.parentElement`;

let shell: Shell;

beforeAll(async () => {
    shell = await bootShell({
        init: ELECTRON_PRELOAD,
        seed: (dataDir) => {
            fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });
            fs.writeFileSync(path.join(dataDir, "backups", "destinations.json"), JSON.stringify({ version: 1, destinations: [DRIVE], panels: {} }));
        },
    });
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — a Google sign-in whose tab was closed can be canceled and tried again.
test("a Google Drive sign-in left waiting can be canceled from its window, and signing in again opens the browser again", async () => {
    const { page } = shell;
    await page.click(LOCAL, "right");
    await page.waitFor(`document.querySelector("[data-context-item='Computer Info']")`, "the computer's menu");
    await page.click("[data-context-item='Computer Info']");
    await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Add Location") && b.offsetParent !== null)`, "the Backups section");

    for (const attempt of [1, 2]) {
        await clickText(page, "button", "Add Location");
        await page.waitFor(`${button("Sign In With Google")}`, "the Google Drive form");
        await clickText(page, "button", "Sign In With Google");
        expect(await shell.host<number>({ cmd: "google-sign-ins", atLeast: attempt })).toBe(attempt);
        await page.waitFor(`${button("Waiting for Google...")}`, "the sign-in, waiting");
        // the person closed Google's tab: Cancel stops the sign-in and closes the window
        expect(await page.evaluate(`${button("Cancel")}.disabled`)).toBe(false);
        await clickText(page, "button", "Cancel");
        await page.waitFor(`!${dialog}`, "the window closed");
    }

    // signing a location in again waits the same way, and cancels the same way
    await page.waitFor(reconnectRow, "the Drive location's Reconnect");
    await clickText(page, "button", "Reconnect");
    expect(await shell.host<number>({ cmd: "google-sign-ins", atLeast: 3 })).toBe(3);
    await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Waiting for Google...") && b.offsetParent !== null)`, "the reconnect, waiting");
    await clickText(page, "button", "Cancel");
    await page.waitFor(`${reconnectRow} && !document.body.innerText.includes("Waiting for Google...")`, "Reconnect back");
    expect(await page.evaluate(`document.body.innerText.includes("could not be reconnected")`)).toBe(false);
    await clickText(page, "button", "Reconnect");
    expect(await shell.host<number>({ cmd: "google-sign-ins", atLeast: 4 })).toBe(4);
    await clickText(page, "button", "Cancel");
    await page.waitFor(`${reconnectRow} && !document.body.innerText.includes("Waiting for Google...")`, "Reconnect back");
    expect(page.exceptions).toEqual([]);
});
