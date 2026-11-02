// Steam Workshop maps for a Source server. The server's own behavior was measured on the Team Fortress 2
// dedicated server (build 11191711, anonymous login, no Web API key): `changelevel workshop/<id>`,
// `+map workshop/<id>` and a map cycle line `workshop/<id>` track the item, download it and load it as
// `workshop/<file>.ugc<id>`; an unknown id, another game's item or a TF2 item that is no map leaves the server
// on its map ("Map failed to sync"). So an item is checked before it can be named. The search service
// (modscan) is stood in for by a local HTTP server that serves responses saved from the real one
// (test/fixtures/modscan-tf2-*.json); everything else runs over real files.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as paperapi from "@mileniumhq/paperapi";
import { mapName } from "../src/games/source/config";
import { parseMapCycle } from "../src/games/source/mapcycle";
import { sourceActions } from "../src/games/source";
import { canonicalMap, isMapItem, pastedWorkshopIds, workshopId } from "../src/games/source/workshop";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-source-workshop-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let settings: Record<string, unknown> = {};
mock.module("../src/service/api", () => ({
    ...paperapi,
    files: { getPath: async () => path.join(root, "server") },
    config: { get: async () => settings, set: async (next: Record<string, unknown>) => { settings = next; return true; } },
    processApi: { exists: async () => false, kill: async () => true, onData: () => () => {}, onExit: () => () => {}, start: async () => true },
}));
mock.module("@mileniumhq/paperapi", () => ({
    ...paperapi,
    fileApi: { getPath: async (...parts: string[]) => path.join(root, ...parts) },
    secretsApi: { get: async () => ({ found: true, value: "rcon-secret" }), set: async () => true, delete: async () => true },
}));
await import("../src/games/service");
const { sourceService } = await import("../src/games/source/service");
const { tf2, TF2 } = await import("../src/games/tf2");
const { inServer } = await import("../src/service/scope");

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dir, "fixtures", name), "utf8");
const maps = JSON.parse(fixture("modscan-tf2-maps.json"));
const guide = JSON.parse(fixture("modscan-tf2-guide.json"));

// --- the names

test("a Workshop map is named by its item id, and no other name may carry a slash or be longer than a file name", () => {
    expect(mapName("workshop/454116880")).toBe("workshop/454116880");
    expect(mapName("ctf_2fort")).toBe("ctf_2fort");
    for (const bad of ["workshop/", "workshop/abc", "workshop/0123", "workshop/454116880.bsp", "workshop/454116880/x", "workshop/../etc", "workshop/454116880\nquit", "workshop/123456789012345678901", "other/454116880", "/454116880", "maps/ctf_2fort", "a".repeat(65)]) {
        expect(() => mapName(bad), bad).toThrow("Choose a map by its name");
    }
});

test("the server's two names for a Workshop map are one map", () => {
    expect(workshopId("workshop/454116880")).toBe("454116880");
    expect(workshopId("workshop/arena_discovery_rc2.ugc454116880")).toBe("454116880");
    expect(workshopId("ctf_2fort")).toBeNull();
    expect(workshopId("workshop/arena_discovery_rc2")).toBeNull();
    expect(canonicalMap("workshop/arena_discovery_rc2.ugc454116880")).toBe("workshop/454116880");
    expect(canonicalMap("cp_dustbowl")).toBe("cp_dustbowl");
});

test("a pasted Workshop link or id is read, and anything else is a search", () => {
    expect(pastedWorkshopIds("454116880")).toEqual(["454116880"]);
    expect(pastedWorkshopIds(" https://steamcommunity.com/sharedfiles/filedetails/?id=454116880 ")).toEqual(["454116880"]);
    expect(pastedWorkshopIds("https://steamcommunity.com/workshop/filedetails/?id=512422248&searchtext=")).toEqual(["512422248"]);
    for (const text of ["dustbowl", "", "0", "https://evil.example/sharedfiles/filedetails/?id=454116880", "id=454116880", "12 34"]) expect(pastedWorkshopIds(text), text).toEqual([]);
});

test("an item is a map when its tags name a game mode the game lists; a guide is not", () => {
    for (const item of maps.items) expect(isMapItem(TF2, item), item.title).toBe(true);
    expect(isMapItem(TF2, guide.items[0])).toBe(false);
    expect(isMapItem(TF2, { tags: ["capture the flag"] })).toBe(true);
    expect(isMapItem(TF2, { tags: [] })).toBe(false);
});

