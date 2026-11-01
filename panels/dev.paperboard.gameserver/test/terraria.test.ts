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

test("a Windows server refuses to start without the Microsoft runtime it loads, naming the download", async () => {
    const { assertWindowsRuntime, VISUAL_CPP_X64, XNA_4 } = await import("../src/games/windowsRuntime");
    const windir = await fs.mkdtemp(path.join(os.tmpdir(), "windir-"));
    try {
        await expect(assertWindowsRuntime("Terraria dedicated server", XNA_4, windir)).rejects.toThrow("The Terraria dedicated server needs Microsoft XNA Framework Redistributable 4.0, which this computer doesn't have. Install it from https://www.microsoft.com/en-us/download/details.aspx?id=20914, then start again.");
        // every file counts: a partial Visual C++ install still fails to load
        for (const file of [...XNA_4.files, ...VISUAL_CPP_X64.files.slice(0, 2)]) {
            await fs.mkdir(path.dirname(path.join(windir, file)), { recursive: true });
            await fs.writeFile(path.join(windir, file), "MZ");
        }
        await assertWindowsRuntime("Terraria dedicated server", XNA_4, windir);
        await expect(assertWindowsRuntime("Palworld dedicated server", VISUAL_CPP_X64, windir)).rejects.toThrow("needs Microsoft Visual C++ Redistributable 2015–2022 (x64)");
        await fs.writeFile(path.join(windir, VISUAL_CPP_X64.files[2]!), "MZ");
        await assertWindowsRuntime("Palworld dedicated server", VISUAL_CPP_X64, windir);
    } finally { await fs.rm(windir, { recursive: true }); }
});

test("Windows sends console commands as UTF-16, the encoding Terraria reads there", async () => {
    const { consoleInput } = await import("../src/games/terraria/windows");
    expect(consoleInput("win32")).toBe("utf16le");
    expect(consoleInput("linux")).toBe("utf8");
});
