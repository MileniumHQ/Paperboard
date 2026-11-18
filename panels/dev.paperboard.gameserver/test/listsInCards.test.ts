// The version list, the player roster and the add-on results sit where
// Pxl's review asked: the version list and the roster in a PaperCard (the
// rows stay one PaperList, not a card each), the Compatibility notice read
// before the list it is about, and what a search found as PaperMediaCards.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { installFakeJava } from "./helpers/fakeJava";
import { loopbackServer, routeHost } from "./helpers/http";
import { writeTree } from "./helpers/tmp";
import { strToU8, zipSync } from "fflate";
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
const configFile = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const serverDir = (id: string) => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, id);

const paper = loopbackServer((_req, url) =>
    url.pathname === "/v3/projects/paper" ? Response.json({ versions: { "1.21": ["1.21.4", "1.21.1"] } }) : new Response("Not found", { status: 404 }),
);
routeHost("fill.papermc.io", paper);

const SHOTS = process.env.PAPERBOARD_SHOTS;

let ready: Promise<void> | null = null;
/** a Paper server whose whitelist names two players, and one with nobody; the panel served */
async function setUp() {
    ready ??= (async () => {
        const server = (id: string, name: string) => ({ id, name, game: "minecraft", directory: `${SERVERS}/${id}`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } });
        fs.mkdirSync(path.dirname(configFile()), { recursive: true });
        fs.writeFileSync(configFile(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [server("s-mc", "Survival"), server("s-empty", "Quiet")] }));
        const whitelist = JSON.stringify([
            { name: "Steve", uuid: "8667ba71-b85a-4004-af54-457a9734eed7" },
            { name: "Alex", uuid: "ec561538-f3fd-461d-aff5-086b22154bce" },
        ]);
        writeTree(serverDir("s-mc"), { "server.jar": "jar", "eula.txt": "eula=true\n", "whitelist.json": whitelist, "server.properties": "level-name=world\nresource-pack=https://example.com/pack.zip\n", "world/level.dat": "w", "creative_flat/level.dat": "c", "plugins/Essentials.jar": zipSync({ "plugin.yml": strToU8("name: Essentials\nmain: x.Main\nversion: 1.0\n"), "x/Main.class": strToU8("class") }) });
        writeTree(serverDir("s-empty"), { "server.jar": "jar", "eula.txt": "eula=true\n" });
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
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(shows)})`, `the ${id} tab`);
};
/** the nearest PaperCard around `selector`'s element, as a page expression */
const cardAround = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.closest('[class*="PaperCard"]')`;
/** the empty room under a card's last row */
const roomUnderRows = (name: string) => `(() => {
    const rows = [...document.querySelectorAll("input[name=${name}]")].map((i) => i.closest("label"));
    const card = rows[0].closest('[class*="PaperCard"]');
    return card.getBoundingClientRect().bottom - rows[rows.length - 1].getBoundingClientRect().bottom;
})()`;
/** with PAPERBOARD_SHOTS set: the page as a person sees it, light and dark, on a desktop and on a phone */
const shot = async (page: Page, name: string) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [width, height] of [[1400, 813], [390, 800]] as const) {
        await page.resize(width, height);
        for (const scheme of ["light", "dark"]) {
            await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
            // quiet: lets the theme's color transitions finish before the picture is taken
            await new Promise((resolve) => setTimeout(resolve, 800));
            await page.settled();
            fs.writeFileSync(path.join(SHOTS, `${name}-${width}-${scheme}.png`), await page.screenshot());
        }
    }
    // the test goes on at the size it started at
    await page.resize(1400, 813);
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    await page.settled();
};