// --- the search service

let requests: string[] = [];
let respond: (url: URL) => Response = () => Response.json({ error: { code: "not_found", message: "no stub" } }, { status: 404 });
const modscan = Bun.serve({ port: 0, fetch(request) { const url = new URL(request.url); requests.push(`${url.pathname}${url.search}`); return respond(url); } });
afterAll(() => modscan.stop(true));
const base = `http://127.0.0.1:${modscan.port}`;
const items = (list: any[]) => Response.json({ items: list, total: null, meta: maps.meta });
const stub = (url: URL) => {
    if (url.pathname === "/tf2/items") {
        const ids = url.searchParams.get("ids")!.split(",");
        if (ids.includes("2815010161")) return new Response(fixture("modscan-tf2-wrong-game.json"), { status: 404 });
        if (ids.includes("148063940")) return new Response(JSON.stringify(guide));
        return items(maps.items.filter((i: any) => ids.includes(i.id)));
    }
    if (url.pathname === "/tf2/search") return items([...maps.items, guide.items[0]]);
    return Response.json({ error: { code: "not_found", message: "no stub" } }, { status: 404 });
};

// --- the service

const ids = sourceActions(TF2.id);
const server = path.join(root, "server");
const game = path.join(server, "install", "tf");
const put = (file: string, text = "") => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const bsp = (...names: string[]) => { for (const name of names) put(path.join(game, "maps", `${name}.bsp`)); };
const state: Record<string, unknown> = {};
const ctx: any = { state, setState: (patch: any) => Object.assign(state, typeof patch === "function" ? patch(state) : patch), emitTrigger: () => {} };
const withWorkshop = sourceService({ ...TF2, workshop: { game: "tf2", base } }, tf2);
let scope: any;
beforeEach(() => {
    fs.rmSync(server, { recursive: true, force: true });
    settings = {};
    requests = [];
    respond = stub;
    state.serverStatus = "offline";
    scope = { server: { id: "s-workshop", game: TF2.id, directory: "" }, locals: new Map() };
});
const run = (id: string, input: Record<string, unknown> = {}, service = withWorkshop) => inServer(scope, async () => (await service.actions()).find((a) => a.id === id)!.run(ctx, input) as Promise<any>);
const initialize = () => inServer(scope, () => withWorkshop.initialize!(ctx, false));
const read = (...parts: string[]) => fs.readFileSync(path.join(game, ...parts), "utf8");

test("Team Fortress 2 offers the Workshop actions, and names its search service game", () => {
    expect(tf2.describe({ software: "", version: "" }).actions).toEqual(expect.arrayContaining([ids.workshopMaps, ids.workshopFind, ids.workshopAdd, ids.workshopRemove]));
    expect(TF2.workshop).toEqual({ game: "tf2" });
});

test("a map found in the Workshop is added from its id, kept with its title and picture, and added again it is not doubled", async () => {
    bsp("ctf_2fort");
    const added = await run(ids.workshopAdd, { id: "454116880" });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ id: "454116880", title: "Discovery", tags: ["Arena", "Jungle", "Summer"] });
    expect(added[0].previewImageUrl).toStartWith("https://images.steamusercontent.com/");
    expect(await run(ids.workshopAdd, { id: "454116880" })).toHaveLength(1);
    expect(await run(ids.workshopMaps)).toEqual(added);
    expect(requests.every((r) => r.startsWith("/tf2/items?ids=454116880"))).toBe(true);
});

test("an item that is no map, that belongs to another game, or that isn't an id is refused with the reason, and nothing is saved", async () => {
    bsp("ctf_2fort");
    await expect(run(ids.workshopAdd, { id: "148063940" })).rejects.toThrow("TF2 Workshop Import Tools : Gold Stars is not a map");
    await expect(run(ids.workshopAdd, { id: "2815010161" })).rejects.toThrow("Workshop item does not belong to this game");
    for (const id of ["abc", "0", "../1", 454116880, null]) await expect(run(ids.workshopAdd, { id }), String(id)).rejects.toThrow("Choose a Steam Workshop item by its id");
    expect(settings.workshopMaps).toBeUndefined();
});

