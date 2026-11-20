// SourceMod on a Source server (TF2 is the game that has it): what Paperboard
// keeps in the server folder, over the real filesystem. Installing from the
// Metamod and SourceMod packages, the plugins turned on and off, uploaded and
// removed, and the admins file.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { BUNDLED_PLUGINS, pluginFile, SourceMod } from "../src/games/source/sourcemod";
import { TF2 } from "../src/games/tf2";
import { SOURCEMOD_PACKAGES } from "../src/games/source";
import { isLinked, linkFolder, unlinkFolder } from "../src/games/serviceKit";
import { readTree, tempDir, writeTree } from "./helpers/tmp";

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
    test("TF2 is the Source game that turns SourceMod on, and asks Origami for both of its packages", () => {
        expect(TF2.sourcemod).toBe(true);
        expect(SOURCEMOD_PACKAGES.map((p) => p.id)).toEqual(["metamod-source", "sourcemod"]);
    });

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

    test("a TF2 player's Steam id as the server prints it, [U:1:n], is an admin the way SourceMod reads it", async () => {
        const { root, sm } = await installed();
        const file = path.join(root, "addons", "sourcemod", "configs", "admins_simple.ini");
        await sm.setAdmin("[U:1:1408246345]", true);
        // measured on a live TF2 server: sm_who lists this id as root
        expect(fs.readFileSync(file, "utf8")).toBe('// admins\n"[U:1:1408246345]" "99:z"\n');
        expect(await sm.admins()).toEqual(["[U:1:1408246345]"]);
        await sm.setAdmin("[U:1:1408246345]", false);
        expect(await sm.admins()).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe("// admins\n");
    });

    test("admins are read as none, and the file made, when the server has none yet", async () => {
        const root = tempDir("gameserver-sm-server-");
        const sm = new SourceMod(root);
        expect(await sm.admins()).toEqual([]);
        await sm.setAdmin("STEAM_0:1:7", true);
        expect(await sm.admins()).toEqual(["STEAM_0:1:7"]);
    });

    test("turned on, the game's folder sees the server folder's addons and cfg/sourcemod; turned off, the links go and the files stay", async () => {
        const { root, sm } = await installed();
        // TF2's game folder is tf/, and the server's copy of Valve's own files is in it
        const game = path.join(root, "install", "tf");
        writeTree(game, { "cfg/server.cfg": "hostname x\n" });
        const links = [[path.join(game, "addons"), sm.addons], [path.join(game, "cfg", "sourcemod"), sm.cfg]] as const;
        for (const [link, target] of links) await linkFolder(link, target);
        expect(fs.readFileSync(path.join(game, "addons", "metamod_x64.vdf"), "utf8")).toBe("64-bit loader");
        expect(fs.existsSync(path.join(game, "addons", "sourcemod", "plugins", "rockthevote.smx"))).toBe(true);
        expect(fs.readFileSync(path.join(game, "cfg", "sourcemod", "sourcemod.cfg"), "utf8")).toBe("sm_advertisement_interval 30\n");
        // a plugin turned off in Mods is out of plugins/ where the game reads
        await sm.setEnabled("rockthevote.smx", false);
        expect(fs.existsSync(path.join(game, "addons", "sourcemod", "plugins", "rockthevote.smx"))).toBe(false);
        for (const [link] of links) await unlinkFolder(link);
        for (const [link] of links) expect(await isLinked(link)).toBe(false);
        expect(fs.existsSync(path.join(game, "addons"))).toBe(false);
        expect(fs.readFileSync(path.join(game, "cfg", "server.cfg"), "utf8")).toBe("hostname x\n");
        expect(await sm.installed()).toBe(true);
        expect(fs.existsSync(path.join(plugins(root), "disabled", "rockthevote.smx"))).toBe(true);
    });
});
