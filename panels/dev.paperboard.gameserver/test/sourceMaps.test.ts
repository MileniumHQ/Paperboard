// A Source game's Maps tab and setup, in the panel as a person uses them: the
// rotation the server plays (opened on the game's own, then edited: added to,
// reordered, taken from), Steam Workshop maps found through a stand-in for
// Paperboard's modscan, and the setup wizard from the download to a server
// that is set up. One daemon, one panel service and two TF2 servers for the
// file: Payload is installed and set up, Fresh is neither.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { loopbackServer, routeHost } from "./helpers/http";
import { callServer } from "./helpers/serverCall";
import { fakeSteamcmd } from "./helpers/steamcmd";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { TF2 } from "../src/games/tf2";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const config = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const stored = (id: string) => JSON.parse(fs.readFileSync(config(), "utf8")).servers.find((s: { id: string }) => s.id === id).settings;
const installDir = (id: string) => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, id, "install");

// A stand-in for modscan's TF2 answers: one Workshop map, and one item that is no map
const UPWARD = "3000000001";
const workshopItem = (id: string, title: string, tags: string[]) => ({
    id, title, description: "", previewImageUrl: null, tags, authorId: "76561198000000001", subscriptions: 4200, favorites: 10,
    timeUpdated: 1_700_000_000, fileSize: 1024, children: [], workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
});
const ITEMS = [workshopItem(UPWARD, "Upward Remix", ["Payload"]), workshopItem("3000000002", "Fancy Hat", ["Cosmetic"])];
const META = { attribution: "Data from the Steam Workshop", source: "https://steamcommunity.com/workshop/", legal: "Valve's legal notice", disclaimer: "Not endorsed by Valve" };

