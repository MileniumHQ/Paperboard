// What a person was doing survives what they do next: an edit still waiting
// for typing to pause is saved when its tab is left, an unsaved file is
// still being edited when its tab is opened again, and making the panel
// wider or narrower keeps the open player and an open dialog with what was
// typed in it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { installFakeJava } from "./helpers/fakeJava";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const serverDir = () => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc");
const properties = () => fs.readFileSync(path.join(serverDir(), "server.properties"), "utf8");
const whitelist = JSON.stringify([
    { name: "Steve", uuid: "8667ba71-b85a-4004-af54-457a9734eed7" },
    { name: "Alex", uuid: "ec561538-f3fd-461d-aff5-086b22154bce" },
]);

let ready: Promise<void> | null = null;
/** one stopped Paper 1.21.1 server whose whitelist names Steve and Alex, and the panel served */
async function setUp() {
    ready ??= (async () => {
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
        writeTree(serverDir(), { "server.jar": "jar", "eula.txt": "eula=true\n", "whitelist.json": whitelist, "server.properties": "motd=A Minecraft Server\nlevel-name=world\n" });
        installFakeJava(javaPackageFor("1.21.1")!);
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

const openTab = async (page: Page, id: string, shows: string) => {
    await page.waitFor(`document.querySelector('input[name=serverMenu][value="${id}"]')`, "the server menu");
    await page.click(`input[name=serverMenu][value="${id}"]`);
    await page.waitFor(shows, `the ${id} tab`);
};
/** the text field in the setting row titled `title` */
const fieldIn = (title: string) => `[...document.querySelectorAll("input")].find((el) => el.closest("[class*=PaperSettingItem]")?.querySelector("[data-preset=label]")?.innerText === ${JSON.stringify(title)})`;
const button = (text: string) => `[...document.querySelectorAll("button")].find((b) => !b.closest("[inert]") && b.innerText.trim().endsWith(${JSON.stringify(text)}))`;

describe("leaving a tab", () => {
    test("right after typing a resource pack prompt still saves it", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await openTab(page, "resourcepack", `${fieldIn("Prompt")}`);
            await page.settled();
            await page.evaluate(`${fieldIn("Prompt")}.dataset.test = "prompt"`);
            await page.type('input[data-test="prompt"]', "Grab the pack");
            // gone at once, well inside the pause the tab waits for
            await page.click('input[name=serverMenu][value="overview"]');
            await page.waitFor(`!${fieldIn("Prompt")}`, "the Resource Pack tab to close");
            // the save is sent as the tab goes; the file holds it once it lands
            const deadline = Date.now() + 5_000;
            while (!properties().includes("Grab the pack") && Date.now() < deadline) await Bun.sleep(25);
            await page.settled();
            expect(properties()).toContain("resource-pack-prompt=");
            expect(properties()).toContain("Grab the pack");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

    test("with a file edited and not saved keeps the edit for when the tab is opened again", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        const editor = `document.querySelector("textarea")`;
        try {
            await openTab(page, "files", `document.querySelector('[role=treeitem][data-path="eula.txt"]')`);
            await page.click('[role=treeitem][data-path="eula.txt"]');
            await page.waitFor(`${editor}?.value === "eula=true\\n"`, "eula.txt in the editor");
            await page.evaluate(`(() => { const el = ${editor}; el.focus(); el.setSelectionRange(el.value.length, el.value.length); })()`);
            await page.type("textarea", "# agreed by the owner\n");
            await page.waitFor(`document.querySelector('[aria-label="Unsaved changes"]')`, "the file to show it has unsaved changes");

            await openTab(page, "overview", `!document.querySelector("textarea")`);
            await openTab(page, "files", `${editor}`);
            expect(await page.evaluate<string>(`${editor}.value`)).toBe("eula=true\n# agreed by the owner\n");
            expect(await page.evaluate<boolean>(`Boolean(document.querySelector('[aria-label="Unsaved changes"]'))`)).toBe(true);
            // nothing was written behind the person's back
            expect(fs.readFileSync(path.join(serverDir(), "eula.txt"), "utf8")).toBe("eula=true\n");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("crossing between the phone and the wide layout", () => {
    test("keeps the open player and the tab they are on", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`, "400,800");
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="players"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="players"]');
            await page.waitFor(`document.querySelector('input[name=playersList][value="Steve"]')`, "the roster");
            await page.settled();
            await page.evaluate(`document.querySelector('input[name=playersList][value="Steve"]').closest("label, li, [role=radio]").click()`);
            await page.waitFor(`[...document.querySelectorAll("[role=switch]")].some((el) => !el.closest("[inert]"))`, "Steve's page");
            await page.settled();
            // Steve's page shows his uuid, which only his page does
            const steveShown = `document.body.innerText.includes("8667ba71-b85a-4004-af54-457a9734eed7") && !document.body.innerText.includes("Select a player")`;
            await page.waitFor(steveShown, "Steve's page on the phone");
            await page.evaluate(`document.querySelector('input[name=playersList][value="Steve"]').closest("label, li, [role=radio]").dataset.test = "steve"`);
            await page.resize(1400, 900);
            await page.waitFor(steveShown, "Steve's page in the wide layout");
            expect(await page.evaluate<string | undefined>(`document.querySelector("input[name=serverMenu]:checked")?.value`)).toBe("players");
            // the same roster, not one made again
            expect(await page.evaluate<boolean>(`Boolean(document.querySelector('[data-test="steve"]'))`)).toBe(true);
            await page.resize(400, 800);
            await page.waitFor(steveShown, "Steve's page on the phone again");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

    test("keeps an open dialog with what was typed in it", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        const nameField = `[...document.querySelectorAll("[role=dialog] input")].find((el) => el.value === "world" || el.dataset.test === "name")`;
        try {
            await openTab(page, "worlds", `${button("New World")}`);
            await page.settled();
            await page.evaluate(`${button("New World")}.click()`);
            await page.waitFor(nameField, "the New World dialog");
            await page.evaluate(`(() => { const el = ${nameField}; el.dataset.test = "name"; el.focus(); el.select(); })()`);
            await page.type('input[data-test="name"]', "Skyblock");
            await page.resize(400, 800);
            await page.waitFor(`document.querySelector('[role=dialog] input[data-test="name"]')`, "the dialog on the phone");
            expect(await page.evaluate<string>(`document.querySelector('[role=dialog] input[data-test="name"]').value`)).toBe("Skyblock");
            await page.resize(1400, 900);
            expect(await page.evaluate<string>(`document.querySelector('[role=dialog] input[data-test="name"]').value`)).toBe("Skyblock");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});