test("a game with no Workshop maps says so", async () => {
    bsp("ctf_2fort");
    const without = sourceService({ ...TF2, workshop: undefined }, tf2);
    await expect(run(ids.workshopAdd, { id: "454116880" }, without)).rejects.toThrow("Team Fortress 2 has no Steam Workshop maps");
    await expect(run(ids.workshopFind, { query: "dustbowl" }, without)).rejects.toThrow("Team Fortress 2 has no Steam Workshop maps");
});

test("a search shows maps only, says how many results were not maps, marks the ones already added and carries Valve's attribution", async () => {
    bsp("ctf_2fort");
    await run(ids.workshopAdd, { id: "512422248" });
    requests = [];
    const found = await run(ids.workshopFind, { query: "area" });
    expect(requests).toEqual(["/tf2/search?q=area&page=1&sort=relevance"]);
    expect(found.items.map((i: any) => [i.id, i.added])).toEqual([["454116880", false], ["512422248", true], ["2936998568", false]]);
    expect(found.hidden).toBe(1);
    expect(found.meta.attribution).toBe("Powered by Steam");
    expect(found.meta.legal).toContain("Valve Corporation");
    // nothing typed lists what is popular
    await run(ids.workshopFind, { query: "" });
    expect(requests.at(-1)).toBe("/tf2/search?q=&page=1&sort=subscriptions");
});

test("a pasted Workshop link is looked up by its id, which is how it works when searching doesn't", async () => {
    bsp("ctf_2fort");
    respond = (url) => (url.pathname === "/tf2/search" ? new Response(fixture("modscan-tf2-search-502.json"), { status: 502 }) : stub(url));
    const found = await run(ids.workshopFind, { query: "https://steamcommunity.com/sharedfiles/filedetails/?id=454116880" });
    expect(requests).toEqual(["/tf2/items?ids=454116880"]);
    expect(found.items.map((i: any) => i.title)).toEqual(["Discovery"]);
});

test("a search the Workshop service fails is an error with its reason, as the live service answers for Team Fortress 2 today", async () => {
    bsp("ctf_2fort");
    respond = () => new Response(fixture("modscan-tf2-search-502.json"), { status: 502 });
    await expect(run(ids.workshopFind, { query: "dustbowl" })).rejects.toThrow("Steam Workshop search failed: Steam returned invalid Workshop data.");
    respond = () => { throw new Error("down"); };
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const gone = sourceService({ ...TF2, workshop: { game: "tf2", base: `http://127.0.0.1:${closed.port}` } }, tf2);
    closed.stop(true);
    await expect(run(ids.workshopFind, { query: "dustbowl" }, gone)).rejects.toThrow("Couldn't reach Steam Workshop search");
});

test("an added Workshop map is a map the server can start on, change to and cycle through; one that was not added is refused wherever it is named", async () => {
    bsp("ctf_2fort", "cp_dustbowl");
    await initialize();
    await run(ids.workshopAdd, { id: "454116880" });

    const view = await run(ids.mapCycleSet, { maps: ["workshop/454116880", "ctf_2fort"] });
    expect(view).toMatchObject({ maps: ["workshop/454116880", "ctf_2fort"], custom: true });
    expect(view.installed).toEqual(expect.arrayContaining(["ctf_2fort", "cp_dustbowl", "workshop/454116880"]));
    expect(view.workshop.map((m: any) => m.title)).toEqual(["Discovery"]);
    // the cycle file is what srcds reads: measured, `workshop/<id>` is a line it plays
    expect(parseMapCycle(read("cfg", "paperboard_mapcycle.txt"))).toEqual(["workshop/454116880", "ctf_2fort"]);

    await run(ids.changeMap, { map: "workshop/454116880" });
    expect(settings.map).toBe("workshop/454116880");
    await run("write-game-options", { patch: { map: "ctf_2fort" } });
    await run("write-game-options", { patch: { map: "workshop/454116880" } });
    expect(settings.map).toBe("workshop/454116880");

    for (const map of ["workshop/512422248", "workshop/999"]) {
        await expect(run(ids.changeMap, { map }), map).rejects.toThrow(`${map} is not installed`);
        await expect(run("write-game-options", { patch: { map } }), map).rejects.toThrow(`${map} is not installed`);
        await expect(run(ids.mapCycleSet, { maps: ["ctf_2fort", map] }), map).rejects.toThrow(`${map} is not installed`);
        await expect(run(ids.play, { mode: null, map }), map).rejects.toThrow(`${map} is not installed`);
    }
    await expect(run(ids.changeMap, { map: "workshop/../../etc" })).rejects.toThrow("Choose a map by its name");
    expect(settings.map).toBe("workshop/454116880");
});

