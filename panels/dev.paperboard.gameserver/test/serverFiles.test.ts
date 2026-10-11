// The Files tab's service against real temp folders: paths are checked at
// this boundary, saves refuse a file that changed since it was read, and a
// save keeps the file's own line ends, BOM and permissions.
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deflateRawSync } from "node:zlib";
import {
    MAX_LISTED_ENTRIES,
    listServerFiles,
    readServerFile,
    writeServerFile,
} from "../src/service/serverFiles";
import { locateAddonConfig, matchModConfig, matchPluginFolder } from "../src/service/addonConfig";
import { readJarEntries } from "../src/service/jarEntries";
import { pendingFileTasks } from "../src/service/fileWrites";

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function server(files: Record<string, string | Buffer> = {}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-files-"));
    dirs.push(dir);
    for (const [relative, content] of Object.entries(files)) {
        const absolute = path.join(dir, relative);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content);
    }
    return dir;
}

const deps = (root: string) => ({ serverDir: async () => root });

async function readText(root: string, relative: string) {
    const content = await readServerFile(relative, deps(root));
    if (content.kind !== "text") throw new Error(`expected text, got ${content.kind}`);
    return content;
}

// a minimal zip writer: enough to give the locator real jars to read
function jar(entries: Record<string, string>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(entries)) {
        const nameBytes = Buffer.from(name);
        const raw = Buffer.from(text);
        const data = deflateRawSync(raw);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBytes, data);
        centrals.push(central, nameBytes);
        offset += local.length + nameBytes.length + data.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(entries).length, 8);
    end.writeUInt16LE(Object.keys(entries).length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

describe("listing", () => {
    test("folders first, then files, with paths from the server root", async () => {
        const root = server({ "server.properties": "", "plugins/Essentials/config.yml": "", "banned-ips.json": "[]" });
        const listing = await listServerFiles("", deps(root));
        expect(listing.entries.map((e) => `${e.kind}:${e.path}`)).toEqual([
            "folder:plugins",
            "file:banned-ips.json",
            "file:server.properties",
        ]);
        expect((await listServerFiles("plugins/Essentials", deps(root))).entries[0]!.path).toBe("plugins/Essentials/config.yml");
    });

    test("traversal, absolute paths and links are refused at the boundary", async () => {
        const root = server({ "a.txt": "x" });
        const outside = server({ "secret.txt": "nope" });
        fs.symlinkSync(outside, path.join(root, "link"));
        for (const bad of ["..", "../x", "/etc", "a//b", "a\\b", 3]) {
            await expect(listServerFiles(bad, deps(root))).rejects.toThrow("Not a folder path");
        }
        await expect(listServerFiles("link", deps(root))).rejects.toThrow("goes through a link");
        await expect(readServerFile("link/secret.txt", deps(root))).rejects.toThrow("goes through a link");
        // the link itself is not listed as something to open
        const listing = await listServerFiles("", deps(root));
        expect(listing.entries.map((e) => e.name)).toEqual(["a.txt"]);
        expect(listing.note).toContain("1 item is not shown");
    });

    test("a huge folder is capped and says so", async () => {
        const root = server();
        for (let i = 0; i < MAX_LISTED_ENTRIES + 5; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), "");
        const listing = await listServerFiles("", deps(root));
        expect(listing.entries).toHaveLength(MAX_LISTED_ENTRIES);
        expect(listing.note).toBe(`Showing ${MAX_LISTED_ENTRIES} of ${MAX_LISTED_ENTRIES + 5} items.`);
    });
});

