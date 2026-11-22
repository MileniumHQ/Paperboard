import { describe, expect, test } from "bun:test";
import { SERVERS_VERSION, createServerId, isServerId, readServersConfig, type ServersConfig } from "../src/servers";

const GOOD: ServersConfig = {
    version: SERVERS_VERSION,
    serversDirectory: "servers-abcdef012345",
    servers: [
        {
            id: "s-111111111111",
            name: "Minecraft server",
            game: "minecraft",
            directory: "servers-abcdef012345/s-111111111111",
            createdAt: 1,
            settings: { configured: true, software: "paper", version: "1.21.1" },
        },
    ],
};

describe("the stored server list", () => {
    test("reads empty and valid v2 server lists without mutating input", () => {
        expect(readServersConfig(null).servers).toEqual([]);
        expect(readServersConfig({}).servers).toEqual([]);
        const input = structuredClone(GOOD);
        expect(readServersConfig(input)).toEqual(GOOD);
        expect(input).toEqual(GOOD);
    });

    test("damaged lists throw: duplicate ids, a directory outside the servers folder, an unknown version, missing servers field", () => {
        const server = GOOD.servers[0]!;
        const second = { ...server, id: "s-aaaaaaaaaaaa", directory: `${GOOD.serversDirectory}/s-aaaaaaaaaaaa` };
        const cases: [string, unknown][] = [
            ["missing servers field", { configured: true, software: "paper" }],
            ["duplicate ids", { ...GOOD, servers: [server, { ...second, id: server.id }] }],
            ["a ../ directory", { ...GOOD, servers: [{ ...second, directory: `${GOOD.serversDirectory}/../../etc` }] }],
            ["a directory of another server", { ...GOOD, servers: [second, { ...second, id: "s-bbbbbbbbbbbb" }] }],
            ["an empty directory", { ...GOOD, servers: [{ ...second, directory: "" }] }],
            ["an unsupported version", { ...GOOD, version: 3 }],
            ["a damaged servers directory", { ...GOOD, serversDirectory: "../outside" }],
            ["an unknown game", { ...GOOD, servers: [{ ...second, game: "factorio" }] }],
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