describe("the version list", () => {
    test("is in a card of its own with the checkboxes in another, and the Compatibility notice comes before both", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await openTab(page, "versions", "Minecraft version");
            await page.waitFor(`document.querySelector('input[name=minecraftVersion][value="1.21.4"]')`, "the version list");
            await page.settled();
            const list = cardAround("input[name=minecraftVersion]");
            expect(await page.evaluate<boolean>(`!!${list}`)).toBe(true);
            // the rows are one list, not a card each
            expect(await page.evaluate<number>(`${list}.querySelectorAll('[class*="PaperCard"]').length`)).toBe(0);
            // Releases and Snapshots share a card that is not the list's
            expect(await page.evaluate<boolean>(`(() => { const c = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent === "Releases")?.closest('[class*="PaperCard"]'); return !!c && c.innerText.includes("Snapshots") && c !== ${list} && !c.querySelector("input[name=minecraftVersion]"); })()`)).toBe(true);
            // the notice is read before the list
            expect(await page.evaluate<boolean>(`(() => { const notice = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 || e.innerText).find((e) => e.innerText?.startsWith("Compatibility") && e.innerText.length < 200); const input = document.querySelector("input[name=minecraftVersion]"); return !!notice && !!(notice.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING); })()`)).toBe(true);
            // a short list leaves no empty card under its last row
            expect(await page.evaluate<number>(roomUnderRows("minecraftVersion"))).toBeLessThanOrEqual(4);
            await shot(page, "versions");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("the player roster", () => {
    test("is in a card, and so is its empty state", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await openTab(page, "players", "Steve");
            await page.settled();
            expect(await page.evaluate<boolean>(`!!${cardAround("input[name=playersList]")}`)).toBe(true);
            // the detail side stays as it was: no card around "Select a player"
            expect(await page.evaluate<boolean>(`!document.querySelector("input[name=playersList]").closest('[class*="PaperCard"]')?.innerText.includes("Select a player")`)).toBe(true);
            // the roster fills its column to the bottom, short list or not
            expect(await page.evaluate<number>(`(() => { const card = ${cardAround("input[name=playersList]")}; return card.parentElement.getBoundingClientRect().bottom - card.getBoundingClientRect().bottom; })()`)).toBeLessThanOrEqual(4);
            expect(await page.evaluate<number>(roomUnderRows("playersList"))).toBeGreaterThan(40);
            // the room under the rows is the card's own surface, not a band of the list's
            expect(await page.evaluate<string>(`getComputedStyle(document.querySelector("input[name=playersList]").closest('[class*="_PaperList_"]')).backgroundColor`)).toBe("rgba(0, 0, 0, 0)");
            await shot(page, "players");
        } finally {
            await page.close();
        }
        const empty = await openPage(`${served.url}/?server=s-empty`);
        try {
            await openTab(empty, "players", "No players yet");
            expect(await empty.evaluate<boolean>(`(() => { const t = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.startsWith("No players yet")); return !!t?.closest('[class*="PaperCard"]'); })()`)).toBe(true);
            await shot(empty, "players-empty");
            expect(empty.exceptions).toEqual([]);
        } finally {
            await empty.close();
            served.stop();
        }
    }, 60_000);
});

/** every element that matches `selector`, as a page expression */
const all = (selector: string) => `[...document.querySelectorAll(${JSON.stringify(selector)})]`;

describe("the worlds and the installed add-ons", () => {
    test("each world is a PaperMediaCard with its Active badge that opens its dialog, and the same for an installed plugin", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await openTab(page, "worlds", "creative_flat");
            await page.settled();
            const worlds = await page.evaluate<string[]>(`${all("[data-world]")}.map((c) => c.dataset.world)`);
            expect(worlds.sort()).toEqual(["creative_flat", "world"]);
            expect(await page.evaluate<boolean>(`${all("[data-world]")}.every((c) => c.getAttribute("role") === "button" && c.matches('[class*="_card_"]'))`)).toBe(true);
            expect(await page.evaluate<boolean>(`!document.querySelector("input[name=worlds]")`)).toBe(true);
            // the active one wears its badge; the other does not
            expect(await page.evaluate<string>(`document.querySelector('[data-world="world"]').textContent`)).toContain("Active");
            expect(await page.evaluate<string>(`document.querySelector('[data-world="creative_flat"]').textContent`)).not.toContain("Active");
            // pressing a card opens that world's dialog with its actions
            await page.evaluate(`document.querySelector('[data-world="creative_flat"]').click()`);
            await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("Switch to this world")`, "the world's dialog");
            expect(await page.evaluate<string>(`document.querySelector("[role=dialog]").innerText`)).toContain("Delete");
            await page.evaluate(`[...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.trim() === "Close").click()`);
            await shot(page, "worlds");

            await openTab(page, "plugins", "Installed Plugins");
            await page.waitFor(`document.querySelector("[data-addon]")`, "the installed plugin");
            await page.settled();
            expect(await page.evaluate<boolean>(`!document.querySelector("input[name=addon-installed]")`)).toBe(true);
            const card = `document.querySelector('[data-addon="Essentials.jar"]')`;
            expect(await page.evaluate<boolean>(`${card}.matches('[class*="_card_"]') && ${card}.innerText.includes("Essentials")`)).toBe(true);
            // its status badge stands on the card, and a card with no actions has no empty footer
            expect(await page.evaluate<string>(`${card}.querySelector('[class*="_badge_"]').textContent`)).toBe("Installed");
            expect(await page.evaluate<boolean>(`!${card}.querySelector('[class*="_footer_"]')`)).toBe(true);
            await shot(page, "plugins");

            // a kind with actions puts them on the card: the resource pack's Remove
            await openTab(page, "resourcepack", "Current Resource Pack");
            await page.waitFor(`document.querySelector('[data-addon="resource-pack"]')`, "the current resource pack");
            expect(await page.evaluate<string[]>(`[...document.querySelector('[data-addon="resource-pack"]').querySelectorAll("button")].map((b) => b.innerText.trim())`)).toEqual(["delete\nRemove"]);
            await shot(page, "resourcepack");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("add-on browse results", () => {
    test("are PaperMediaCards, a card to each project", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            // the page searches Modrinth itself; answer it from here
            await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://api.modrinth.com/*" }] });
            page.on(({ method, params }) => {
                if (method !== "Fetch.requestPaused") return;
                const hits = ["VeinMiner", "Terralith", "Tectonic"].map((title) => ({ project_id: title.toLowerCase(), slug: title.toLowerCase(), title, description: `${title} changes the world.`, downloads: 1_000_000, follows: 5 }));
                void page.send("Fetch.fulfillRequest", {
                    requestId: params.requestId,
                    responseCode: 200,
                    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }],
                    body: Buffer.from(JSON.stringify({ hits })).toString("base64"),
                });
            });
            await openTab(page, "datapacks", "Datapack");
            await page.waitFor(`document.body.innerText.includes("Terralith")`, "the search results");
            await page.settled();
            expect(await page.evaluate<number>(`[...document.querySelectorAll('[class*="_card_"]')].filter((c) => c.querySelector('[class*="_headerRow_"]') && /VeinMiner|Terralith|Tectonic/.test(c.innerText)).length`)).toBe(3);
            // the results are not a list of rows
            expect(await page.evaluate<boolean>(`!document.querySelector("input[name=addon-results]")`)).toBe(true);
            await shot(page, "datapacks");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});