test("setup's mixed choice may start on a Workshop map the server has, and a mode's rotation is its installed maps only", async () => {
    bsp("ctf_2fort", "ctf_turbine");
    await initialize();
    await run(ids.workshopAdd, { id: "2936998568" });
    await run(ids.play, { mode: null, map: "workshop/2936998568" });
    expect(settings.map).toBe("workshop/2936998568");
    await run(ids.play, { mode: "ctf", map: "ctf_turbine" });
    expect(settings.mapCycle).toEqual(["ctf_turbine", "ctf_2fort"]);
    await expect(run(ids.play, { mode: "ctf", map: "workshop/2936998568" })).rejects.toThrow("is not a Capture the Flag map");
});

test("a Workshop map can be removed only while the server neither starts on it nor cycles through it", async () => {
    bsp("ctf_2fort");
    await initialize();
    await run(ids.workshopAdd, { id: "454116880" });
    await run(ids.workshopAdd, { id: "512422248" });
    await run(ids.changeMap, { map: "workshop/454116880" });
    await expect(run(ids.workshopRemove, { id: "454116880" })).rejects.toThrow("Discovery was not removed. The server starts on it.");
    await run(ids.changeMap, { map: "ctf_2fort" });
    await run(ids.mapCycleSet, { maps: ["ctf_2fort", "workshop/454116880"] });
    await expect(run(ids.workshopRemove, { id: "454116880" })).rejects.toThrow("Discovery was not removed. It is in the map rotation.");
    await run(ids.mapCycleSet, { maps: ["ctf_2fort"] });
    expect((await run(ids.workshopRemove, { id: "454116880" })).map((m: any) => m.id)).toEqual(["512422248"]);
    await expect(run(ids.workshopRemove, { id: "454116880" })).rejects.toThrow("has no Steam Workshop map 454116880 added");
});

test("the rotation page is told why a Workshop map can't be removed, in the words the removal itself gives", async () => {
    bsp("ctf_2fort");
    await initialize();
    await run(ids.workshopAdd, { id: "454116880" });
    await run(ids.workshopAdd, { id: "512422248" });
    expect((await run(ids.mapCycle)).workshopHeld, "nothing holds either").toEqual({});
    await run(ids.changeMap, { map: "workshop/454116880" });
    await run(ids.mapCycleSet, { maps: ["ctf_2fort", "workshop/512422248"] });
    const held = (await run(ids.mapCycle)).workshopHeld;
    expect(held).toEqual({ "454116880": "The server starts on it. Choose another map on the Overview first.", "512422248": "It is in the map rotation. Remove it there first." });
    for (const [id, why] of Object.entries(held)) await expect(run(ids.workshopRemove, { id })).rejects.toThrow(why);
    // a server playing it holds it too, however it names the map (workshop/<file>.ugc<id>)
    await run(ids.changeMap, { map: "ctf_2fort" });
    await run(ids.mapCycleSet, { maps: ["ctf_2fort"] });
    state.serverStatus = "online";
    state.serverLevel = "workshop/arena_discovery_rc2.ugc454116880";
    const playing = "The server is playing it now. Change the map first.";
    expect((await run(ids.mapCycle)).workshopHeld).toEqual({ "454116880": playing });
    await expect(run(ids.workshopRemove, { id: "454116880" })).rejects.toThrow(playing);
    state.serverStatus = "offline";
    state.serverLevel = null;
    expect(await run(ids.workshopRemove, { id: "454116880" })).toHaveLength(1);
});

test("a damaged saved list is a failure, never an empty one", async () => {
    bsp("ctf_2fort");
    settings = { workshopMaps: "nope" };
    await expect(run(ids.workshopMaps)).rejects.toThrow("saved Steam Workshop maps are damaged");
    settings = { workshopMaps: [{ id: "../1", title: "x", tags: [] }] };
    await expect(run(ids.mapCycle)).rejects.toThrow("saved Steam Workshop maps are damaged");
});
