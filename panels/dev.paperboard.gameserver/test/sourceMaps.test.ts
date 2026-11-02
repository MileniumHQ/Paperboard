// Map choice and rotation for a Source server. The file rules below were
// measured on a Team Fortress 2 dedicated server (build 11191711) with
// `changelevel_next`: cfg/<mapcyclefile> beats <mapcyclefile> beside it,
// cfg/mapcycle_default.txt is read when the variable's file is missing, a
// comment after a map name becomes part of the name, a byte order mark ruins
// the first line, a .bsp suffix is refused, a map in custom/<folder>/maps
// plays, `mapcyclefile` can be set on a running server, and a rewritten file
// is read again. Everything here runs over real files and a real TCP RCON.
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import * as paperapi from "@mileniumhq/paperapi";
import { decodePackets, encodePacket } from "../src/games/source/rcon";
import { serverCfg } from "../src/games/source/config";
import { cfgMapCycleFile, checkRotation, findMap, installedMaps, mapCycleFile, parseMapCycle, readServerCycle } from "../src/games/source/mapcycle";
import { sourceActions } from "../src/games/source";
import { playModes } from "../src/games/source/modes";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-source-maps-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

// the daemon's config and files, kept in memory and under root
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
const { tf2Service } = await import("../src/games/tf2/service");
const { tf2, TF2 } = await import("../src/games/tf2");
const { inServer } = await import("../src/service/scope");

const ids = sourceActions(TF2.id);
const server = path.join(root, "server");
const game = path.join(server, "install", "tf");
const put = (file: string, text = "") => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const bsp = (...names: string[]) => { for (const name of names) put(path.join(game, "maps", `${name}.bsp`)); };

beforeEach(() => {
    fs.rmSync(server, { recursive: true, force: true });
    settings = {};
});

// --- the files

test("a map cycle file is read as the server reads it: whole-line comments and blanks skipped, Windows line ends and a byte order mark tolerated", () => {
    expect(parseMapCycle("// Default mapcycle\r\n\r\ncp_dustbowl\r\n  ctf_2fort  \r\n// cp_granary\r\n")).toEqual(["cp_dustbowl", "ctf_2fort"]);
    expect(parseMapCycle("﻿// c\ncp_dustbowl")).toEqual(["cp_dustbowl"]);
    // the server takes a trailing comment for part of the name, so nothing here hides it
    expect(parseMapCycle("cp_dustbowl // old")).toEqual(["cp_dustbowl // old"]);
});

test("the file written for a rotation reads back as that rotation, with no byte order mark or trailing comment", () => {
    const text = mapCycleFile(["pl_badwater", "cp_dustbowl"]);
    expect(parseMapCycle(text)).toEqual(["pl_badwater", "cp_dustbowl"]);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text.split("\n").filter((line) => line && !line.startsWith("//") && line.includes("//"))).toEqual([]);
});

test("installed maps are the .bsp files of the maps folder and of custom folders, without the menu's background map", async () => {
    bsp("ctf_2fort", "cp_dustbowl", "background01", "itemtest");
    put(path.join(game, "maps", "cp_dustbowl.bsp.bz2"));
    put(path.join(game, "custom", "mine", "maps", "pl_custom.bsp"));
    put(path.join(game, "custom", "mine", "maps", "ctf_2fort.bsp"));
    expect(await installedMaps(game)).toEqual(["cp_dustbowl", "ctf_2fort", "pl_custom"]);
    expect(await findMap(game, "pl_custom")).toBe(path.join(game, "custom", "mine", "maps", "pl_custom.bsp"));
    expect(await findMap(game, "pl_missing")).toBeNull();
});

test("a game folder with no maps folder says to install, not that it has no maps", async () => {
    fs.mkdirSync(game, { recursive: true });
    await expect(installedMaps(game)).rejects.toThrow("install the game in Updates first");
});

test("a rotation holds installed maps by name, at least one, each once", () => {
    const installed = ["cp_dustbowl", "ctf_2fort"];
    expect(checkRotation(["ctf_2fort", "cp_dustbowl"], installed)).toEqual(["ctf_2fort", "cp_dustbowl"]);
    expect(() => checkRotation([], installed)).toThrow("at least one map");
    expect(() => checkRotation("ctf_2fort", installed)).toThrow("at least one map");
    expect(() => checkRotation(["pl_badwater"], installed)).toThrow("pl_badwater is not installed");
    expect(() => checkRotation(["cp_dustbowl", "cp_dustbowl"], installed)).toThrow("in the rotation twice");
    expect(() => checkRotation(["cp_dustbowl.bsp"], installed)).toThrow("Choose a map by its name");
    expect(() => checkRotation(["cp_dustbowl\nquit"], installed)).toThrow("Choose a map by its name");
});

