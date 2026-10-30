import { describe, expect, test } from "bun:test";
import { createServerId, isServerId, readServersConfig, MAX_SERVERS, serverName } from "../src/servers";

describe("stored servers", () => {
    test("a legacy config migrates once, retaining every setting and its original directory", () => {
        const old = { configured: true, software: "fabric", version: "1.21.4", ramGB: 8, installed: { launch: "server.jar" }, gamerules: { keepInventory: "true" } };
        const first = readServersConfig(old);
        expect(first.servers).toHaveLength(1);
        expect(first.legacyServer).toBe(first.servers[0]!.id);
        expect(first.servers[0]).toMatchObject({ directory: "", game: "minecraft", settings: old });
        expect(readServersConfig(first)).toEqual(first);
        expect(old).not.toHaveProperty("servers");
    });
    test("empty config has no server; unfinished legacy installs still migrate", () => {
        expect(readServersConfig(null).servers).toEqual([]);
        expect(readServersConfig({}).servers).toEqual([]);
        expect(readServersConfig({ configured: false, ramGB: 2 }).servers[0]!.settings).toEqual({ configured: false, ramGB: 2 });
    });
    test("ids follow the Actions project rule and are safe independent directory names", () => {
        const ids = Array.from({ length: MAX_SERVERS }, createServerId);
        expect(new Set(ids).size).toBe(MAX_SERVERS);
        expect(ids.every(isServerId)).toBe(true);
        for (const bad of ["../other", "/tmp/server", "x/y", "", "-start", "x".repeat(65)]) expect(isServerId(bad)).toBe(false);
    });
    test("damaged, duplicate, traversing and newer lists are refused without changing them", () => {
        const config = readServersConfig({ configured: true });
        const duplicate = { ...config, servers: [...config.servers, ...config.servers] };
        expect(() => readServersConfig(duplicate)).toThrow("damaged");
        expect(() => readServersConfig({ ...config, version: 3 })).toThrow("unsupported version");
        expect(() => readServersConfig({ ...config, servers: [{ ...config.servers[0], directory: "../other" }] })).toThrow("damaged");
        expect(() => readServersConfig({ ...config, legacyServer: "missing" })).toThrow("legacy server reference");
        expect(config.servers[0]!.directory).toBe("");
    });
    test("names are explicit, bounded, and trimmed", () => {
        expect(serverName("  Survival  ")).toBe("Survival");
        for (const value of ["", " ", null, "s".repeat(101)]) expect(() => serverName(value)).toThrow("name");
    });
});
