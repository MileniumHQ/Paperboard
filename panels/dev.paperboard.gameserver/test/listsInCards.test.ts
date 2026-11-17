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
        writeTree(serverDir("s-mc"), { "server.jar": "jar", "eula.txt": "eula=true\n", "whitelist.json": whitelist });
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