test("the server's map cycle file is found where srcds finds it: cfg/ first, then as named, then the default", async () => {
    expect(await readServerCycle(game, "mapcycle.txt")).toBeNull();
    put(path.join(game, "cfg", "mapcycle_default.txt"), "// stock\nctf_2fort\n");
    expect(await readServerCycle(game, "mapcycle.txt")).toEqual({ file: path.join("cfg", "mapcycle_default.txt"), maps: ["ctf_2fort"] });
    put(path.join(game, "mine.txt"), "cp_dustbowl\n");
    expect(await readServerCycle(game, "mine.txt")).toEqual({ file: "mine.txt", maps: ["cp_dustbowl"] });
    put(path.join(game, "cfg", "mine.txt"), "cp_granary\n");
    expect(await readServerCycle(game, "mine.txt")).toEqual({ file: path.join("cfg", "mine.txt"), maps: ["cp_granary"] });
    put(path.join(game, "cfg", "mapcycle.txt"), "pl_badwater\n");
    expect(await readServerCycle(game, "mapcycle.txt")).toEqual({ file: path.join("cfg", "mapcycle.txt"), maps: ["pl_badwater"] });
});

test("a server.cfg's own mapcyclefile is read, the last one winning", () => {
    expect(cfgMapCycleFile("hostname x\n")).toBeNull();
    expect(cfgMapCycleFile('sv_alltalk 1\nmapcyclefile "tourney.txt"\n')).toBe("tourney.txt");
    expect(cfgMapCycleFile("// mapcyclefile commented.txt\nmapcyclefile a.txt; echo hi\r\nMAPCYCLEFILE b.txt\n")).toBe("b.txt");
});

test("the generated server.cfg points the server at the rotation only when one is saved", () => {
    expect(serverCfg(TF2.options, {}, false)).not.toContain("mapcyclefile");
    expect(serverCfg(TF2.options, { mapCycle: null }, false)).not.toContain("mapcyclefile");
    const cfg = serverCfg(TF2.options, { mapCycle: ["cp_dustbowl"] }, true);
    expect(cfg).toContain("mapcyclefile paperboard_mapcycle.txt\n");
    // a server.cfg of the user's runs after it and keeps the last word
    expect(cfg.indexOf("mapcyclefile")).toBeLessThan(cfg.indexOf("exec paperboard_user.cfg"));
});

// --- the service

const state: Record<string, unknown> = {};
const ctx: any = { state, setState: (patch: any) => Object.assign(state, typeof patch === "function" ? patch(state) : patch), emitTrigger: () => {} };
// each test is a server of its own: its vault keys and the service's state belong to it
let scope: any;
beforeEach(() => { scope = { server: { id: "s-maps", game: TF2.id, directory: "" }, locals: new Map() }; });
const run = (id: string, input: Record<string, unknown> = {}) => inServer(scope, async () => (await tf2Service.actions()).find((a) => a.id === id)!.run(ctx, input) as Promise<any>);
const initialize = (running: boolean) => inServer(scope, () => tf2Service.initialize!(ctx, running));
const read = (...parts: string[]) => fs.readFileSync(path.join(game, ...parts), "utf8");
const present = (...parts: string[]) => fs.existsSync(path.join(game, ...parts));

beforeEach(() => { state.serverStatus = "offline"; });

test("Team Fortress 2 lists the Maps tab and both rotation actions", () => {
    const features = tf2.describe({ software: "", version: "" });
    expect(features.tabs.find((tab) => tab.id === "maps")).toMatchObject({ label: "Maps", owner: "game" });
    expect(features.actions).toEqual(expect.arrayContaining([ids.maps, ids.mapCycle, ids.mapCycleSet]));
});

