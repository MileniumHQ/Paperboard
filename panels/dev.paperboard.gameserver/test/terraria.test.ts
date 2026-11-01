import { test, expect } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { configText, validateOptions, worldName } from "../src/games/terraria/config";
import { terraria } from "../src/games/terraria";
import { assertGameAction } from "../src/games";
import { unpackArchive, activateRelease, recoverRelease } from "../src/games/terraria/install";

test("Terraria config round trip retains unknown keys, replaces duplicates, validates before writing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "terraria-config-"));
    try {
        const file = path.join(root, "serverconfig.txt");
        await fs.writeFile(file, "# Custom publisher setting\nnpcstream=42\npassword=old\nport=1\nport=2\n");
        const settings = validateOptions({ maxplayers: 12, difficulty: "2", autocreate: "3", seed: "my seed", motd: "Friends", secure: true }, { world: "World One", port: 7780, custom: true });
        await fs.writeFile(file, configText(root, settings, "private", await fs.readFile(file, "utf8")), { mode: 0o600 });
        const text = await fs.readFile(file, "utf8");
        expect(text).toContain("npcstream=42\n"); expect(text).toContain("port=7780\n"); expect(text.match(/^port=/gm)).toHaveLength(1);
        expect(text).toContain(`world=${path.join(root, "worlds/World One.wld")}\n`);
        expect(text).toContain("secure=1\n"); expect(text).toContain("upnp=0\n"); expect(text).toContain("autocreate=3\n"); expect(text).toContain("language=en-US\n");
        expect(settings.custom).toBe(true);
        for (const bad of [{ maxplayers: 0 }, { difficulty: "4" }, { motd: "bad\npassword=x" }, { password: "x\0y" }, { secure: "yes" }]) expect(() => validateOptions(bad)).toThrow();
        for (const bad of ["../world", "bad.wld", "", "a/b"]) expect(() => worldName(bad)).toThrow();
        expect(configText(root, settings, "", text)).not.toContain("private");
        expect(() => configText(root, { port: 70000 }, "")).toThrow("Port must be a whole number from 1 to 65535");
    } finally { await fs.rm(root, { recursive: true }); }
});
test("Terraria host/capability metadata has no Minecraft operations or uncertified host routes", () => {
    const options = { software: "vanilla", version: "1.4.5.8" };
    for (const os of ["linux", "win32"]) for (const software of ["vanilla", "tmodloader"]) expect(terraria.hostSupport({ os, arch: "x64" }, { ...options, software }).supported).toBe(true);
    for (const [os, arch] of [["linux", "arm64"], ["darwin", "arm64"], ["win32", "arm64"], ["darwin", "x64"]]) {
        const support = terraria.hostSupport({ os: os!, arch: arch! }, options); expect(support.supported).toBe(false); expect(support.reason).toBeTruthy();
    }
    expect(terraria.describe(options).widgets).toEqual(["status", "console"]);
    // Terraria's players and chat are its own tabs, never Minecraft's
    expect(terraria.describe(options).tabs.filter(t => t.id === "players" || t.id === "chat").map(t => t.owner)).toEqual(["game", "game"]);
    for (const action of ["op-player", "install-modpack", "reset-world-files", "set-gamerule"]) expect(() => assertGameAction(terraria, options, action)).toThrow("does not support");
    expect(() => terraria.describe({ ...options, software: "forge" })).toThrow("Unsupported");
});
test("Terraria refuses a mismatched publisher archive before creating any install files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "terraria-archive-"));
    try {
        await expect(unpackArchive(new Uint8Array([1, 2, 3]), path.join(root, "install"), "1.4.5.8", "linux")).rejects.toThrow("size/SHA-256 mismatch");
        expect(await fs.readdir(root)).toEqual([]);
    } finally { await fs.rm(root, { recursive: true }); }
});


test("Terraria release replacement and interrupted swap recovery leave worlds untouched", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "terraria-release-"));
    try {
        const target = path.join(root, "install"); const staging = path.join(root, "staging");
        await fs.mkdir(target); await fs.mkdir(staging);
        await fs.writeFile(path.join(root, "World.wld"), "persistent world");
        await fs.writeFile(path.join(target, "server"), "old executable");
        await fs.writeFile(path.join(staging, "server"), "repaired executable");
        await activateRelease(staging, target);
        expect(await fs.readFile(path.join(target, "server"), "utf8")).toBe("repaired executable");
        await fs.rename(target, `${target}.previous`);
        await recoverRelease(target);
        expect(await fs.readFile(path.join(target, "server"), "utf8")).toBe("repaired executable");
        await fs.mkdir(`${target}.previous`); await recoverRelease(target);
        expect(await fs.readdir(root)).toEqual(["World.wld", "install"]);
        await expect(activateRelease(path.join(root, "missing-stage"), target)).rejects.toThrow();
        expect(await fs.readFile(path.join(target, "server"), "utf8")).toBe("repaired executable");
        expect(await fs.readFile(path.join(root, "World.wld"), "utf8")).toBe("persistent world");
    } finally { await fs.rm(root, { recursive: true }); }
});

