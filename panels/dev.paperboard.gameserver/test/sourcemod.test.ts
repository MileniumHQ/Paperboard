// SourceMod on a Source server (TF2 is the game that has it). First what
// Paperboard keeps in the server folder, over the real filesystem: installing
// from the Metamod and SourceMod packages, the plugins turned on and off,
// uploaded and removed, and the admins file. Then the calls the Mods and
// Players tabs make, on a TF2 server of the test daemon with SourceMod already
// in its folder (no package is downloaded): the links into the game's folder,
// uploads and admins.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { BUNDLED_PLUGINS, pluginFile, SourceMod, SOURCEMOD_MISSING } from "../src/games/source/sourcemod";
import { SourceGame } from "../src/games/source/instance";
import { placeMods } from "../src/games/source/modLinks";
import { SOURCE_CALLS as ids } from "../src/games/source";
import { TF2, tf2 } from "../src/games/tf2";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { gameServer } from "./helpers/game";
import { pickCall } from "./helpers/serverCall";
import { readTree, tempDir, writeTree } from "./helpers/tmp";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

// what a compiled SourcePawn plugin starts with, little-endian
const SMX = Buffer.from([0x46, 0x46, 0x50, 0x53, 1, 2, 3]);

/** The folders a Metamod:Source package and a SourceMod package unpack to (each a bin/ the service hands over). */
function packages() {
    const root = tempDir("gameserver-sm-packages-");
    const metamod = path.join(root, "metamod-source", "bin");
    const sourcemod = path.join(root, "sourcemod", "bin");
    writeTree(metamod, {
        "addons/metamod.vdf": "32-bit loader",
        "addons/metamod_x64.vdf": "64-bit loader",
        "addons/metamod/bin/linux64/server.so": "metamod",
    });
    writeTree(sourcemod, {
        "addons/sourcemod/bin/sourcemod.2.tf2.so": "sourcemod",
        "addons/sourcemod/plugins/basecommands.smx": SMX,
        "addons/sourcemod/plugins/rockthevote.smx": SMX,
        "addons/sourcemod/plugins/disabled/mapchooser.smx": SMX,
        "addons/sourcemod/configs/admins_simple.ini": "// admins\n",
        "cfg/sourcemod/sourcemod.cfg": "sm_advertisement_interval 30\n",
    });
    return { metamod, sourcemod };
}

/** A server folder with SourceMod installed from the packages. */
async function installed() {
    const root = tempDir("gameserver-sm-server-");
    const sm = new SourceMod(root);
    const pkg = packages();
    await sm.install(pkg.metamod, pkg.sourcemod);
    return { root, sm, pkg };
}

const plugins = (root: string) => path.join(root, "addons", "sourcemod", "plugins");
const stage = (files: Record<string, string | Uint8Array>) => {
    const dir = tempDir("gameserver-sm-stage-");
    writeTree(dir, files);
    return dir;
};

