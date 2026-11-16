// Terraria's own pages, pressed as a person would: the Overview's world,
// join password and message of the day, the Worlds tab's switch, new world
// and download, and a tModLoader server's Mods from the Steam Workshop.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { processApi } from "@mileniumhq/paperapi";
import { serverCalls } from "./helpers/serverCall";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { loopbackServer, routeHost } from "./helpers/http";
import { freePort } from "./helpers/palworld";
import { placeStandIn } from "./helpers/standIn";
import { fakeSteamcmd } from "./helpers/steamcmd";
import { tempDir, writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { entrypoint, releaseFor, tmodloaderReleases } from "../src/games/terraria/catalog";
import { terrariaWorld } from "./helpers/terrariaWorld";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const config = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const settingsOf = (id: string) => (JSON.parse(fs.readFileSync(config(), "utf8")).servers as { id: string; settings: Record<string, unknown> }[]).find((s) => s.id === id)!.settings;
const folder = (id: string) => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, id);
const vanilla = releaseFor("1.4.5.8");

/** a .tmod as tModLoader writes one: its header, a file table holding only Info, and Info naming the mod */
function tmod(name: string, displayName: string): Uint8Array {
    const text = (value: string) => { const utf8 = Buffer.from(value, "utf8"); return Buffer.concat([Buffer.from([utf8.length]), utf8]); };
    const int32 = (value: number) => { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; };
    const info = Buffer.concat([text("displayName"), text(displayName), text("")]);
    const data = Buffer.concat([text(name), text("1.0.0"), int32(1), text("Info"), int32(info.length), int32(info.length), info]);
    return Buffer.concat([Buffer.from("TMOD"), text("2026.8.1.0"), Buffer.alloc(20 + 256), int32(data.length), data]);
}