test("a Windows server without the Microsoft runtime it loads gets Origami's copy beside its executable", async () => {
    const { VISUAL_CPP_X64, XNA_4 } = await import("../src/games/windowsRuntime");
    const { provideWindowsRuntime } = await import("../src/games/windowsRuntimeInstall");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "windows-runtime-"));
    const windir = path.join(root, "Windows"), server = path.join(root, "server"), store = path.join(root, "packages");
    const downloads: string[] = [];
    const packages = {
        isInstalled: async (id: string) => downloads.includes(id),
        getPath: async (id: string) => path.join(store, id),
        download: async (id: string) => {
            downloads.push(id);
            await fs.mkdir(path.join(store, id, "bin"), { recursive: true });
            for (const dll of id === "xna-framework" ? ["Microsoft.Xna.Framework.dll", "msvcr100.dll"] : ["vcruntime140.dll", "msvcp140.dll"]) await fs.writeFile(path.join(store, id, "bin", dll), `${id} ${dll}`);
        },
    };
    try {
        await fs.mkdir(server, { recursive: true });
        await provideWindowsRuntime(XNA_4, server, windir, packages);
        expect(downloads).toEqual(["xna-framework"]);
        expect((await fs.readdir(server)).sort()).toEqual(["Microsoft.Xna.Framework.dll", "msvcr100.dll"]);
        expect(await fs.readFile(path.join(server, "msvcr100.dll"), "utf8")).toBe("xna-framework msvcr100.dll");
        // installed once, placed again at the next start
        await fs.rm(path.join(server, "msvcr100.dll"));
        await provideWindowsRuntime(XNA_4, server, windir, packages);
        expect(downloads).toEqual(["xna-framework"]);
        expect(await fs.readFile(path.join(server, "msvcr100.dll"), "utf8")).toBe("xna-framework msvcr100.dll");

        // Windows' own install wins; a partial Visual C++ install still counts as missing
        const palworld = path.join(root, "palworld");
        await fs.mkdir(palworld);
        for (const file of [...XNA_4.files, ...VISUAL_CPP_X64.files.slice(0, 2)]) {
            await fs.mkdir(path.dirname(path.join(windir, file)), { recursive: true });
            await fs.writeFile(path.join(windir, file), "MZ");
        }
        await provideWindowsRuntime(VISUAL_CPP_X64, palworld, windir, packages);
        expect(downloads).toEqual(["xna-framework", "vc-runtime"]);
        expect((await fs.readdir(palworld)).sort()).toEqual(["msvcp140.dll", "vcruntime140.dll"]);
        await fs.writeFile(path.join(windir, VISUAL_CPP_X64.files[2]!), "MZ");
        const other = path.join(root, "other");
        await fs.mkdir(other);
        await provideWindowsRuntime(VISUAL_CPP_X64, other, windir, packages);
        expect(await fs.readdir(other)).toEqual([]);

        // a failed install fails the start with its own reason
        const offline = { ...packages, isInstalled: async () => false, download: async () => { throw new Error("Package xna-framework not found"); } };
        await expect(provideWindowsRuntime(XNA_4, server, path.join(root, "bare"), offline)).rejects.toThrow("Package xna-framework not found");
        await expect(provideWindowsRuntime(XNA_4, server, "", packages)).rejects.toThrow("SystemRoot is not set");
    } finally { await fs.rm(root, { recursive: true }); }
});

test("vanilla Terraria and Palworld list the Windows runtime packages they may install", async () => {
    const { palworld } = await import("../src/games/palworld");
    expect(terraria.describe({ software: "vanilla", version: "1.4.5.8" }).packages).toEqual([{ id: "xna-framework", purpose: "XNA Framework for the server on Windows computers without it" }]);
    expect(palworld.describe({ software: "", version: "" }).packages.map(p => p.id)).toEqual(["steamcmd", "vc-runtime"]);
});

test("Windows sends console commands as UTF-16, the encoding Terraria reads there", async () => {
    const { consoleInput } = await import("../src/games/terraria/windows");
    expect(consoleInput("win32")).toBe("utf16le");
    expect(consoleInput("linux")).toBe("utf8");
});