describe("SourceMod on Team Fortress 2", () => {
    test("install puts Metamod's 64-bit loader, SourceMod and its configs in the server folder, and leaves the 32-bit loader out", async () => {
        const { root, sm } = await installed();
        const files = Object.keys(readTree(root)).filter((f) => !f.endsWith("/"));
        expect(files).toContain("addons/metamod_x64.vdf");
        expect(files).toContain("addons/metamod/bin/linux64/server.so");
        expect(files).toContain("addons/sourcemod/bin/sourcemod.2.tf2.so");
        expect(files).toContain("cfg/sourcemod/sourcemod.cfg");
        expect(files).not.toContain("addons/metamod.vdf");
        expect(await sm.installed()).toBe(true);
    });

    test("installing again keeps the user's configs and plugins", async () => {
        const { root, sm, pkg } = await installed();
        fs.writeFileSync(path.join(root, "cfg", "sourcemod", "sourcemod.cfg"), "mine\n");
        fs.writeFileSync(path.join(plugins(root), "custom.smx"), SMX);
        fs.rmSync(path.join(plugins(root), "basecommands.smx"));
        await sm.install(pkg.metamod, pkg.sourcemod);
        expect(fs.readFileSync(path.join(root, "cfg", "sourcemod", "sourcemod.cfg"), "utf8")).toBe("mine\n");
        expect(fs.existsSync(path.join(plugins(root), "custom.smx"))).toBe(true);
        // a file that was gone comes back with the package
        expect(fs.existsSync(path.join(plugins(root), "basecommands.smx"))).toBe(true);
    });

    test("a package missing its addons folder refuses the install and says which", async () => {
        const root = tempDir("gameserver-sm-server-");
        const pkg = packages();
        fs.rmSync(path.join(pkg.metamod, "addons"), { recursive: true });
        await expect(new SourceMod(root).install(pkg.metamod, pkg.sourcemod)).rejects.toThrow("The package has no bin/addons folder");
        expect(await new SourceMod(root).installed()).toBe(false);
    });

    test("an install that lacks SourceMod's own folder is not an install", async () => {
        const root = tempDir("gameserver-sm-server-");
        const pkg = packages();
        fs.rmSync(path.join(pkg.sourcemod, "addons", "sourcemod", "bin"), { recursive: true });
        await expect(new SourceMod(root).install(pkg.metamod, pkg.sourcemod)).rejects.toThrow("did not install completely");
    });

    test("the view says when SourceMod is on without its files, and lists nothing then", async () => {
        const root = tempDir("gameserver-sm-server-");
        expect(await new SourceMod(root).view(true)).toEqual({ missing: true, plugins: [] });
        expect(await new SourceMod(root).view(false)).toEqual({ missing: false, plugins: [] });
        const { sm } = await installed();
        const on = await sm.view(true);
        expect(on.missing).toBe(false);
        expect(on.plugins.length).toBe(3);
        // installed but turned off still lists its plugins, so Mods can show them
        expect((await sm.view(false)).plugins.length).toBe(3);
    });

    test("plugins are listed with their names and whether they run, the user's own first", async () => {
        const { root, sm } = await installed();
        fs.writeFileSync(path.join(plugins(root), "zeta.smx"), SMX);
        fs.writeFileSync(path.join(plugins(root), "notes.txt"), "not a plugin");
        const list = await sm.list();
        expect(list.map((p) => p.file)).toEqual(["zeta.smx", "basecommands.smx", "mapchooser.smx", "rockthevote.smx"]);
        expect(list[0]).toEqual({ file: "zeta.smx", title: "zeta", description: "Uploaded by you", enabled: true, bundled: false });
        expect(list[1]).toMatchObject({ title: BUNDLED_PLUGINS.basecommands!.title, enabled: true, bundled: true });
        expect(list[2]).toMatchObject({ file: "mapchooser.smx", enabled: false, bundled: true });
    });

    test("turning a plugin off moves it to disabled/, on moves it back, and doing either twice changes nothing", async () => {
        const { root, sm } = await installed();
        expect(await sm.setEnabled("rockthevote.smx", false)).toBe(true);
        expect(fs.existsSync(path.join(plugins(root), "disabled", "rockthevote.smx"))).toBe(true);
        expect(fs.existsSync(path.join(plugins(root), "rockthevote.smx"))).toBe(false);
        expect(await sm.setEnabled("rockthevote.smx", false)).toBe(false);
        expect(await sm.setEnabled("rockthevote.smx", true)).toBe(true);
        expect(fs.existsSync(path.join(plugins(root), "rockthevote.smx"))).toBe(true);
        expect(await sm.setEnabled("rockthevote.smx", true)).toBe(false);
    });

    test("a plugin that is not installed is refused by name", async () => {
        const { sm } = await installed();
        await expect(sm.setEnabled("nothere.smx", true)).rejects.toThrow("nothere.smx is not installed");
        await expect(sm.remove("nothere.smx")).rejects.toThrow("nothere.smx is not installed");
    });

    test("a plugin name that is not a plain .smx file name is refused, so no path leaves the plugins folder", () => {
        for (const bad of ["../evil.smx", "a/b.smx", "..\\evil.smx", "plugin.sp", "plugin", ".smx", "", 7, null, undefined, "x".repeat(70) + ".smx"]) {
            expect(() => pluginFile(bad)).toThrow("Choose a plugin by its .smx file name");
        }
        expect(pluginFile("my_plugin-2.smx")).toBe("my_plugin-2.smx");
    });

    test("remove deletes a plugin the user added, wherever it is, and refuses one SourceMod ships", async () => {
        const { root, sm } = await installed();
        fs.writeFileSync(path.join(plugins(root), "custom.smx"), SMX);
        fs.mkdirSync(path.join(plugins(root), "disabled"), { recursive: true });
        fs.writeFileSync(path.join(plugins(root), "disabled", "other.smx"), SMX);
        await sm.remove("custom.smx");
        await sm.remove("other.smx");
        expect((await sm.list()).some((p) => !p.bundled)).toBe(false);
        await expect(sm.remove("basecommands.smx")).rejects.toThrow("comes with SourceMod; turn it off instead");
        expect(fs.existsSync(path.join(plugins(root), "basecommands.smx"))).toBe(true);
    });

    test("an upload adds the compiled plugins turned on", async () => {
        const { root, sm } = await installed();
        const added = await sm.upload(stage({ "b_plugin.smx": SMX, "a_plugin.smx": SMX }));
        expect(added).toEqual(["a_plugin.smx", "b_plugin.smx"]);
        expect(fs.readFileSync(path.join(plugins(root), "a_plugin.smx"))).toEqual(SMX);
        expect((await sm.list()).filter((p) => !p.bundled).every((p) => p.enabled)).toBe(true);
    });

    test("an upload of a plugin that is turned off replaces it where it is, still off", async () => {
        const { root, sm } = await installed();
        fs.mkdirSync(path.join(plugins(root), "disabled"), { recursive: true });
        fs.writeFileSync(path.join(plugins(root), "disabled", "mine.smx"), Buffer.concat([SMX, Buffer.from("old")]));
        await sm.upload(stage({ "mine.smx": SMX }));
        expect(fs.readFileSync(path.join(plugins(root), "disabled", "mine.smx"))).toEqual(SMX);
        expect(fs.existsSync(path.join(plugins(root), "mine.smx"))).toBe(false);
    });

    test("one bad file refuses the whole upload before any file is added", async () => {
        const { root, sm } = await installed();
        const before = readTree(plugins(root));
        await expect(sm.upload(stage({ "good.smx": SMX, "source.sp": "public void OnPluginStart() {}" }))).rejects.toThrow("source.sp is not a SourceMod plugin. Upload the compiled .smx, not the .sp source.");
        await expect(sm.upload(stage({ "good.smx": SMX, "fake.smx": "not compiled" }))).rejects.toThrow("fake.smx is not a compiled SourceMod plugin");
        await expect(sm.upload(stage({ "good.smx": SMX, "basecommands.smx": SMX }))).rejects.toThrow("has the name of a plugin SourceMod comes with");
        expect(readTree(plugins(root))).toEqual(before);
    });

    test("an upload with no files, or whose stage is gone, says so", async () => {
        const { sm } = await installed();
        await expect(sm.upload(stage({}))).rejects.toThrow("Nothing was uploaded");
        await expect(sm.upload(path.join(tempDir(), "gone"))).rejects.toThrow("Nothing was uploaded");
    });

    test("an admin is a Steam id with full rights in admins_simple.ini, and the rest of the file stays as it was", async () => {
        const { root, sm } = await installed();
        const file = path.join(root, "addons", "sourcemod", "configs", "admins_simple.ini");
        fs.writeFileSync(file, '// my admins\n"STEAM_0:1:111" "abc"\n"STEAM_0:1:222" "99:z"\r\n"STEAM_0:1:333" "z"\n');
        // only those with the z flag are admins here
        expect(await sm.admins()).toEqual(["STEAM_0:1:222", "STEAM_0:1:333"]);
        await sm.setAdmin("STEAM_0:1:444", true);
        expect(await sm.admins()).toEqual(["STEAM_0:1:222", "STEAM_0:1:333", "STEAM_0:1:444"]);
        expect(fs.readFileSync(file, "utf8")).toBe('// my admins\n"STEAM_0:1:111" "abc"\n"STEAM_0:1:222" "99:z"\n"STEAM_0:1:333" "z"\n"STEAM_0:1:444" "99:z"\n');
        // taking admin away drops every line the file has for that id, others' lines stay
        await sm.setAdmin("STEAM_0:1:222", false);
        expect(await sm.admins()).toEqual(["STEAM_0:1:333", "STEAM_0:1:444"]);
        // making someone an admin twice leaves one line
        await sm.setAdmin("STEAM_0:1:444", true);
        expect(fs.readFileSync(file, "utf8").match(/STEAM_0:1:444/g)).toHaveLength(1);
        expect(fs.readFileSync(file, "utf8")).toContain('"STEAM_0:1:111" "abc"');
    });

    test("admins are read as none, and the file made, when the server has none yet", async () => {
        const root = tempDir("gameserver-sm-server-");
        const sm = new SourceMod(root);
        expect(await sm.admins()).toEqual([]);
        await sm.setAdmin("STEAM_0:1:7", true);
        expect(await sm.admins()).toEqual(["STEAM_0:1:7"]);
    });
});

