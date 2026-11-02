// Map pictures for a Source server come from a wiki page the game's spec names,
// read at runtime. test/fixtures/tfwiki-list-of-maps.html is a saved copy of
// the Official Team Fortress Wiki's List of maps, served from a real local
// HTTP server so the fetch, its headers, the cache and the failures run over
// a real socket.
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as paperapi from "@mileniumhq/paperapi";
import { forgetMapPictures, mapPictures, parseMapPictures } from "../src/games/source/mapPictures";
import { sourceActions } from "../src/games/source";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-source-pictures-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

mock.module("../src/service/api", () => ({
    ...paperapi,
    files: { getPath: async () => path.join(root, "server") },
    config: { get: async () => ({}), set: async () => true },
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

const WIKI = "https://wiki.teamfortress.com/wiki/List_of_maps";
const fixture = fs.readFileSync(path.join(import.meta.dir, "fixtures", "tfwiki-list-of-maps.html"), "utf8");

// --- reading the page

test("the real wiki page yields a picture for each of the maps the game ships, at the largest size the page itself offers", () => {
    const pictures = parseMapPictures(fixture, WIKI);
    expect(Object.keys(pictures).length).toBeGreaterThanOrEqual(238);
    // the row's own 2x rendering, not the 150 pixel thumbnail beside it
    expect(pictures.ctf_2fort).toBe("https://wiki.teamfortress.com/w/images/thumb/a/a1/Ctf_2fort_bridge_ss.png/300px-Ctf_2fort_bridge_ss.png");
    // the thumbnail's file name is the wiki's, not the map's, and some are .jpeg or upper-case
    expect(pictures.ctf_turbine).toMatch(/\/300px-CTF_Turbine_Center\.png\.jpeg$/);
    expect(pictures.pl_barnblitz).toMatch(/\/300px-Barnblitz\.PNG$/);
    for (const name of ["cp_dustbowl", "pl_badwater", "koth_viaduct", "plr_hightower", "arena_badlands", "mvm_decoy"]) expect(pictures[name]).toBeDefined();
    // every address is on the wiki's own site, over https, which is what the panel page may load
    for (const url of Object.values(pictures)) expect(url).toStartWith("https://wiki.teamfortress.com/w/images/thumb/");
    // the prefix rows of the table ("ctf_", "cp_") are not maps
    expect(pictures.ctf_).toBeUndefined();
    expect(Object.keys(pictures).every((name) => /^[a-z0-9_]+$/.test(name) && !name.endsWith("_"))).toBe(true);
});

test("a page without map rows is a changed layout, and a picture from another site is refused", () => {
    expect(() => parseMapPictures("<html><body><p>Maintenance</p></body></html>", WIKI)).toThrow("lists no map pictures");
    expect(() => parseMapPictures("<table><tr><td><img src=\"/a.png\"></td><td><code>ctf_2fort</code></td></tr></table>", WIKI)).not.toThrow();
    expect(() => parseMapPictures('<table><tr><td><img src="https://evil.example/x.png"></td><td><code>ctf_2fort</code></td></tr></table>', WIKI)).toThrow("not its own site");
});

// --- asking the wiki

let hits: { agent: string | null }[] = [];
let respond: () => Response = () => new Response(fixture, { headers: { "Content-Type": "text/html" } });
const wiki = Bun.serve({
    port: 0,
    fetch(request) {
        hits.push({ agent: request.headers.get("user-agent") });
        return respond();
    },
});
afterAll(() => wiki.stop(true));
const source = (page = `http://127.0.0.1:${wiki.port}/wiki/List_of_maps`) => ({ name: "Test Wiki", page });
beforeEach(() => {
    forgetMapPictures();
    hits = [];
    respond = () => new Response(fixture, { headers: { "Content-Type": "text/html" } });
});

test("the wiki is asked once however many screens want pictures, with an agent that names Paperboard, and the pictures say where they are from", async () => {
    const asked = await Promise.all([mapPictures(source()), mapPictures(source())]);
    const again = await mapPictures(source());
    expect(hits).toHaveLength(1);
    expect(hits[0]!.agent).toContain("Paperboard");
    expect(again).toBe(asked[0]);
    expect(again.source).toEqual({ name: "Test Wiki", url: `http://127.0.0.1:${wiki.port}/wiki/List_of_maps` });
    // picture addresses resolve against the page, so they point at the same site
    expect(again.pictures.ctf_2fort).toStartWith(`http://127.0.0.1:${wiki.port}/w/images/thumb/`);
});

test("a wiki that refuses or changed says so, and a screen asking again does not ask the wiki again for a minute", async () => {
    respond = () => new Response("down", { status: 503 });
    await expect(mapPictures(source())).rejects.toThrow("Test Wiki answered HTTP 503");
    await expect(mapPictures(source())).rejects.toThrow("Test Wiki answered HTTP 503");
    expect(hits).toHaveLength(1);

    forgetMapPictures();
    respond = () => new Response("<html>nothing to see</html>");
    await expect(mapPictures(source())).rejects.toThrow("Couldn't read map pictures from Test Wiki: http://127.0.0.1");
});

test("a wiki that can't be reached is named in the error", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response("") });
    const page = `http://127.0.0.1:${closed.port}/wiki/List_of_maps`;
    closed.stop(true);
    // not just "fetch failed": the cause, so the screen says what to look at
    await expect(mapPictures(source(page))).rejects.toThrow(/Couldn't reach Test Wiki for map pictures: .*(Unable to connect|ECONNREFUSED|refused)/i);
});

// --- the action a screen calls

const ids = sourceActions(TF2.id);
const ctx: any = { state: {}, setState: () => {}, emitTrigger: () => {} };
const run = (service: ReturnType<typeof sourceService>, id: string) =>
    inServer({ server: { id: "s-pictures", game: TF2.id, directory: "" }, locals: new Map() } as any, async () => (await service.actions()).find((a) => a.id === id)!.run(ctx, {}) as Promise<any>);

test("Team Fortress 2 offers the map pictures action, and the wiki it names is the Official Team Fortress Wiki", () => {
    expect(tf2.describe({ software: "", version: "" }).actions).toContain(ids.mapPictures);
    expect(TF2.mapPictures).toEqual({ name: "Official Team Fortress Wiki", page: WIKI });
});

test("the action returns the pictures from the game's wiki, and fails loudly for a game with none", async () => {
    const withWiki = sourceService({ ...TF2, mapPictures: source() }, tf2);
    expect((await run(withWiki, ids.mapPictures)).pictures.cp_dustbowl).toStartWith("http://127.0.0.1:");
    const without = sourceService({ ...TF2, mapPictures: undefined }, tf2);
    await expect(run(without, ids.mapPictures)).rejects.toThrow("Team Fortress 2 has no source of map pictures");
});

afterEach(() => forgetMapPictures());
