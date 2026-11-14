// What a person was doing survives what they do next: an edit still waiting
// for typing to pause is saved when its tab is left, leaving Files with an
// unsaved file asks whether to save it (and Cancel keeps it being edited),
// and making the panel wider or narrower keeps the open player and an open
// dialog with what was typed in it.
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

/** presses the server menu's entry `id` where a person would: on its row, which a phone's menu and the wide one both show */
const pressEntry = async (page: Page, id: string) => {
    await page.waitFor(`document.querySelector('input[name=serverMenu][value="${id}"]')`, "the server menu");
    await page.evaluate(`document.querySelector('input[name=serverMenu][value="${id}"]').closest("label").dataset.test = "entry-${id}"`);
    await page.click(`[data-test="entry-${id}"]`);
};
const openTab = async (page: Page, id: string, shows: string) => {
    await pressEntry(page, id);
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
            await pressEntry(page, "overview");
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
});

const EULA = "eula=true\n";
const EDITED = "eula=true\n# agreed by the owner\n";
const eula = () => path.join(serverDir(), "eula.txt");
const editor = `document.querySelector("textarea")`;
const unsaved = `Boolean(document.querySelector('[aria-label="Unsaved changes"]'))`;
const question = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("Save changes to eula.txt?"))`;
const chosenTab = `document.querySelector("input[name=serverMenu]:checked")?.value`;

/** opens Files on eula.txt and types a line into it without saving */
async function editEula(page: Page) {
    await openTab(page, "files", `document.querySelector('[role=treeitem][data-path="eula.txt"]')`);
    await page.click('[role=treeitem][data-path="eula.txt"]');
    await page.waitFor(`${editor}?.value === ${JSON.stringify(EULA)}`, "eula.txt in the editor");
    await page.evaluate(`(() => { const el = ${editor}; el.focus(); el.setSelectionRange(el.value.length, el.value.length); })()`);
    await page.type("textarea", "# agreed by the owner\n");
    await page.waitFor(unsaved, "the file to show it has unsaved changes");
}
/** presses the dialog's button named `name`, as a mouse would */
async function answer(page: Page, name: "Save" | "Discard" | "Cancel") {
    await page.waitFor(question, "the question about the unsaved edit");
    await page.evaluate(`[...${question}.querySelectorAll("button")].find((b) => b.innerText.trim().endsWith(${JSON.stringify(name)})).dataset.test = "answer"`);
    await page.click('[data-test="answer"]');
    // the dialog may already be gone, with what it was over
    await page.evaluate(`document.querySelector('[data-test="answer"]')?.removeAttribute("data-test")`);
}
/** what the person sees once they chose to stay: Files, still chosen, with the edit */
async function stayed(page: Page) {
    await page.waitFor(`!${question}`, "the question to close");
    expect(await page.evaluate<string>(`${editor}.value`)).toBe(EDITED);
    expect(await page.evaluate<boolean>(unsaved)).toBe(true);
    expect(await page.evaluate<string | undefined>(chosenTab)).toBe("files");
}

describe("leaving Files with an unsaved edit asks first", () => {
    test("Cancel stays on Files with the edit, and nothing is written", async () => {
        const served = await setUp();
        fs.writeFileSync(eula(), EULA);
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await editEula(page);
            await pressEntry(page, "overview");
            await answer(page, "Cancel");
            await stayed(page);
            expect(fs.readFileSync(eula(), "utf8")).toBe(EULA);
            // asked again, it asks again
            await pressEntry(page, "overview");
            await answer(page, "Cancel");
            await stayed(page);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

    test("Discard leaves the file as it was, and coming back reads the folder again", async () => {
        const served = await setUp();
        fs.writeFileSync(eula(), EULA);
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await editEula(page);
            await pressEntry(page, "overview");
            await answer(page, "Discard");
            await page.waitFor(`!${editor} && ${chosenTab} === "overview"`, "the Overview tab");
            expect(fs.readFileSync(eula(), "utf8")).toBe(EULA);
            // made while Files was away: the tree shows it on return
            fs.writeFileSync(path.join(serverDir(), "notes.txt"), "hello\n");
            try {
                await openTab(page, "files", `document.querySelector('[role=treeitem][data-path="notes.txt"]')`);
                expect(await page.evaluate<boolean>(unsaved)).toBe(false);
            } finally {
                fs.rmSync(path.join(serverDir(), "notes.txt"));
            }
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

    test("Save writes the edit and then leaves", async () => {
        const served = await setUp();
        fs.writeFileSync(eula(), EULA);
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await editEula(page);
            await pressEntry(page, "logs");
            await answer(page, "Save");
            await page.waitFor(`!${editor} && ${chosenTab} === "logs"`, "the Logs tab");
            expect(fs.readFileSync(eula(), "utf8")).toBe(EDITED);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

    test("a Save that fails stays on Files with its error and the edit", async () => {
        const served = await setUp();
        fs.writeFileSync(eula(), EULA);
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await editEula(page);
            // changed behind the editor's back: the save is refused
            fs.writeFileSync(eula(), "eula=false\n");
            await pressEntry(page, "overview");
            await answer(page, "Save");
            await page.waitFor(`[...document.querySelectorAll("[role=alert]")].some((el) => el.innerText.includes("changed on disk"))`, "the save's error");
            await stayed(page);
            expect(fs.readFileSync(eula(), "utf8")).toBe("eula=false\n");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

    test("All servers asks too, and leaves for the servers once discarded", async () => {
        const served = await setUp();
        fs.writeFileSync(eula(), EULA);
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await editEula(page);
            await pressEntry(page, "home");
            await answer(page, "Cancel");
            await stayed(page);
            expect(await page.evaluate<string>(`location.search`)).toBe("?server=s-mc");
            await pressEntry(page, "home");
            await answer(page, "Discard");
            await page.waitFor(`!new URLSearchParams(location.search).has("server") && !document.querySelector("input[name=serverMenu]")`, "the servers");
            expect(fs.readFileSync(eula(), "utf8")).toBe(EULA);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

    test("on a phone, every Back asks: the file's, the system's and the server's", async () => {
        const served = await setUp();
        fs.writeFileSync(eula(), EULA);
        const page = await openPage(`${served.url}/?server=s-mc`, "400,800");
        /** the Back button on the bar of the page named `name` */
        const back = (name: string) => `[...document.querySelectorAll("[role=region]")].find((r) => r.getAttribute("aria-label").startsWith(${JSON.stringify(name)})).querySelector(":scope > header button[aria-label=Back]")`;
        const pressBack = async (name: string) => {
            // a page slides without changing the DOM, so this is looked at until it is in place
            const inPlace = `Math.abs(${back(name)}.closest("[role=region]").getBoundingClientRect().left) < 1`;
            const deadline = Date.now() + 5_000;
            while (!(await page.evaluate<boolean>(inPlace))) {
                if (Date.now() > deadline) throw new Error(`The ${name} page never slid into place`);
                await Bun.sleep(25);
            }
            await page.evaluate(`${back(name)}.dataset.test = "back"`);
            await page.click('[data-test="back"]');
            await page.evaluate(`delete document.querySelector('[data-test="back"]').dataset.test`);
        };
        const systemBack = () => page.evaluate<boolean>(`(() => { const e = new Event("paperboard:back", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);
        const serverOpen = `!${back("Survival")}.closest("[inert]")`;
        try {
            await editEula(page);
            // the open file is a page of its own: its Back closes the file
            await pressBack("eula.txt");
            await answer(page, "Cancel");
            await stayed(page);
            // the file's page never slid away
            expect(await page.evaluate<boolean>(`${back("eula.txt")}.closest("[inert]") === null`)).toBe(true);
            expect(await systemBack()).toBe(true);
            await answer(page, "Cancel");
            await stayed(page);

            await pressBack("Survival");
            await answer(page, "Cancel");
            await stayed(page);
            expect(await page.evaluate<boolean>(serverOpen)).toBe(true);

            await pressBack("Survival");
            await answer(page, "Discard");
            await page.waitFor(`!new URLSearchParams(location.search).has("server")`, "the servers list");
            expect(fs.readFileSync(eula(), "utf8")).toBe(EULA);
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
            await pressEntry(page, "players");
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