const STAGE = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ID = "[U:1:1408246345]";

/**
 * A TF2 server the way the page sees it, and its calls: SourceMod already in
 * the server folder (`installed`), so turning it on downloads nothing. `game`
 * is the game's own view of that server, for what only a start runs.
 */
async function tf2Server(installed = true) {
    const server = gameServer("team-fortress-2", { files: { "install/tf/maps/ctf_2fort.bsp": "bsp", "install/tf/cfg/server.cfg": "// the game's own\n" } });
    if (installed) {
        const pkg = packages();
        await new SourceMod(server.dir).install(pkg.metamod, pkg.sourcemod);
    }
    await server.server.game.initialize(false);
    const calls = await server.server.game.calls();
    const call = (id: string, input: unknown = {}) => pickCall(calls, id)(server.server, input) as Promise<any>;
    const tf = path.join(server.dir, "install", "tf");
    return { server, call, tf, game: new SourceGame(TF2, tf2, server.server) };
}
/** where a link points, resolved */
const target = (link: string) => path.resolve(path.dirname(link), fs.readlinkSync(link));
const isLink = (link: string) => fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

describe("SourceMod's calls on a TF2 server", () => {
    test("turning SourceMod on links its folders into tf/, so the game reads what Mods changes; turning it off takes the links out and keeps every file", async () => {
        const { server, call, tf } = await tf2Server();
        expect(await call(ids.sourcemodSet, { on: true })).toMatchObject({ on: true, missing: false, active: false });
        expect(server.server.settings.sourcemod).toBe(true);
        expect(target(path.join(tf, "addons"))).toBe(path.join(server.dir, "addons"));
        expect(target(path.join(tf, "cfg", "sourcemod"))).toBe(path.join(server.dir, "cfg", "sourcemod"));
        expect(fs.readFileSync(path.join(tf, "addons", "metamod_x64.vdf"), "utf8")).toBe("64-bit loader");
        expect(fs.readFileSync(path.join(tf, "cfg", "sourcemod", "sourcemod.cfg"), "utf8")).toBe("sm_advertisement_interval 30\n");
        // the game's own cfg is not the link
        expect(fs.readFileSync(path.join(tf, "cfg", "server.cfg"), "utf8")).toBe("// the game's own\n");

        // a plugin turned off in Mods is out of the plugins/ the game reads
        await call(ids.plugin, { file: "rockthevote.smx", on: false });
        expect(fs.existsSync(path.join(tf, "addons", "sourcemod", "plugins", "rockthevote.smx"))).toBe(false);
        expect(fs.existsSync(path.join(tf, "addons", "sourcemod", "plugins", "disabled", "rockthevote.smx"))).toBe(true);

        expect(await call(ids.sourcemodSet, { on: false })).toMatchObject({ on: false, missing: false });
        expect(server.server.settings.sourcemod).toBe(false);
        expect(isLink(path.join(tf, "addons"))).toBe(false);
        expect(isLink(path.join(tf, "cfg", "sourcemod"))).toBe(false);
        expect(fs.existsSync(path.join(tf, "addons"))).toBe(false);
        // nothing of it is deleted: Mods still lists the plugins, and the user's own files are as they were
        expect((await call(ids.sourcemod)).plugins.length).toBe(3);
        expect(fs.existsSync(path.join(server.dir, "addons", "sourcemod", "plugins", "disabled", "rockthevote.smx"))).toBe(true);
        expect(fs.readFileSync(path.join(tf, "cfg", "server.cfg"), "utf8")).toBe("// the game's own\n");
    });

    test("a start with SourceMod on and its files gone is refused, saying how to put them back, and Mods shows it as missing", async () => {
        const { server, call, tf, game } = await tf2Server();
        await call(ids.sourcemodSet, { on: true });
        expect(await placeMods(game)).toBe(true);
        fs.rmSync(path.join(server.dir, "addons"), { recursive: true });
        expect(await call(ids.sourcemod)).toMatchObject({ on: true, missing: true, plugins: [] });
        await expect(placeMods(game)).rejects.toThrow(SOURCEMOD_MISSING);
        expect(SOURCEMOD_MISSING).toContain("Turn it off and on again in Mods");
        // and the same server with SourceMod off starts: no links, and nothing refused
        await call(ids.sourcemodSet, { on: false });
        expect(await placeMods(game)).toBe(false);
        expect(isLink(path.join(tf, "addons"))).toBe(false);
    });

    test("plugins are added only while SourceMod is on; the upload's staging folder goes either way", async () => {
        const { server, call } = await tf2Server();
        const stageDir = path.join(server.dir, ".paperboard-transfer", `addon-${STAGE}`);
        const stage = () => writeTree(stageDir, { "mine.smx": SMX });
        stage();
        await expect(call(ids.pluginUpload, { stage: STAGE })).rejects.toThrow("Turn SourceMod on before adding plugins");
        expect(fs.existsSync(stageDir)).toBe(false);
        await expect(call(ids.pluginUpload, { stage: "../../etc" })).rejects.toThrow("That is not an upload Paperboard started");

        await call(ids.sourcemodSet, { on: true });
        stage();
        const { added, view } = await call(ids.pluginUpload, { stage: STAGE });
        expect(added).toEqual(["mine.smx"]);
        expect(view.plugins.find((p: { file: string }) => p.file === "mine.smx")).toMatchObject({ enabled: true, bundled: false });
        expect(fs.existsSync(stageDir)).toBe(false);
        await expect(call(ids.pluginRemove, { file: "basecommands.smx" })).rejects.toThrow("comes with SourceMod");
        await call(ids.pluginRemove, { file: "mine.smx" });
        expect((await call(ids.sourcemod)).plugins.some((p: { file: string }) => p.file === "mine.smx")).toBe(false);
    });

    test("the Players tab's admin switch: refused while SourceMod is off and for an id that is no Steam player, and a TF2 [U:1:n] id is written for SourceMod and listed back", async () => {
        const { server, call } = await tf2Server();
        const file = path.join(server.dir, "addons", "sourcemod", "configs", "admins_simple.ini");
        // the Players tab gets no admins at all while SourceMod is off, which is when it shows no switch
        expect((await call(ids.players)).admins).toBeNull();
        await expect(call(ids.admin, { steamId: ID, admin: true })).rejects.toThrow("Turn SourceMod on in Mods first");

        await call(ids.sourcemodSet, { on: true });
        expect((await call(ids.players)).admins).toEqual([]);
        for (const steamId of ["[U:1:1]; quit", "BOT", "", 7]) await expect(call(ids.admin, { steamId, admin: true })).rejects.toThrow();
        await expect(call(ids.admin, { steamId: ID, admin: "yes" })).rejects.toThrow("Choose admin or not");
        expect(fs.readFileSync(file, "utf8")).toBe("// admins\n");

        // measured on a live TF2 server: sm_who lists this id as root
        await call(ids.admin, { steamId: ID, admin: true });
        expect(fs.readFileSync(file, "utf8")).toBe(`// admins\n"${ID}" "99:z"\n`);
        expect((await call(ids.players)).admins).toEqual([ID]);
        await call(ids.admin, { steamId: ID, admin: false });
        expect(fs.readFileSync(file, "utf8")).toBe("// admins\n");
        expect((await call(ids.players)).admins).toEqual([]);
        expect(server.server.settings.sourcemod).toBe(true);
    });
});
