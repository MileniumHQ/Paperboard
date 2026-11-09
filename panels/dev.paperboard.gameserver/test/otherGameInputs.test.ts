import { describe, expect, test } from "bun:test";
import * as net from "node:net";
import { SourceRcon } from "../src/games/source/rcon";
import { steamId } from "../src/games/source/log";
import { cvarValue, mapName } from "../src/games/source/config";
import { checkRotation } from "../src/games/source/mapcycle";
import { configText, validateOptions, worldName } from "../src/games/terraria/config";
import { playerName } from "../src/games/terraria/roster";

// Other games' inputs cannot be injected.
describe("other games' inputs", () => {
    test("a TF2 RCON command must be one line, and nothing is sent when it is not", async () => {
        let connections = 0;
        const server = net.createServer((socket) => {
            connections++;
            socket.destroy();
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            const rcon = new SourceRcon((server.address() as net.AddressInfo).port, "secret");
            for (const command of ["status\nrcon_password x", "say hi\rquit", "kick x\0quit"]) {
                expect(() => rcon.exec(command)).toThrow("A command must be a single line");
            }
            expect(connections).toBe(0);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test("Steam ids must be [U:1:n], and cvars hold no quotes, semicolons or line breaks", () => {
        expect(steamId("[U:1:123456]")).toBe("[U:1:123456]");
        for (const bad of ["STEAM_0:1:1", "[U:1:1]; quit", "[U:1:1]\nquit", "[U:1:]", "[U:2:1]", 7]) expect(() => steamId(bad)).toThrow("Steam id");
        for (const bad of ['x"; rcon_password y', "a;b", "a\nb", "a\0b"]) expect(() => cvarValue(bad, "Hostname")).toThrow();
        expect(cvarValue("My Server", "Hostname")).toBe('"My Server"');
    });

    test("map names must be installed names, with no traversal, .bsp, newline or foreign slash", () => {
        const installed = ["ctf_2fort", "pl_upward", "workshop/123456"];
        expect(checkRotation(["pl_upward", "ctf_2fort", "workshop/123456"], installed)).toEqual(["pl_upward", "ctf_2fort", "workshop/123456"]);
        for (const bad of ["../../cfg/server", "ctf_2fort.bsp", "ctf_2fort\nquit", "maps/ctf_2fort", "workshop/../x", "workshop/0", "C:\\maps\\x", ""]) {
            expect(() => mapName(bad)).toThrow("Choose a map by its name");
        }
        expect(() => checkRotation(["cp_dustbowl"], installed)).toThrow("cp_dustbowl is not installed");
        expect(() => checkRotation(["ctf_2fort", "ctf_2fort"], installed)).toThrow("in the rotation twice");
    });

    test("Terraria config values with a newline or NUL, bad ports and world names with / or .. are refused before writing", () => {
        expect(() => validateOptions({ port: 70000 })).toThrow("Port must be a whole number from 1 to 65535");
        expect(() => validateOptions({ port: "7777\nworld=/etc/x" })).toThrow();
        expect(() => validateOptions({ motd: "hi\nbanlist=/etc/passwd" })).toThrow();
        expect(() => validateOptions({ seed: "a\0b" })).toThrow();
        for (const bad of ["../World", "a/b", "a\\b", "..", "x\nworld=y", ""]) expect(() => worldName(bad)).toThrow("World name must be");
        expect(() => configText("/srv/t", { world: "World" }, "pw\nmotd=pwned")).toThrow("Password must be a single line");
        expect(() => configText("/srv/t", { world: "World", motd: "a\nb" }, "pw")).toThrow();
        const text = configText("/srv/t", { world: "Big World", motd: "hello" }, "pw", "# keep me\nnpcstream=60\nmotd=old\n");
        expect(text.split("\n")).toEqual(expect.arrayContaining(["# keep me", "npcstream=60", "motd=hello", "worldname=Big World"]));
        expect(text).not.toContain("motd=old");
    });

    test("Terraria kick names must be one line", () => {
        expect(playerName("Guide")).toBe("Guide");
        for (const bad of ["a\nexit", "a\rexit", "", "x".repeat(21), 5]) expect(() => playerName(bad)).toThrow();
    });
});