test("until a rotation is set, the page shows the game's map cycle file, and setting one leaves a user's own mapcycle.txt as it was", async () => {
    bsp("cp_dustbowl", "ctf_2fort", "pl_badwater", "cp_granary");
    await initialize(false);
    const own = "// my cycle\r\npl_badwater\r\nctf_2fort\r\n";
    put(path.join(game, "cfg", "mapcycle.txt"), own);
    put(path.join(game, "cfg", "mapcycle_default.txt"), "cp_dustbowl\n");

    expect(await run(ids.mapCycle)).toEqual({ maps: ["pl_badwater", "ctf_2fort"], custom: false, file: path.join("cfg", "mapcycle.txt"), installed: ["cp_dustbowl", "cp_granary", "ctf_2fort", "pl_badwater"], workshop: [], workshopHeld: {}, overriddenBy: null });

    const view = await run(ids.mapCycleSet, { maps: ["cp_granary", "pl_badwater"] });
    expect(view).toMatchObject({ maps: ["cp_granary", "pl_badwater"], custom: true, file: "cfg/paperboard_mapcycle.txt" });
    expect(settings.mapCycle).toEqual(["cp_granary", "pl_badwater"]);
    expect(parseMapCycle(read("cfg", "paperboard_mapcycle.txt"))).toEqual(["cp_granary", "pl_badwater"]);
    expect(read("cfg", "server.cfg")).toContain("mapcyclefile paperboard_mapcycle.txt");
    // the user's file is theirs
    expect(read("cfg", "mapcycle.txt")).toBe(own);

    // handing the rotation back removes Paperboard's file and line, and the user's file is the server's again
    expect((await run(ids.mapCycleSet, { maps: null }))).toMatchObject({ maps: ["pl_badwater", "ctf_2fort"], custom: false, file: path.join("cfg", "mapcycle.txt") });
    expect(present("cfg", "paperboard_mapcycle.txt")).toBe(false);
    expect(read("cfg", "server.cfg")).not.toContain("mapcyclefile");
    expect(read("cfg", "mapcycle.txt")).toBe(own);
});

test("a server with no mapcycle.txt shows the game's default one", async () => {
    bsp("ctf_2fort");
    await initialize(false);
    put(path.join(game, "cfg", "mapcycle_default.txt"), "// stock\nctf_2fort\ncp_dustbowl\n");
    expect(await run(ids.mapCycle)).toMatchObject({ maps: ["ctf_2fort", "cp_dustbowl"], custom: false, file: path.join("cfg", "mapcycle_default.txt") });
});

test("a rotation with a map that isn't installed, a repeat, or nothing in it is refused and nothing is saved", async () => {
    bsp("cp_dustbowl");
    await initialize(false);
    for (const [maps, reason] of [[["cp_dustbowl", "pl_badwater"], "pl_badwater is not installed"], [["cp_dustbowl", "cp_dustbowl"], "twice"], [[], "at least one map"]] as const) {
        await expect(run(ids.mapCycleSet, { maps })).rejects.toThrow(reason);
    }
    expect(settings.mapCycle).toBeUndefined();
    expect(present("cfg", "paperboard_mapcycle.txt")).toBe(false);
});

test("a server.cfg that sets mapcyclefile keeps the last word, and the page refuses to pretend otherwise", async () => {
    bsp("cp_dustbowl");
    await initialize(false);
    put(path.join(server, "server.cfg"), "mapcyclefile tourney.txt\n");
    put(path.join(game, "cfg", "tourney.txt"), "cp_dustbowl\n");
    expect(await run(ids.mapCycle)).toMatchObject({ maps: ["cp_dustbowl"], custom: false, file: path.join("cfg", "tourney.txt"), overriddenBy: "tourney.txt" });
    await expect(run(ids.mapCycleSet, { maps: ["cp_dustbowl"] })).rejects.toThrow("sets mapcyclefile to tourney.txt");
    expect(settings.mapCycle).toBeUndefined();
});

test("the starting map and a map change are chosen among installed maps, custom folders included, and typing another is refused", async () => {
    bsp("ctf_2fort");
    put(path.join(game, "custom", "mine", "maps", "pl_custom.bsp"));
    await initialize(false);
    expect(await run(ids.maps)).toEqual(["ctf_2fort", "pl_custom"]);
    await run(ids.changeMap, { map: "pl_custom" });
    expect(settings.map).toBe("pl_custom");
    await expect(run(ids.changeMap, { map: "cp_dustbowl" })).rejects.toThrow("cp_dustbowl is not installed");
    // Options takes the same refusal, so no other route saves a map the server can't play
    await expect(run("write-game-options", { patch: { map: "cp_dustbowl" } })).rejects.toThrow("cp_dustbowl is not installed");
    await expect(run("write-game-options", { patch: { map: "../../etc" } })).rejects.toThrow("Choose a map by its name");
    expect(settings.map).toBe("pl_custom");
});