const WING_SLOT = "3000000001";
const META = { attribution: "Data from Steam Workshop", source: "https://steamcommunity.com/", legal: "Valve's terms.", disclaimer: "Not endorsed by Valve." };
const wingSlot = { id: WING_SLOT, title: "Wing Slot", description: "An accessory slot for wings.", previewImageUrl: null, tags: ["Accessories"], authorId: "1", subscriptions: 1200, favorites: 30, timeUpdated: 1_700_000_000, fileSize: 2048, children: [], workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${WING_SLOT}` };

let ready: Promise<void> | null = null;
/** a vanilla server with two worlds and a tModLoader server with a mod put in by hand, both stopped */
async function setUp() {
    ready ??= (async () => {
        fs.mkdirSync(path.dirname(config()), { recursive: true });
        fs.writeFileSync(config(), JSON.stringify({
            version: 2,
            serversDirectory: SERVERS,
            servers: [
                { id: "s-ter", name: "Island", game: "terraria", directory: `${SERVERS}/s-ter`, createdAt: 0, settings: { configured: true, version: vanilla.version, port: await freePort(), world: "Island" } },
                { id: "s-tml", name: "Modded", game: "terraria", directory: `${SERVERS}/s-tml`, createdAt: 1, settings: { configured: true, software: "tmodloader", version: tmodloaderReleases[0]!.version, port: await freePort() } },
            ],
        }));
        writeTree(folder("s-ter"), {
            "worlds/Island.wld": terrariaWorld("Island"),
            "worlds/Cavern.wld": terrariaWorld("Cavern"),
            [`install/${vanilla.directory}/manifest.json`]: JSON.stringify({ software: "vanilla", version: vanilla.version, sha256: vanilla.sha256, os: process.platform, arch: process.arch }),
        });
        placeStandIn("fakeTerraria", path.join(folder("s-ter"), "install", vanilla.directory, entrypoint(process.platform)));
        writeTree(folder("s-tml"), { "tModLoader/Mods/HandMade.tmod": tmod("HandMade", "Hand Made"), "tModLoader/Mods/enabled.json": JSON.stringify(["HandMade"]) });
        // the Steam Workshop: modscan's answers, and the item SteamCMD downloads
        const modscan = loopbackServer((_req, url) => {
            const page = (items: unknown[]) => Response.json({ items, total: items.length, meta: META });
            if (url.pathname === "/modscan/v1/tmodloader/search") return page(url.searchParams.get("q") === "wing" || url.searchParams.get("q") === "" ? [wingSlot] : []);
            if (url.pathname === "/modscan/v1/tmodloader/items") return page((url.searchParams.get("ids") ?? "").split(",").includes(WING_SLOT) ? [wingSlot] : []);
            return new Response("Not found", { status: 404 });
        });
        routeHost("panels.ariapis.com", modscan);
        const item = tempDir();
        writeTree(item, { "WingSlot.tmod": tmod("WingSlot", "Wing Slot") });
        fakeSteamcmd({ workshop: { [WING_SLOT]: item } });
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

/** the button whose label (after its icon, if it has one) is `label` */
const button = (label: string, within = "document") => `[...${within}.querySelectorAll("button")].find((b) => b.innerText.trim().split("\\n").at(-1).trim() === ${JSON.stringify(label)} && !b.disabled)`;
const DIALOG = `[...document.querySelectorAll("[role=dialog]")].at(-1)`;
// textContent: innerText reads a badge's CSS capitals
const text = (value: string) => `document.body.textContent.includes(${JSON.stringify(value)})`;
/** the row of list `list` for `value` */
const row = (list: string, value: string) => `document.querySelector('input[name=${list}][value=${JSON.stringify(value)}]')`;

async function openTab(page: Page, tab: string): Promise<void> {
    await page.waitFor(`document.querySelector('input[name=serverMenu][value="${tab}"]')`, "the server menu");
    await page.click(`input[name=serverMenu][value="${tab}"]`);
}

describe("Terraria's Overview", () => {
    test("a running server shows its world and that a join password is set, and a message of the day saved in its dialog is the server's", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-ter`);
        const exited = new Promise<void>((resolve) => processApi.onExit("s-ter-terraria-server", () => resolve()));
        let started = false;
        try {
            await serverCalls("s-ter").writeGameOptions({ patch: { password: "hunter2" } });
            await page.waitFor(`${text("No message of the day")} && ${button("Start")}`, "the stopped server's Overview");
            await page.evaluate(`${button("Start")}.click()`);
            started = true;
            await page.waitFor(`${button("Stop")} && ${text("Join password")}`, "the running server's readouts");
            /** a readout's value and label: the smallest element holding a child labelled `label` */
            const readout = (label: string) => `[...document.querySelectorAll("*")].filter((el) => [...el.children].some((c) => c.textContent.trim() === ${JSON.stringify(label)}) && el.textContent.trim() !== ${JSON.stringify(label)}).map((el) => el.textContent).sort((a, b) => a.length - b.length)[0]`;
            expect(await page.evaluate<string>(readout("Active world"))).toContain("Island");
            expect(await page.evaluate<string>(readout("Join password"))).toContain("On");
            // the server got the password from the vault, in its working folder
            expect(JSON.parse(fs.readFileSync(path.join(path.dirname(path.join(folder("s-ter"), "install", vanilla.directory, entrypoint(process.platform))), "started-with.json"), "utf8")).password).toBe("hunter2");

            await page.evaluate(`document.querySelector('button[aria-label="Edit message of the day"]').click()`);
            await page.waitFor(`${DIALOG}?.querySelector("[role=textbox][contenteditable=true]")`, "the message editor, loaded");
            await page.type(`[role=dialog] [role=textbox]`, "Welcome to the island");
            await page.evaluate(`${button("Save", DIALOG)}.click()`);
            await page.waitFor(`!document.querySelector("[role=dialog] [role=textbox]") && ${text("Welcome to the island")}`, "the saved message on the Overview");
            expect(settingsOf("s-ter").motd).toBe("Welcome to the island");
            expect(JSON.stringify(settingsOf("s-ter"))).not.toContain("hunter2");

            await serverCalls("s-ter").stopServer();
            started = false;
            await exited;
            // stopped, the config the next start reads has the message and not the password
            const written = fs.readFileSync(path.join(folder("s-ter"), "serverconfig.txt"), "utf8");
            expect(written).toContain("motd=Welcome to the island");
            expect(written).not.toContain("hunter2");
            expect(page.exceptions).toEqual([]);
        } finally {
            if (started) {
                await serverCalls("s-ter").stopServer();
                await exited;
            }
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("Terraria's Worlds tab", () => {
    test("switches to another world, makes a new one generated on the next start, and a download that can't run says why", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-ter`);
        try {
            await openTab(page, "worlds");
            await page.waitFor(`${row("terraria-worlds", "Island")}?.parentElement.textContent.includes("Active") && ${row("terraria-worlds", "Cavern")}`, "both worlds, Island active");
            await page.evaluate(`${row("terraria-worlds", "Cavern")}.click()`);
            await page.waitFor(`${DIALOG}?.innerText.includes("Inactive. Switching takes effect after a restart.")`, "Cavern's details");
            expect(await page.evaluate<string>(`${DIALOG}.innerText`)).toContain("Small (4200 × 1200 tiles)");
            // a download here has no Paperboard window to save it through, and says so
            await page.evaluate(`${button("Download", DIALOG)}.click()`);
            await page.waitFor(`${text("World not downloaded")} && ${text("needs a panel shown in Paperboard")}`, "the download's failure");
            await page.evaluate(`${button("Switch to this world", DIALOG)}.click()`);
            await page.waitFor(`${row("terraria-worlds", "Cavern")}?.parentElement.textContent.includes("Active") && !${row("terraria-worlds", "Island")}.parentElement.textContent.includes("Active")`, "Cavern active");
            expect(settingsOf("s-ter").world).toBe("Cavern");
            await page.evaluate(`[...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.trim() === "Close")?.click()`);

            await page.evaluate(`${button("New World")}.click()`);
            await page.waitFor(`${DIALOG}?.innerText.includes("New World") && ${button("Create", DIALOG)}`, "the New World dialog, ready");
            expect(await page.evaluate<string>(`${DIALOG}.querySelector("input").value`)).toBe("World");
            await page.evaluate(`${button("Create", DIALOG)}.click()`);
            await page.waitFor(`${row("terraria-worlds", "World")}?.parentElement.textContent.includes("Not generated yet")`, "the new world, not generated yet");
            expect(await page.evaluate<string>(`${row("terraria-worlds", "World")}.parentElement.textContent`)).toContain("Active");
            expect(settingsOf("s-ter")).toMatchObject({ world: "World", autocreate: "1", difficulty: "0" });
            // nothing is generated until Terraria starts on it
            expect(fs.existsSync(path.join(folder("s-ter"), "worlds", "World.wld"))).toBe(false);
            expect(fs.readFileSync(path.join(folder("s-ter"), "serverconfig.txt"), "utf8")).toContain("worldname=World");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("a tModLoader server's Mods tab", () => {
    test("lists the mods in tModLoader/Mods, installs one found on the Steam Workshop, and uninstalls it to the trash", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-tml`);
        const mods = path.join(folder("s-tml"), "tModLoader", "Mods");
        try {
            await openTab(page, "mods");
            await page.waitFor(`${row("addon-installed", "HandMade.tmod")}?.parentElement.textContent.includes("Hand Made")`, "the mod put in by hand");
            await page.type(`input[placeholder="Search Mods"]`, "wing", true);
            await page.waitFor(`${row("addon-results", WING_SLOT)}?.parentElement.textContent.includes("Wing Slot")`, "the Workshop's answer");
            await page.evaluate(`${row("addon-results", WING_SLOT)}.click()`);
            await page.waitFor(`${button("Install", DIALOG)}`, "Wing Slot's page");
            await page.evaluate(`${button("Install", DIALOG)}.click()`);
            await page.waitFor(`${DIALOG}?.innerText.includes("Install Wing Slot") && ${button("Install", DIALOG)}`, "the install dialog, ready");
            await page.evaluate(`${button("Install", DIALOG)}.click()`);
            await page.waitFor(`${text("Wing Slot is on.")} && ${row("addon-installed", "WingSlot.tmod")}`, "the installed mod");
            expect(JSON.parse(fs.readFileSync(path.join(mods, "enabled.json"), "utf8"))).toEqual(["HandMade", "WingSlot"]);
            expect(Buffer.from(fs.readFileSync(path.join(mods, "WingSlot.tmod")))).toEqual(Buffer.from(tmod("WingSlot", "Wing Slot")));

            // the mod's page, still open, now offers to uninstall it
            await page.waitFor(`${button("Uninstall", DIALOG)}`, "the installed mod's page");
            await page.evaluate(`${button("Uninstall", DIALOG)}.click()`);
            await page.waitFor(`${DIALOG}?.innerText.includes("Uninstall Wing Slot") && ${button("Uninstall", DIALOG)}`, "the uninstall confirmation");
            await page.evaluate(`${button("Uninstall", DIALOG)}.click()`);
            await page.waitFor(`!${row("addon-installed", "WingSlot.tmod")} && ${row("addon-installed", "HandMade.tmod")}`, "the mod gone from the list");
            expect(fs.existsSync(path.join(mods, "WingSlot.tmod"))).toBe(false);
            expect(JSON.parse(fs.readFileSync(path.join(mods, "enabled.json"), "utf8"))).toEqual(["HandMade"]);
            const trash = fs.readdirSync(folder("s-tml")).filter((name) => name.startsWith(".trash-"));
            expect(trash.map((dir) => fs.existsSync(path.join(folder("s-tml"), dir, "tModLoader", "Mods", "WingSlot.tmod")))).toEqual([true]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});
