// The panel's own pictures are drawn as pictures: each server's game art on
// the servers list, never its address as text, and every server software's
// logo in a new Minecraft server's setup, so no row stands bare.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { PANEL_ID } from "../src/servers";
import { SOFTWARE_IDS } from "../src/software/catalog";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";

let ready: Promise<void> | null = null;
/** a Minecraft server not set up yet and a Terraria one, and the panel served */
async function setUp() {
    ready ??= (async () => {
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [
            { id: "s-new", name: "Fresh", game: "minecraft", directory: `${SERVERS}/s-new`, createdAt: 0, settings: {} },
            { id: "s-ter", name: "Island", game: "terraria", directory: `${SERVERS}/s-ter`, createdAt: 1, settings: { configured: true, version: "1.4.5.8" } },
        ] }));
        for (const id of ["s-new", "s-ter"]) fs.mkdirSync(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, id), { recursive: true });
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

describe("the panel's pictures", () => {
    test("each server's card on the servers list shows its game's art", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/`, "620,520");
        try {
            await page.waitFor(`document.body.textContent.includes("Fresh") && document.body.textContent.includes("Island")`, "both servers' cards");
            const pictures = await page.evaluate<string[]>(`Promise.all([...document.querySelectorAll("img")].map(async (img) => { await img.decode().catch(() => undefined); return img.naturalWidth > 0 ? new URL(img.src).pathname : "broken " + img.src; }))`);
            expect(pictures.sort()).toEqual(["/assets/games/minecraft/banner.webp", "/assets/games/minecraft/icon.webp", "/assets/games/terraria/banner.webp", "/assets/games/terraria/icon.webp"]);
            // no address is drawn as text
            expect(await page.evaluate<boolean>(`/assets\\/games|panel:|https?:/i.test(document.body.innerText)`)).toBe(false);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

    test("in the dark theme each card's game icon is a whole tile, set off from the card by an edge", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/`, "620,520");
        try {
            await page.waitFor(`document.body.textContent.includes("Fresh") && document.body.textContent.includes("Island")`, "both servers' cards");
            // the theme's colours are read once they land, not as they fade
            await page.evaluate(`document.head.append(Object.assign(document.createElement("style"), { textContent: "* { transition: none !important; }" }))`);
            await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
            await page.waitFor(`getComputedStyle(document.querySelector("[class*=_card_]")).backgroundColor !== "rgb(255, 255, 255)"`, "the dark theme");
            await page.settled();
            // every game's icon fills its tile: none leaves the card's paper showing through it
            const games = fs.readdirSync(path.join(import.meta.dir, "..", "public", "assets", "games"));
            const seeThrough = await page.evaluate<string[]>(`(async () => {
                const out = [];
                for (const game of ${JSON.stringify(games)}) {
                    const img = new Image();
                    img.src = "assets/games/" + game + "/icon.webp";
                    await img.decode();
                    const canvas = document.createElement("canvas");
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0);
                    const alpha = ctx.getImageData(0, 0, canvas.width, canvas.height).data.filter((_, i) => i % 4 === 3);
                    if (alpha.some((a) => a < 255)) out.push(game);
                }
                return out;
            })()`);
            expect(seeThrough).toEqual([]);
            // the ring around each icon is the card's paper; an edge outside it keeps it from melting into the card
            const edges = await page.evaluate<{ shadow: string; card: string; border: string }[]>(`[...document.querySelectorAll("img[src*='/icon.webp']")].map((img) => {
                const tile = img.closest("[class*=iconWrapper]");
                const card = tile.closest("[class*=_card_]");
                return { shadow: getComputedStyle(tile).boxShadow, card: getComputedStyle(card).backgroundColor, border: getComputedStyle(card).borderTopColor };
            })`);
            expect(edges.length).toBe(2);
            for (const { shadow, card, border } of edges) {
                // its first shadow is a ring in the card's own border colour
                expect(shadow.startsWith(`${border} 0px 0px 0px`)).toBe(true);
                expect(border).not.toBe(card);
            }
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

    test("a new Minecraft server's setup shows every server software's logo", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-new`, "620,520");
        try {
            await page.waitFor(`document.querySelectorAll("input[name=serverSoftware]").length === ${SOFTWARE_IDS.length}`, "the software list");
            // each row's logo: a picture that loaded, or a mask whose picture loads; a symbol is a glyph
            const logos = await page.evaluate<Record<string, string>>(`(async () => {
                const out = {};
                for (const input of document.querySelectorAll("input[name=serverSoftware]")) {
                    const row = input.closest("label") ?? input.parentElement;
                    const img = row.querySelector("img");
                    const mask = [...row.querySelectorAll("span")].map((s) => getComputedStyle(s).maskImage).find((m) => m && m !== "none");
                    if (img) {
                        await img.decode().catch(() => undefined);
                        out[input.value] = img.naturalWidth > 0 ? "picture" : "broken picture " + img.src;
                    } else if (mask) {
                        const url = mask.match(/url\\("?(.*?)"?\\)/)[1];
                        out[input.value] = (await fetch(url)).ok ? "mask" : "broken mask " + url;
                    } else out[input.value] = row.querySelector("[class*=PaperIcon]")?.textContent.trim() ? "symbol" : "nothing";
                }
                return out;
            })()`);
            expect(logos).toEqual({ vanilla: "symbol", paper: "picture", fabric: "picture", neoforge: "picture", forge: "mask" });
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});