// A running server: the rotation reaches it over RCON, so no restart is needed.
const servers: net.Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });
const STATUS = "hostname: Probe\nmap     : ctf_2fort at: 0 x, 0 y, 0 z\nplayers : 0 humans, 0 bots (12 max)\n# userid name                uniqueid            connected ping loss state  adr\n";
async function rconServer() {
    const seen: string[] = [];
    const listener = net.createServer((socket) => {
        let buffer = Buffer.alloc(0);
        socket.on("data", (chunk) => {
            const { packets, rest } = decodePackets(Buffer.concat([buffer, chunk]));
            buffer = rest;
            for (const p of packets) {
                if (p.type === 3) {
                    socket.write(encodePacket(p.id, 0, ""));
                    socket.write(encodePacket(p.body === "rcon-secret" ? p.id : -1, 2, ""));
                } else if (p.type === 2) {
                    seen.push(p.body);
                    socket.write(encodePacket(p.id, 0, p.body === "status" ? STATUS : ""));
                } else if (p.type === 0) {
                    socket.write(encodePacket(p.id, 0, ""));
                    socket.write(encodePacket(p.id, 0, "\u0000\u0001\u0000\u0000"));
                }
            }
        });
    });
    servers.push(listener);
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    return { port: (listener.address() as net.AddressInfo).port, seen };
}

test("on a running server the rotation is switched over RCON, and handed back the same way", async () => {
    bsp("cp_dustbowl", "ctf_2fort");
    const rcon = await rconServer();
    settings = { port: rcon.port };
    state.serverStatus = "online";
    await initialize(true);
    rcon.seen.length = 0;

    await run(ids.mapCycleSet, { maps: ["ctf_2fort", "cp_dustbowl"] });
    expect(rcon.seen).toEqual(["mapcyclefile paperboard_mapcycle.txt"]);
    // the server reads the file again when it changes, and the next map load runs the new server.cfg
    expect(parseMapCycle(read("cfg", "paperboard_mapcycle.txt"))).toEqual(["ctf_2fort", "cp_dustbowl"]);

    await run(ids.mapCycleSet, { maps: ["cp_dustbowl"] });
    expect(parseMapCycle(read("cfg", "paperboard_mapcycle.txt"))).toEqual(["cp_dustbowl"]);

    rcon.seen.length = 0;
    await run(ids.mapCycleSet, { maps: null });
    expect(rcon.seen).toEqual(["mapcyclefile mapcycle.txt"]);
    expect(present("cfg", "paperboard_mapcycle.txt")).toBe(false);
});

test("the saved rotation is what the config writer puts in the file, replacing a stale one", async () => {
    bsp("ctf_2fort", "cp_dustbowl");
    await initialize(false);
    settings = { mapCycle: ["cp_dustbowl", "ctf_2fort"] };
    put(path.join(game, "cfg", "paperboard_mapcycle.txt"), "pl_badwater\n");
    // every config write (a start writes them too) regenerates the file from the saved list
    await run("write-game-options", { patch: { hostname: "Maps" } });
    expect(parseMapCycle(read("cfg", "paperboard_mapcycle.txt"))).toEqual(["cp_dustbowl", "ctf_2fort"]);
    expect(read("cfg", "server.cfg")).toContain("mapcyclefile paperboard_mapcycle.txt");
});

// --- setup asks how the server plays

test("the modes setup offers are the ones the game lists that have an installed map, by name, custom folders included", () => {
    const installed = ["ctf_2fort", "ctf_turbine", "pl_badwater", "pl_custom", "cp_dustbowl", "zz_unlisted", "2koth_abbey"];
    expect(playModes(TF2, installed)).toEqual([
        { prefix: "ctf", name: "Capture the Flag", maps: ["ctf_2fort", "ctf_turbine"] },
        { prefix: "cp", name: "Control Point", maps: ["cp_dustbowl"] },
        { prefix: "pl", name: "Payload", maps: ["pl_badwater", "pl_custom"] },
    ]);
    expect(playModes(TF2, [])).toEqual([]);
});

