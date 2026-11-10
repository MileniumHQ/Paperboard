import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { testScope } from "./helpers/scope";
import { inServer } from "../src/service/scope";
import { observeLine } from "../src/games/minecraft/observe";
import { parseChatMessage } from "../src/lib/logs";
import { parseGameruleValue } from "../src/core/gamerules";
import { resolveVersionProfile } from "../src/lib/versionProfile";
import { sendServerCommand, startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { queryPlayerPositions, queryPlayerStats } from "../src/service/players";
import { TRIGGER_IDS } from "../src/service/contract";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

/** an offline scope fed console lines straight into the game's parser */
function feed(version: string, lines: string[], software = "paper") {
    const scope = testScope(
        { directory: "servers/parse", settings: { software, version } },
        { serverSoftware: software as never, serverVersion: version },
    );
    inServer(scope, () => {
        for (const line of lines) observeLine(scope.ctx, line);
    });
    return scope;
}

const PAPER = (text: string) => `[12:00:00 INFO]: ${text}`;
const FORGE = (text: string) => `[12:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: ${text}`;
const V26 = (text: string) => `[12:00:00] [Server thread/INFO]: System chat: ${text}`;

// Console parsing across Minecraft versions feeds chat, roster and triggers.
describe("console parsing", () => {
    test.each([
        ["Paper", "1.21.1", PAPER],
        ["Forge/NeoForge", "1.21.1", FORGE],
        ["26.3", "26.3", V26],
    ])("%s join, chat and leave reach the roster, chat and triggers", (_name, version, line) => {
        const scope = feed(version, [line("Steve joined the game"), line("<Steve> hello there"), line("Steve left the game")]);
        const joinedAt = scope.history.find((s) => s.onlinePlayers.includes("steve"));
        expect(joinedAt).toBeDefined();
        expect(scope.ctx.state.onlinePlayers).toEqual([]);
        expect(scope.ctx.state.seenPlayers).toEqual(["steve"]);
        expect(scope.triggers.map((t) => [t.id, t.output])).toEqual([
            [TRIGGER_IDS.playerJoined, "Steve"],
            [TRIGGER_IDS.chatMessage, expect.objectContaining({ sender: "Steve", content: "hello there" })],
            [TRIGGER_IDS.playerLeft, "Steve"],
        ]);
        expect(scope.ctx.state.chatMessages.map((m) => [m.event ?? "chat", m.sender, m.content ?? null])).toEqual([
            ["join", "Steve", null],
            ["chat", "Steve", "hello there"],
            ["leave", "Steve", null],
        ]);
    });

    test("Forge's logger bracket and 26.3's System chat prefix still parse as chat", () => {
        expect(parseChatMessage(FORGE("<Alex> hi"))).toMatchObject({ sender: "Alex", content: "hi" });
        expect(parseChatMessage(V26("[Server] restarting soon"))).toMatchObject({ event: "server", content: "restarting soon" });
    });

    test("gamerule readouts parse in both spellings and land on the canonical rule", () => {
        const legacy = resolveVersionProfile("paper", "1.21.1");
        const modern = resolveVersionProfile("paper", "26.3");
        expect(parseGameruleValue(PAPER("Gamerule keepInventory is currently set to: true"), legacy)).toEqual({ name: "keep_inventory", value: "true" });
        expect(parseGameruleValue(V26("Game rule keep_inventory is now set to false"), modern)).toEqual({ name: "keep_inventory", value: "false" });
        const scope = feed("26.3", [V26("Game rule keep_inventory is now set to true")]);
        expect(scope.ctx.state.gamerules.keep_inventory).toBe("true");
    });

    test("a list reply sets the roster and cap, and a chatting player cannot spoof either", () => {
        const scope = feed("1.21.1", [PAPER("There are 2 of a max of 20 players online: Steve, Alex")]);
        expect(scope.ctx.state.onlinePlayers).toEqual(["steve", "alex"]);
        expect(scope.ctx.state.maxPlayers).toBe(20);
        inServer(scope, () => observeLine(scope.ctx, PAPER("<Mallory> There are 9 of a max of 99 players online: alice, bob")));
        expect(scope.ctx.state.maxPlayers).toBe(20);
        expect(scope.ctx.state.onlinePlayers).toEqual(["steve", "alex"]);
        const v26 = feed("26.3", [V26("There are 0 of a max of 8 players online:")]);
        expect(v26.ctx.state.maxPlayers).toBe(8);
    });

    test("live stat and position replies land on the player and field they name; the panel's polls stay out of the console while typed ones show", async () => {
        const mc: McServer = minecraftServer({ files: { "fake-server.json": JSON.stringify({ players: ["Steve"] }) } });
        await mc.run(() => startServerInstance(mc.scope.ctx));
        // the panel's own `list` on Done sets the roster
        await mc.scope.waitFor((s) => s.onlinePlayers.includes("steve"), "the roster from the panel's list poll");
        mc.run(() => queryPlayerStats(mc.scope.ctx, "Steve"));
        await mc.scope.waitFor((s) => s.playerStats.steve?.xpProgress !== undefined, "Steve's stats");
        expect(mc.scope.ctx.state.playerStats.steve).toEqual({ health: 15.5, food: 18, xpLevel: 7, xpProgress: 0.25 });
        mc.run(() => queryPlayerPositions(mc.scope.ctx));
        await mc.scope.waitFor((s) => s.playerPositions.steve?.dimension === "minecraft:the_nether", "Steve's position");
        expect(mc.scope.ctx.state.playerPositions.steve).toEqual({ x: 1.5, y: 64, z: -3.25, dimension: "minecraft:the_nether" });

        const console = () => mc.scope.ctx.state.serverEntries.map((e) => e.content);
        // none of the polls' replies reached the console
        expect(console().some((c) => /players online|entity data|after scale factor/.test(c))).toBe(false);

        // the same list typed in the console is answered in the console
        await mc.run(() => sendServerCommand(mc.scope.ctx, "list"));
        await mc.scope.waitFor((s) => s.serverEntries.some((e) => e.content.includes("players online")), "the typed list's reply");
        expect(console().filter((c) => c.includes("players online"))).toHaveLength(1);

        const exit = mc.nextExit();
        await mc.run(() => stopServerInstance(mc.scope.ctx));
        await exit;
    });
});