describe("reading", () => {
    test("text comes back with LF line ends and a version", async () => {
        const root = server({ "bukkit.yml": "\uFEFFsettings:\r\n  allow-end: true\r\n" });
        const file = await readText(root, "bukkit.yml");
        // the BOM is not shown in the editor, and is written back on save
        expect(file.text).toBe("settings:\n  allow-end: true\n");
        expect(file.version).toMatch(/^[0-9a-f]{64}$/);
    });

    test("binary, oversized and image files are not handed to the editor", async () => {
        const root = server({
            "world/level.dat": Buffer.from([0x1f, 0x8b, 0, 0, 1]),
            "huge.log": Buffer.alloc(2 * 1024 * 1024 + 1, 0x61),
            "server-icon.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        });
        expect(await readServerFile("world/level.dat", deps(root))).toMatchObject({ kind: "unavailable" });
        expect(await readServerFile("huge.log", deps(root))).toEqual({
            kind: "unavailable",
            reason: "huge.log is larger than 2 MB, too big to open here.",
        });
        expect(await readServerFile("server-icon.png", deps(root))).toEqual({
            kind: "image",
            src: "data:image/png;base64,iVBORw==",
            alt: "server-icon.png",
        });
        await expect(readServerFile("world", deps(root))).rejects.toThrow("is not a file");
        await expect(readServerFile("", deps(root))).rejects.toThrow("Not a file path");
    });
});

describe("saving", () => {
    test("a save keeps CRLF, the BOM and the file's permissions", async () => {
        const root = server({ "start.sh": "\uFEFF#!/bin/sh\r\njava -jar server.jar\r\n" });
        fs.chmodSync(path.join(root, "start.sh"), 0o755);
        const file = await readText(root, "start.sh");
        const saved = await writeServerFile("start.sh", "#!/bin/sh\njava -Xmx2G -jar server.jar\n", file.version, false, deps(root));
        expect(fs.readFileSync(path.join(root, "start.sh"), "utf8")).toBe("\uFEFF#!/bin/sh\r\njava -Xmx2G -jar server.jar\r\n");
        expect(fs.statSync(path.join(root, "start.sh")).mode & 0o777).toBe(0o755);
        expect(saved.message).toBe("Saved. It applies the next time the server starts.");
        expect(saved.version).toBe((await readText(root, "start.sh")).version);
        expect(fs.readdirSync(root)).toEqual(["start.sh"]);
    });

    test("a file the server rewrote since it was read is refused, not overwritten", async () => {
        const root = server({ "config.yml": "a: 1\n" });
        const file = await readText(root, "config.yml");
        fs.writeFileSync(path.join(root, "config.yml"), "a: 1\nb: 2\n");
        await expect(writeServerFile("config.yml", "a: 9\n", file.version, true, deps(root))).rejects.toThrow(
            "changed on disk since you opened it",
        );
        expect(fs.readFileSync(path.join(root, "config.yml"), "utf8")).toBe("a: 1\nb: 2\n");
    });

    test("two saves of the same version: the first lands, the second is refused", async () => {
        const root = server({ "config.yml": "a: 1\n" });
        const { version } = await readText(root, "config.yml");
        const results = await Promise.allSettled([
            writeServerFile("config.yml", "a: 2\n", version, true, deps(root)),
            writeServerFile("config.yml", "a: 3\n", version, true, deps(root)),
        ]);
        expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
        expect(fs.readFileSync(path.join(root, "config.yml"), "utf8")).toBe("a: 2\n");
        expect(pendingFileTasks()).toBe(0);
    });

    test("a running server is told how the change applies", async () => {
        const root = server({ "ops.json": "[]" });
        const { version } = await readText(root, "ops.json");
        const saved = await writeServerFile("ops.json", "[ ]", version, true, deps(root));
        expect(saved.message).toContain("restart it, or reload the plugin");
    });

    test("a save never creates a file, and refuses a version it did not hand out", async () => {
        const root = server({ "a.yml": "x" });
        const { version } = await readText(root, "a.yml");
        await expect(writeServerFile("new.yml", "x", version, false, deps(root))).rejects.toThrow("does not exist");
        await expect(writeServerFile("a.yml", "y", "1", false, deps(root))).rejects.toThrow("Open the file again");
        expect(fs.existsSync(path.join(root, "new.yml"))).toBe(false);
    });
});

describe("Configure: finding an add-on's settings", () => {
    test("a plugin's folder comes from the name inside its jar, not its filename", async () => {
        const root = server({
            "plugins/EssentialsX-2.21.2.jar": jar({ "plugin.yml": "name: Essentials\nversion: 2.21.2\n" }),
            "plugins/Essentials/config.yml": "ops-name-color: '4'\n",
            "plugins/EssentialsChat/x.yml": "",
        });
        expect(await locateAddonConfig("EssentialsX-2.21.2.jar", "paper", deps(root))).toEqual({
            name: "Essentials",
            reveal: { path: "plugins/Essentials/config.yml", kind: "file" },
        });
    });

    test("paper-plugin.yml, a <name>Data folder, and a folder without config.yml", async () => {
        const root = server({
            "plugins/gp.jar": jar({ "paper-plugin.yml": "name: GriefPrevention\n" }),
            "plugins/GriefPreventionData/claims/1.yml": "",
        });
        expect((await locateAddonConfig("gp.jar", "paper", deps(root))).reveal).toEqual({
            path: "plugins/GriefPreventionData",
            kind: "folder",
        });
    });

    test("a plugin that has not run yet says to start the server", async () => {
        const root = server({ "plugins/lp.jar": jar({ "plugin.yml": "name: LuckPerms\n" }) });
        expect(await locateAddonConfig("lp.jar", "paper", deps(root))).toEqual({
            name: "LuckPerms",
            reveal: null,
            message: "LuckPerms has no settings folder yet. Start the server once so it creates one.",
        });
    });

    test("a mod's id picks its config file (fabric.mod.json, neoforge.mods.toml)", async () => {
        const root = server({
            "mods/lithium.jar": jar({ "fabric.mod.json": '{"id":"lithium","version":"0.15"}' }),
            "mods/jei.jar": jar({ "META-INF/neoforge.mods.toml": 'modLoader="javafml"\n[[mods]]\nmodId="jei"\n' }),
            "config/lithium.properties": "",
            "config/jei-server.toml": "",
            "config/jei-client.toml": "",
            "config/jeiintegration.toml": "",
        });
        expect((await locateAddonConfig("lithium.jar", "fabric", deps(root))).reveal).toEqual({
            path: "config/lithium.properties",
            kind: "file",
        });
        expect((await locateAddonConfig("jei.jar", "neoforge", deps(root))).reveal).toEqual({
            path: "config/jei-server.toml",
            kind: "file",
        });
    });

    test("only an installed jar can be asked about", async () => {
        const root = server({ "plugins/a.jar": jar({}) });
        await expect(locateAddonConfig("../a.jar", "paper", deps(root))).rejects.toThrow("Not an installed jar");
        await expect(locateAddonConfig("b.jar", "paper", deps(root))).rejects.toThrow("is not in plugins/");
        await expect(locateAddonConfig("a.jar", "vanilla", deps(root))).rejects.toThrow("no plugins or mods");
    });

    test("a damaged jar is a failure, not a missing name", async () => {
        const root = server({ "plugins/bad.jar": Buffer.from("not a zip at all, just some bytes") });
        await expect(locateAddonConfig("bad.jar", "paper", deps(root))).rejects.toThrow("no zip directory");
    });

    test("folder and file matching rules", () => {
        expect(matchPluginFolder("Essentials", ["EssentialsChat"])).toBeNull();
        expect(matchPluginFolder("worldguard", ["WorldGuard"])).toBe("WorldGuard");
        expect(matchModConfig("create", [{ name: "create", kind: "folder" }, { name: "create-server.toml", kind: "file" }]))
            .toEqual({ name: "create", kind: "folder" });
        expect(matchModConfig("jei", [{ name: "jeiintegration.toml", kind: "file" }])).toBeNull();
    });

    test("readJarEntries reads only what was asked for", async () => {
        const root = server({ "x.jar": jar({ "plugin.yml": "name: X\n", "big.bin": "y".repeat(10_000) }) });
        const entries = await readJarEntries(path.join(root, "x.jar"), ["plugin.yml", "missing.yml"]);
        expect([...entries]).toEqual([["plugin.yml", "name: X\n"]]);
    });
});