test("picking a mode in setup makes its installed maps the rotation with the chosen one first, starts the server on it, and writes what the server reads", async () => {
    bsp("ctf_2fort", "ctf_turbine", "ctf_doublecross", "pl_badwater", "cp_dustbowl");
    await initialize(false);

    const view = await run(ids.play, { mode: "ctf", map: "ctf_turbine" });
    expect(view).toMatchObject({ maps: ["ctf_turbine", "ctf_2fort", "ctf_doublecross"], custom: true, file: "cfg/paperboard_mapcycle.txt" });
    expect(settings).toMatchObject({ map: "ctf_turbine", mapCycle: ["ctf_turbine", "ctf_2fort", "ctf_doublecross"] });
    expect(parseMapCycle(read("cfg", "paperboard_mapcycle.txt"))).toEqual(["ctf_turbine", "ctf_2fort", "ctf_doublecross"]);
    expect(read("cfg", "server.cfg")).toContain("mapcyclefile paperboard_mapcycle.txt");
    // the Maps tab and the Overview read the same choice
    expect(((await run(ids.mapCycle)) as any).maps).toEqual(["ctf_turbine", "ctf_2fort", "ctf_doublecross"]);
    expect(state.gameSettings).toMatchObject({ map: "ctf_turbine" });
});

test("a mixed server starts on the chosen map and leaves its rotation to the game's own map cycle", async () => {
    bsp("ctf_2fort", "pl_badwater");
    await initialize(false);
    put(path.join(game, "cfg", "mapcycle_default.txt"), "pl_badwater\nctf_2fort\n");
    await run(ids.play, { mode: null, map: "pl_badwater" });
    expect(settings.map).toBe("pl_badwater");
    expect(settings.mapCycle ?? null).toBeNull();
    expect(present("cfg", "paperboard_mapcycle.txt")).toBe(false);
    expect(read("cfg", "server.cfg")).not.toContain("mapcyclefile");
    expect(await run(ids.mapCycle)).toMatchObject({ custom: false, maps: ["pl_badwater", "ctf_2fort"] });
});

test("setup's choice is refused, and nothing saved, for a map that isn't installed, isn't of the mode, or a mode with no installed maps", async () => {
    bsp("ctf_2fort", "pl_badwater");
    await initialize(false);
    settings = { map: "ctf_2fort" };
    for (const [input, reason] of [
        [{ mode: "ctf", map: "ctf_turbine" }, "ctf_turbine is not installed"],
        [{ mode: "ctf", map: "pl_badwater" }, "pl_badwater is not a Capture the Flag map"],
        [{ mode: "koth", map: "ctf_2fort" }, "no installed maps for that mode"],
        [{ mode: "ctf\nquit", map: "ctf_2fort" }, "no installed maps for that mode"],
        [{ mode: "ctf", map: "../../etc" }, "Choose a map by its name"],
    ] as const) await expect(run(ids.play, input)).rejects.toThrow(reason);
    expect(settings).toEqual({ map: "ctf_2fort" });
    expect(present("cfg", "paperboard_mapcycle.txt")).toBe(false);
});

test("a server.cfg that picks the map cycle file refuses a mode's rotation in setup but still takes a mixed start", async () => {
    bsp("ctf_2fort", "ctf_turbine");
    await initialize(false);
    put(path.join(server, "server.cfg"), "mapcyclefile tourney.txt\n");
    await expect(run(ids.play, { mode: "ctf", map: "ctf_turbine" })).rejects.toThrow("sets mapcyclefile to tourney.txt");
    expect(settings.map).toBeUndefined();
    await run(ids.play, { mode: null, map: "ctf_turbine" });
    expect(settings.map).toBe("ctf_turbine");
});

test("on a running server the setup choice reaches it over RCON like the Maps tab's", async () => {
    bsp("ctf_2fort", "ctf_turbine");
    const rcon = await rconServer();
    settings = { port: rcon.port };
    state.serverStatus = "online";
    await initialize(true);
    rcon.seen.length = 0;
    await run(ids.play, { mode: "ctf", map: "ctf_turbine" });
    expect(rcon.seen).toEqual(["mapcyclefile paperboard_mapcycle.txt"]);
});