let ready: Promise<void> | null = null;
async function setUp() {
    ready ??= (async () => {
        const modscan = loopbackServer((_req, url) => {
            if (url.pathname === "/modscan/v1/tf2/search") return Response.json({ items: ITEMS, total: ITEMS.length, meta: META });
            if (url.pathname === "/modscan/v1/tf2/items") {
                const ids = (url.searchParams.get("ids") ?? "").split(",");
                return Response.json({ items: ITEMS.filter((item) => ids.includes(item.id)), total: null, meta: META });
            }
            return Response.json({ error: { message: "not found" } }, { status: 404 });
        });
        routeHost("panels.ariapis.com", modscan);
        fakeSteamcmd({
            install: { [TF2.appId]: { build: "19000001", mode: "ok", files: { "tf/maps/pl_upward.bsp": "", "tf/maps/pl_goldrush.bsp": "", "tf/maps/ctf_2fort.bsp": "", "tf/cfg/mapcycle.txt": "ctf_2fort\n" } } },
        });
        const server = (id: string, name: string, settings: Record<string, unknown>) => ({ id, name, game: TF2.id, directory: `${SERVERS}/${id}`, createdAt: 0, settings });
        fs.mkdirSync(path.dirname(config()), { recursive: true });
        fs.writeFileSync(config(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [server("s-tf", "Payload", { configured: true }), server("s-new", "Fresh", {})] }));
        writeTree(installDir("s-tf"), {
            [`steamapps/appmanifest_${TF2.appId}.acf`]: `"AppState"\n{\n\t"appid"\t\t"${TF2.appId}"\n\t"buildid"\t\t"19000000"\n}\n`,
            "tf/maps/ctf_2fort.bsp": "", "tf/maps/pl_badwater.bsp": "", "tf/maps/koth_harvest_final.bsp": "",
            "tf/cfg/mapcycle.txt": "ctf_2fort\npl_badwater\n",
        });
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

/** the button labelled `label`, its icon's name left out */
const button = (label: string) => `[...document.querySelectorAll("button")].find((b) => b.innerText.split("\\n")[0].trim() === ${JSON.stringify(label)})`;
const dialogButton = (label: string) => `[...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)})`;
/** the clickable card whose text includes `text`, in `within` */
const card = (text: string, within = "") => `[...document.querySelectorAll("${within} [role=button]")].find((el) => el.textContent.includes(${JSON.stringify(text)}))`;
/** the rotation as the Maps tab lists it, top to bottom */
const ROTATION = `[...document.querySelectorAll("input[name=source-map-cycle]")].map((input) => input.value)`;
/** the button labelled `label` on the rotation's row for `map` */
const rowButton = (map: string, label: (title: string) => string) =>
    `[...document.querySelector('input[name=source-map-cycle][value="${map}"]').parentElement.querySelectorAll("button")].find((b) => /^${label("(.+)")}$/.test(b.getAttribute("aria-label") ?? ""))`;
const workshopRow = (title: string) => `[...document.querySelectorAll("input[name=source-workshop-maps]")].map((input) => input.parentElement).find((row) => row.innerText.includes(${JSON.stringify(title)}))`;
const cycleFile = () => fs.readFileSync(path.join(installDir("s-tf"), "tf", "cfg", "paperboard_mapcycle.txt"), "utf8").split("\n").filter((line) => line && !line.startsWith("//"));

async function openMaps(served: { url: string }, server = "s-tf") {
    const page = await openPage(`${served.url}/?server=${server}`);
    await page.waitFor(`document.querySelector('input[name=serverMenu][value="maps"]')`, "the server menu");
    await page.click('input[name=serverMenu][value="maps"]');
    return page;
}

describe("a Source game's Maps tab", () => {
    test("opens on the game's rotation, and a map added joins its end", async () => {
        const served = await setUp();
        const page = await openMaps(served);
        try {
            await page.waitFor(`document.querySelector("[name=source-map-cycle]")?.closest("ul, [role=listbox], div")?.innerText.includes("pl_badwater")`, "the game's rotation");
            await page.evaluate(`${button("Edit rotation")}.click()`);
            await page.waitFor(`${button("Add maps")} && !${button("Add maps")}.disabled`, "the rotation to be Paperboard's");
            await page.evaluate(`${button("Add maps")}.click()`);
            const map = card("koth_harvest_final", "[role=dialog]");
            await page.waitFor(map, "the map to add");
            await page.evaluate(`${map}.click()`);
            await page.settled();
            expect(stored("s-tf").mapCycle).toEqual(["ctf_2fort", "pl_badwater", "koth_harvest_final"]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("moving a map up or down, or removing one, changes the rotation the server reads; the last map stays with a reason", async () => {
        const served = await setUp();
        await callServer("s-tf", "team-fortress-2-map-cycle-set", { maps: ["ctf_2fort", "pl_badwater", "koth_harvest_final"] });
        const page = await openMaps(served);
        const shows = (maps: string[], what: string) => page.waitFor(`JSON.stringify(${ROTATION}) === ${JSON.stringify(JSON.stringify(maps))} && !${rowButton(maps[0]!, (t) => `Remove ${t}`)}.disabled`, what);
        try {
            await shows(["ctf_2fort", "pl_badwater", "koth_harvest_final"], "the rotation");
            await page.evaluate(`${rowButton("koth_harvest_final", (t) => `Move ${t} up`)}.click()`);
            await shows(["ctf_2fort", "koth_harvest_final", "pl_badwater"], "koth_harvest_final moved up");
            await page.evaluate(`${rowButton("ctf_2fort", (t) => `Move ${t} down`)}.click()`);
            await shows(["koth_harvest_final", "ctf_2fort", "pl_badwater"], "ctf_2fort moved down");
            await page.evaluate(`${rowButton("pl_badwater", (t) => `Remove ${t}`)}.click()`);
            await shows(["koth_harvest_final", "ctf_2fort"], "pl_badwater removed");
            await page.settled();
            expect(stored("s-tf").mapCycle).toEqual(["koth_harvest_final", "ctf_2fort"]);
            expect(cycleFile()).toEqual(["koth_harvest_final", "ctf_2fort"]);

            await page.evaluate(`${rowButton("ctf_2fort", (t) => `Remove ${t}`)}.click()`);
            await shows(["koth_harvest_final"], "ctf_2fort removed");
            await page.evaluate(`${rowButton("koth_harvest_final", (t) => `Remove ${t}`)}.click()`);
            await page.waitFor(`document.body.innerText.includes("A rotation needs at least one map")`, "why the last map stays");
            await page.settled();
            expect(await page.evaluate(ROTATION)).toEqual(["koth_harvest_final"]);
            expect(stored("s-tf").mapCycle).toEqual(["koth_harvest_final"]);
            expect(cycleFile()).toEqual(["koth_harvest_final"]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("a Steam Workshop map found by searching joins the rotation, and comes off the server once it is out of the rotation", async () => {
        const served = await setUp();
        await callServer("s-tf", "team-fortress-2-map-cycle-set", { maps: ["ctf_2fort"] });
        const page = await openMaps(served);
        try {
            await page.waitFor(`${button("Add maps")} && !${button("Add maps")}.disabled`, "the rotation");
            await page.evaluate(`${button("Add maps")}.click()`);
            const chip = `[...document.querySelectorAll("[role=dialog] *")].find((el) => el.children.length === 0 && el.textContent.trim() === "Steam Workshop")`;
            await page.waitFor(chip, "the Steam Workshop chip");
            await page.evaluate(`${chip}.click()`);
            await page.waitFor(`document.querySelector("[role=dialog] input[placeholder^='Search the Steam Workshop']")`, "the Workshop search");
            await page.type("[role=dialog] input[placeholder^='Search the Steam Workshop']", "upward", true);
            const hit = card("Upward Remix", "[role=dialog]");
            await page.waitFor(`${hit} && document.querySelector("[role=dialog]").innerText.includes("1 result is not a map and left out.")`, "the search's maps");
            expect(await page.evaluate<string>(`document.querySelector("[role=dialog]").innerText`)).not.toContain("Fancy Hat");
            await page.evaluate(`${hit}.click()`);
            await page.waitFor(`document.body.innerText.includes("Upward Remix joined the end of the rotation.")`, "the map added");
            await page.settled();
            expect(stored("s-tf").workshopMaps.map((m: { id: string }) => m.id)).toEqual([UPWARD]);
            expect(stored("s-tf").mapCycle).toEqual(["ctf_2fort", `workshop/${UPWARD}`]);
            expect(cycleFile()).toEqual(["ctf_2fort", `workshop/${UPWARD}`]);

            await page.evaluate(`${dialogButton("Done")}.click()`);
            await page.waitFor(`${workshopRow("Upward Remix")} && JSON.stringify(${ROTATION}) === ${JSON.stringify(JSON.stringify(["ctf_2fort", `workshop/${UPWARD}`]))}`, "the Workshop map in both lists");
            // in the rotation it can't come off the server, and says why
            expect(await page.evaluate(`[${workshopRow("Upward Remix")}.innerText.includes("It is in the map rotation. Remove it there first."), [...${workshopRow("Upward Remix")}.querySelectorAll("button")].find((b) => b.innerText.trim() === "Remove").disabled]`)).toEqual([true, true]);
            await page.evaluate(`${rowButton(`workshop/${UPWARD}`, (t) => `Remove ${t}`)}.click()`);
            const remove = `[...${workshopRow("Upward Remix")}.querySelectorAll("button")].find((b) => b.innerText.trim() === "Remove" && !b.disabled)`;
            await page.waitFor(`JSON.stringify(${ROTATION}) === '["ctf_2fort"]' && ${remove}`, "the map out of the rotation");
            await page.evaluate(`${remove}.click()`);
            await page.waitFor(`${dialogButton("Remove")} && !${dialogButton("Remove")}.disabled`, "the remove confirmation");
            await page.evaluate(`${dialogButton("Remove")}.click()`);
            await page.waitFor(`!document.querySelector("input[name=source-workshop-maps]")`, "the Workshop map gone");
            await page.settled();
            expect(stored("s-tf").workshopMaps).toEqual([]);
            expect(stored("s-tf").mapCycle).toEqual(["ctf_2fort"]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});

describe("a Source game's setup", () => {
    test("downloads the game, asks how it plays and where it starts, and opens the server set up with that rotation", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-new`);
        try {
            await page.waitFor(`document.body.innerText.includes("Downloading Team Fortress 2 from Steam") && ${button("Next")} && !${button("Next")}.disabled`, "the download done");
            await page.evaluate(`${button("Next")}.click()`);
            const payload = card("Payload");
            await page.waitFor(payload, "the game modes");
            expect(await page.evaluate<string>(`${payload}.innerText`)).toContain("2 maps");
            await page.evaluate(`${payload}.click()`);
            await page.waitFor(`${button("Next")} && !${button("Next")}.disabled`, "Next once a mode is picked");
            await page.evaluate(`${button("Next")}.click()`);
            const upward = card("pl_upward");
            await page.waitFor(`document.body.innerText.includes("Starting Map") && ${upward}`, "the starting maps");
            await page.evaluate(`${upward}.click()`);
            await page.waitFor(`${button("Finish Setup")} && !${button("Finish Setup")}.disabled`, "Finish Setup");
            await page.evaluate(`${button("Finish Setup")}.click()`);
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="maps"]')`, "the server page");
            await page.settled();
            const settings = stored("s-new");
            expect([settings.configured, settings.build, settings.map, settings.mapCycle]).toEqual([true, "19000001", "pl_upward", ["pl_upward", "pl_goldrush"]]);
            expect(fs.readFileSync(path.join(installDir("s-new"), "tf", "cfg", "paperboard_mapcycle.txt"), "utf8").split("\n").filter((l) => l && !l.startsWith("//"))).toEqual(["pl_upward", "pl_goldrush"]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
