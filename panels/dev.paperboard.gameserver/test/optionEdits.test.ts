// An option typed on a game's Options tab is what lands in the game's own
// config file, whether Enter is pressed or the field is left; a number out
// of its range is never written and the row says why while it is.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { freePort, installPalworld, PALWORLD_BUILD } from "./helpers/palworld";
import { PANEL_ID } from "../src/servers";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const configFile = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const serverDir = () => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-pal");
const ini = () => fs.readFileSync(path.join(serverDir(), "saved", "Config", "LinuxServer", "PalWorldSettings.ini"), "utf8");
const settings = () => JSON.parse(fs.readFileSync(configFile(), "utf8")).servers[0].settings as Record<string, unknown>;

let ready: Promise<void> | null = null;
/** one stopped, installed Palworld server, and the panel served */
async function setUp() {
    ready ??= (async () => {
        fs.mkdirSync(path.dirname(configFile()), { recursive: true });
        fs.writeFileSync(configFile(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-pal", name: "Pals", game: "palworld", directory: `${SERVERS}/s-pal`, createdAt: 0, settings: { configured: true, port: await freePort(), restPort: await freePort(), build: PALWORLD_BUILD } }] }));
        installPalworld(serverDir());
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

/** the text field in the option row titled `title` */
const fieldIn = (title: string) => `[...document.querySelectorAll("input")].find((el) => el.closest("[class*=PaperSettingItem]")?.querySelector("[data-preset=label]")?.innerText === ${JSON.stringify(title)})`;
const rowText = (page: Page, title: string) => page.evaluate<string>(`${fieldIn(title)}.closest("[class*=PaperSettingItem]").innerText`);

async function openOptions(page: Page, name: string) {
    await page.waitFor(`document.querySelector('input[name=serverMenu][value="options"]')`, "the server menu");
    await page.click('input[name=serverMenu][value="options"]');
    await page.waitFor(`${fieldIn("Server name")}?.value === ${JSON.stringify(name)}`, "the stored server name");
}
/** replaces what the field holds with `text`, as a person selecting it all and typing would */
async function retype(page: Page, title: string, text: string, enter?: boolean) {
    await page.evaluate(`(() => { const el = ${fieldIn(title)}; el.dataset.test = "editing"; el.focus(); el.select(); })()`);
    await page.type('input[data-test="editing"]', text, enter);
    await page.evaluate(`delete ${fieldIn(title)}.dataset.test`);
}

describe("a game's text option", () => {
    test("typed and committed with Enter, or by leaving the field, is written to the game's config file", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-pal`);
        try {
            await openOptions(page, "Default Palworld Server");
            await retype(page, "Server name", "Friday Night Pals", true);
            await page.settled();
            await page.waitFor(`${fieldIn("Server name")}.value === "Friday Night Pals" && document.activeElement?.tagName !== "INPUT"`, "Enter to commit");
            await page.settled();
            expect(ini()).toContain('ServerName="Friday Night Pals"');

            // left by clicking elsewhere, it saves too, and shows what was saved
            await retype(page, "Server name", "Pals of the Weekend");
            await page.evaluate(`document.activeElement.blur()`);
            await page.settled();
            await page.waitFor(`${fieldIn("Server name")}.value === "Pals of the Weekend"`, "the field to show what was saved");
            await page.settled();
            expect(ini()).toContain('ServerName="Pals of the Weekend"');

            // opened again, the tab reads it back from the file
            await page.click('input[name=serverMenu][value="overview"]');
            await page.click('input[name=serverMenu][value="options"]');
            await page.waitFor(`${fieldIn("Server name")}?.value === "Pals of the Weekend"`, "the saved name read back");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("a game's number option", () => {
    test("out of its range, it says the range, is not written, and stays until corrected", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-pal`);
        const port = settings().port;
        try {
            await openOptions(page, "Pals of the Weekend");
            expect(await rowText(page, "Port")).not.toContain("must be");
            await retype(page, "Port", "70000");
            await page.waitFor(`${fieldIn("Port")}.closest("[class*=PaperSettingItem]").innerText.includes("Port must be a whole number from 1 to 65535.")`, "the range to be named");
            await page.evaluate(`document.activeElement.blur()`);
            await page.settled();
            // left, it still shows what was typed and why it was not saved
            expect(await page.evaluate<string>(`${fieldIn("Port")}.value`)).toBe("70000");
            expect(await rowText(page, "Port")).toContain("Port must be a whole number from 1 to 65535.");
            expect(settings().port).toBe(port);

            await retype(page, "Port", "8300", true);
            await page.settled();
            await page.waitFor(`!${fieldIn("Port")}.closest("[class*=PaperSettingItem]").innerText.includes("must be")`, "the reason to go");
            await page.settled();
            expect(settings().port).toBe(8300);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

});
