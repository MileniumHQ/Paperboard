import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { readTree } from "./helpers/tmp";
import { deletePlayerData } from "../src/service/players";
import { startServerInstance, stopServerInstance } from "../src/service/lifecycle";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const STEVE = "8667ba71-b85a-4004-af54-457a9734eed7";
const ALEX = "ec561538-f3fd-461d-aff5-086b22154bce";
const usercache = JSON.stringify([
    { name: "Steve", uuid: STEVE, expiresOn: "2030-01-01 00:00:00 +0000" },
    { name: "Alex", uuid: ALEX, expiresOn: "2030-01-01 00:00:00 +0000" },
]);

/** both players' files in the 26.x layout and the pre-26 one, in the level server.properties names */
function playerFiles(level: string): Record<string, string> {
    const files: Record<string, string> = {};
    for (const uuid of [STEVE, ALEX]) {
        files[`${level}/players/data/${uuid}.dat`] = `data ${uuid}`;
        files[`${level}/players/data/${uuid}.dat_old`] = `old ${uuid}`;
        files[`${level}/players/stats/${uuid}.json`] = `stats ${uuid}`;
        files[`${level}/players/advancements/${uuid}.json`] = `adv ${uuid}`;
        files[`${level}/playerdata/${uuid}.dat`] = `legacy ${uuid}`;
        files[`${level}/stats/${uuid}.json`] = `legacy stats ${uuid}`;
        files[`${level}/advancements/${uuid}.json`] = `legacy adv ${uuid}`;
    }
    return files;
}

const liveFiles = (mc: McServer) =>
    Object.keys(readTree(mc.dir)).filter((f) => !f.endsWith("/") && !f.startsWith(".trash-"));
const trashed = (mc: McServer) => Object.keys(readTree(mc.dir)).filter((f) => f.startsWith(".trash-") && !f.endsWith("/"));

// Deleting a player removes exactly their data.
describe("deleting a player", () => {
    test("removes their files from both layouts to the trash, and their usercache entry and roster state", async () => {
        const mc = minecraftServer({
            files: { "server.properties": "level-name=survival\n", "usercache.json": usercache, ...playerFiles("survival") },
            state: { seenPlayers: ["steve", "alex"], playerPlaytime: { steve: 60, alex: 30 }, playerStats: { steve: { health: 20 } } },
        });
        await mc.run(() => deletePlayerData(mc.scope.ctx, "Steve"));
        const live = liveFiles(mc);
        expect(live.filter((f) => f.includes(STEVE))).toEqual([]);
        expect(live.filter((f) => f.includes(ALEX))).toHaveLength(7);
        // recoverable, at their own paths
        expect(trashed(mc).map((f) => f.replace(/^\.trash-[^/]+\//, "")).sort()).toEqual(
            Object.keys(playerFiles("survival")).filter((f) => f.includes(STEVE)).sort(),
        );
        expect(JSON.parse(fs.readFileSync(path.join(mc.dir, "usercache.json"), "utf8")).map((e: { name: string }) => e.name)).toEqual(["Alex"]);
        const state = mc.scope.ctx.state;
        expect(state.seenPlayers).toEqual(["alex"]);
        expect(state.playerPlaytime).toEqual({ alex: 30 });
        expect(state.playerStats).toEqual({});
    });

    test("an online player is kicked and the world saved before their files go", async () => {
        const mc = minecraftServer({
            files: { "usercache.json": usercache, "fake-server.json": JSON.stringify({ players: ["Steve"] }), ...playerFiles("world") },
        });
        await mc.run(() => startServerInstance(mc.scope.ctx));
        await mc.scope.waitFor((s) => s.onlinePlayers.includes("steve"), "Steve to be online");
        await mc.run(() => deletePlayerData(mc.scope.ctx, "Steve", STEVE));
        const commands = mc.commands();
        expect(commands.slice(commands.indexOf("kick Steve Your player data was deleted"))).toEqual([
            "kick Steve Your player data was deleted",
            "save-all",
        ]);
        expect(liveFiles(mc).filter((f) => f.includes(STEVE))).toEqual([]);
        expect(mc.scope.ctx.state.onlinePlayers).toEqual([]);
        const exit = mc.nextExit();
        await mc.run(() => stopServerInstance(mc.scope.ctx));
        await exit;
    });

    test("is refused while the server is starting or stopping", async () => {
        for (const serverStatus of ["starting", "stopping"] as const) {
            const mc = minecraftServer({ files: { "usercache.json": usercache, ...playerFiles("world") }, state: { serverStatus } });
            await expect(mc.run(() => deletePlayerData(mc.scope.ctx, "Steve", STEVE))).rejects.toThrow("Wait until the server has finished starting or stopping");
            expect(liveFiles(mc).filter((f) => f.includes(STEVE))).toHaveLength(7);
        }
    });

    test("a damaged usercache.json fails the delete and is left as it was", async () => {
        const mc = minecraftServer({ files: { "usercache.json": "[{\"name\":", ...playerFiles("world") } });
        await expect(mc.run(() => deletePlayerData(mc.scope.ctx, "Steve", STEVE))).rejects.toThrow("usercache.json is not valid JSON");
        expect(fs.readFileSync(path.join(mc.dir, "usercache.json"), "utf8")).toBe("[{\"name\":");
    });
});
