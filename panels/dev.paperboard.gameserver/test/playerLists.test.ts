import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { loopbackServer, routeHost, type LoopbackServer } from "./helpers/http";
import { currentPlayerNames, setPlayerFlag } from "../src/service/playerLists";
import { startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { punishPlayer } from "../src/games/minecraft/calls";

const XUID = "2535428504476914";
let daemon: TestDaemon;
let geyser: LoopbackServer;
let mojang: LoopbackServer;
beforeAll(async () => {
    daemon = await startTestDaemon();
    geyser = loopbackServer((_req, url) => {
        if (url.pathname === "/v2/xbox/xuid/Cool%20Gamer") return Response.json({ xuid: Number(XUID) });
        return Response.json({ message: "Unable to find user in our cache" }, { status: 503 });
    });
    mojang = loopbackServer(() => new Response(null, { status: 500 }));
    routeHost("api.geysermc.org", geyser);
    routeHost("api.mojang.com", mojang);
    routeHost("sessionserver.mojang.com", mojang);
});
afterAll(async () => {
    await daemon?.stop();
});

const NAMING = { prefix: ".", replaceSpaces: true };
const STEVE = "8667ba71-b85a-4004-af54-457a9734eed7";
// new UUID(0, xuid), as Floodgate builds a Bedrock player's uuid
const FLOODGATE_UUID = (() => {
    const hex = BigInt(XUID).toString(16).padStart(16, "0");
    return `00000000-0000-0000-${hex.slice(0, 4)}-${hex.slice(4)}`;
})();

const read = (mc: McServer, file: string) => fs.readFileSync(path.join(mc.dir, file), "utf8");
const exists = (mc: McServer, file: string) => fs.existsSync(path.join(mc.dir, file));
const flag = (mc: McServer, which: "op" | "whitelist", name: string, on = true, naming: typeof NAMING | null = null) =>
    setPlayerFlag(mc.server, naming, which, name, on);

async function running(mc: McServer): Promise<void> {
    await startServerInstance(mc.server);
    await mc.server.waitFor((s) => s.serverStatus === "online", "the server to come online");
}
async function stop(mc: McServer): Promise<void> {
    const exit = mc.nextExit();
    await stopServerInstance(mc.server);
    await exit;
}

// Op and whitelist edits keep the server's files intact.
describe("op and whitelist edits", () => {
    test("a stopped offline-mode server gets Mojang's file format with the OfflinePlayer uuid and the op level it grants", async () => {
        const mc = minecraftServer({ files: { "server.properties": "online-mode=false\nop-permission-level=3\n" } });
        await flag(mc, "op", "Notch");
        // the uuid Java's UUID.nameUUIDFromBytes("OfflinePlayer:Notch") gives
        expect(read(mc, "ops.json")).toBe(
            `${JSON.stringify([{ uuid: "b50ad385-829d-3141-a216-7e7d7539ba7f", name: "Notch", level: 3, bypassesPlayerLimit: false }], null, 2)}\n`,
        );
        // a second op of the same player changes nothing
        await flag(mc, "op", "notch");
        expect(JSON.parse(read(mc, "ops.json"))).toHaveLength(1);
        await flag(mc, "op", "Notch", false);
        expect(JSON.parse(read(mc, "ops.json"))).toEqual([]);
    });

    test("a player the server has seen keeps the uuid in usercache.json and Mojang is never asked", async () => {
        const uuid = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
        const mc = minecraftServer({
            files: {
                "server.properties": "online-mode=true\n",
                "usercache.json": JSON.stringify([{ name: "Alex", uuid, expiresOn: "2030-01-01 00:00:00 +0000" }]),
                "whitelist.json": JSON.stringify([{ uuid: "11111111-2222-3333-4444-555555555555", name: "Kept" }]),
            },
        });
        await flag(mc, "whitelist", "alex");
        expect(JSON.parse(read(mc, "whitelist.json"))).toEqual([
            { uuid: "11111111-2222-3333-4444-555555555555", name: "Kept" },
            { uuid, name: "Alex" },
        ]);
        expect(mojang.requests).toEqual([]);
    });

    test("a damaged list fails the edit and is not overwritten", async () => {
        const mc = minecraftServer({ files: { "server.properties": "online-mode=false\n", "whitelist.json": "[{\"name\": \"Steve\"," } });
        await expect(flag(mc, "whitelist", "Steve")).rejects.toThrow("whitelist.json is not valid JSON");
        expect(read(mc, "whitelist.json")).toBe("[{\"name\": \"Steve\",");
    });

    test("a running server takes them through its console, done once it has, and a change it refuses fails with its words", async () => {
        const mc = minecraftServer({ files: { "server.properties": "online-mode=true\n", "usercache.json": JSON.stringify([{ name: "Steve", uuid: STEVE, expiresOn: "2030-01-01 00:00:00 +0000" }]) } });
        await running(mc);
        await flag(mc, "op", "Steve");
        // the server wrote it, as it writes its own lists
        expect(JSON.parse(read(mc, "ops.json"))).toEqual([{ uuid: STEVE, name: "Steve", level: 4, bypassesPlayerLimit: false }]);
        await expect(flag(mc, "whitelist", "Steve", false)).rejects.toThrow("The server refused: Player is not whitelisted");
        // an online-mode server finds no account by that name
        await expect(flag(mc, "whitelist", "Nobody")).rejects.toThrow("The server refused: That player does not exist");
        // Steve is not on it, so there is nobody to kick
        await expect(punishPlayer(mc.server, "kick", "Steve")).rejects.toThrow("The server refused: No player was found");
        expect(mc.commands().filter((c) => c !== "list")).toEqual(["op Steve", "whitelist remove Steve", "whitelist add Nobody", "kick Steve"]);
        expect(JSON.parse(read(mc, "whitelist.json"))).toEqual([]);
        await stop(mc);
    });

    test("a Bedrock player gets the uuid Floodgate derives from GeyserMC's XUID offline, and fwhitelist online", async () => {
        const mc = minecraftServer({ files: { "server.properties": "online-mode=true\n" } });
        await flag(mc, "whitelist", ".Cool_Gamer", true, NAMING);
        expect(JSON.parse(read(mc, "whitelist.json"))).toEqual([{ uuid: FLOODGATE_UUID, name: ".Cool_Gamer" }]);
        expect(geyser.requests).toContain("/v2/xbox/xuid/Cool%20Gamer");
        expect(mojang.requests).toEqual([]);

        await running(mc);
        await flag(mc, "whitelist", ".Cool_Gamer", true, NAMING);
        await mc.received('fwhitelist add "Cool Gamer"');
        await stop(mc);
    });

    test("a gamertag GeyserMC does not know writes nothing and sends nothing", async () => {
        const mc = minecraftServer({ files: { "server.properties": "online-mode=true\n" } });
        await expect(flag(mc, "whitelist", ".Nobody", true, NAMING)).rejects.toThrow('GeyserMC has no Xbox account named "Nobody"');
        expect(exists(mc, "whitelist.json")).toBe(false);

        await running(mc);
        await expect(flag(mc, "whitelist", ".Nobody", true, NAMING)).rejects.toThrow("GeyserMC has no Xbox account");
        // the stop that follows is the next thing the server hears
        await stop(mc);
        expect(mc.commands().filter((c) => c !== "list")).toEqual(["stop"]);
        expect(mojang.requests).toEqual([]);
    });

    test("a name lookup Mojang fails keeps the name on file and says why in the console", async () => {
        const mc = minecraftServer();
        expect(await currentPlayerNames(mc.server, ["8667ba71-b85a-4004-af54-457a9734eed7"], null)).toEqual({});
        expect(mc.server.state.serverEntries.map((e) => String(e.content))).toEqual([expect.stringMatching(/^\[Paperboard\] 1 player name lookup\(s\) failed: .*500/)]);
    });
});
