import { describe, expect, test } from "bun:test";
import { createServerId, isServerId, readServersConfig } from "../src/servers";

const LEGACY = { configured: true, software: "paper", version: "1.21.1", install: { software: "paper" }, autoRestart: { daily: "04:00" } };

// Stored server list migrates legacy config safely.
describe("the stored server list", () => {
    test("a pre-multi-server config migrates once into one Minecraft server owning the old folder, settings kept, input untouched", () => {
        const input = structuredClone(LEGACY);
        const migrated = readServersConfig(input);
        expect(input).toEqual(LEGACY);
        expect(migrated.servers).toHaveLength(1);
        const [server] = migrated.servers;
        expect(server).toMatchObject({ directory: "", game: "minecraft", name: "Minecraft server", settings: LEGACY });
        expect(migrated.legacyServer).toBe(server!.id);
        expect(migrated.serversDirectory).toMatch(/^servers-[a-f0-9]{12}$/);
        // read again as saved: the same, not migrated a second time
        expect(readServersConfig(structuredClone(migrated))).toEqual(migrated);
    });

    test("damaged lists throw: duplicate ids, a directory outside the servers folder, an unknown version, a dangling legacy reference", () => {
        const good = readServersConfig(LEGACY);
        const server = good.servers[0]!;
        const second = { ...server, id: "s-aaaaaaaaaaaa", directory: `${good.serversDirectory}/s-aaaaaaaaaaaa` };
        const cases: [string, unknown][] = [
            ["duplicate ids", { ...good, servers: [server, { ...second, id: server.id }] }],
            ["a ../ directory", { ...good, servers: [{ ...second, directory: `${good.serversDirectory}/../../etc` }] }],
            ["a directory of another server", { ...good, servers: [second, { ...second, id: "s-bbbbbbbbbbbb" }] }],
            ["an unsupported version", { ...good, version: 3 }],
            ["a damaged servers directory", { ...good, serversDirectory: "../outside" }],
            ["a dangling legacy reference", { ...good, legacyServer: "s-cccccccccccc" }],
            ["an unknown game", { ...good, servers: [{ ...second, game: "factorio" }] }],
            ["an array", []],
        ];
        for (const [what, saved] of cases) {
            const before = structuredClone(saved);
            expect(() => readServersConfig(saved), what).toThrow();
            expect(saved).toEqual(before);
        }
    });

    test("server ids are safe directory names", () => {
        for (let i = 0; i < 20; i++) expect(isServerId(createServerId())).toBe(true);
        for (const id of ["../x", "a/b", ".hidden", "", "a\\b", "x".repeat(65), "a b"]) expect([id, isServerId(id)]).toEqual([id, false]);
    });
});
