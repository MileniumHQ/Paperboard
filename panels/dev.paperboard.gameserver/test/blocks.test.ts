// Game Server's blocks (Actions API v2), read the way the Blocks panel
// reads them: through the real daemon, from the installed service.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { actionsApi, blocksApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { installFakeJava } from "./helpers/fakeJava";
import { installPanel, restartService, servicesState } from "./helpers/installedPanel";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";

const SERVERS = "servers-0123456789ab";
const dataDir = process.env.PAPERBOARD_DIR!;
const serverDir = path.join(dataDir, "files", PANEL_ID, SERVERS, "s-a");
const stored = { id: "s-a", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-a`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } };
const read = <T>(value: string) => blocksApi.read<T>(PANEL_ID, value, undefined, { project: "s-a" });

let daemon: TestDaemon;
beforeAll(async () => {
    installPanel(dataDir);
    fs.mkdirSync(path.join(dataDir, "configs"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "configs", `${PANEL_ID}.json`), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [stored] }));
    writeTree(serverDir, {
        "server.jar": "jar",
        "eula.txt": "eula=true\n",
        "fake-server.json": JSON.stringify({ players: ["alice", "bob"], maxPlayers: 10 }),
    });
    installFakeJava(javaPackageFor("1.21.1")!, dataDir);
    daemon = await startTestDaemon();
    await restartService();
});
afterAll(async () => {
    await actionsApi.call(PANEL_ID, "s-a/stop-server", {}, { timeoutMs: null });
    await daemon?.stop();
});

describe("each server is a Blocks project with the players as values", () => {
    test("the server's project lists its values and Minecraft's Kick Player, and the panel's Player type", async () => {
        expect(await blocksApi.projects(PANEL_ID)).toEqual([{ panelId: PANEL_ID, id: "s-a", name: "Survival", icon: expect.any(String) }]);
        const entries = (await blocksApi.list(PANEL_ID)).map((b) => b.entry).sort();
        expect(entries).toEqual(["s-a/command.kick-player", "s-a/value.online-players", "s-a/value.player-count", "type.player"]);
        const kick = (await blocksApi.list(PANEL_ID)).find((b) => b.entry === "s-a/command.kick-player")!;
        expect(kick.schema).toMatchObject({ text: "Kick {player} because {reason}", inputs: { player: { type: `${PANEL_ID}:player` } } });
    });

    test("the values read the players online, and a kick announces the change before a fresh read shows it", async () => {
        const state = servicesState();
        await actionsApi.call(PANEL_ID, "s-a/start-server", {}, { timeoutMs: null });
        await state.waitFor("s-a", (s) => s.serverStatus === "online" && s.onlinePlayers.length === 2, "s-a online with its players");
        expect(await read("player-count")).toBe(2);
        expect(await read("online-players")).toEqual(["alice", "bob"]);

        const changed = new Set<string>();
        const off = [
            blocksApi.onChange(PANEL_ID, "player-count", () => changed.add("player-count"), "s-a"),
            blocksApi.onChange(PANEL_ID, "online-players", () => changed.add("online-players"), "s-a"),
        ];
        try {
            // subscriptions reach the daemon on their own; let them land first
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(await blocksApi.run(PANEL_ID, "kick-player", { player: "alice", reason: "testing" }, { project: "s-a" })).toBeNull();
            await state.waitFor("s-a", (s) => s.onlinePlayers.length === 1, "alice to leave");
            const deadline = Date.now() + 10_000;
            while (changed.size < 2) {
                if (Date.now() > deadline) throw new Error(`only ${[...changed].join(", ") || "nothing"} announced a change`);
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            expect(await read("online-players")).toEqual(["bob"]);
            expect(await read("player-count")).toBe(1);
        } finally {
            for (const unsubscribe of off) unsubscribe();
        }
    });

    test("a kick naming no player, or one that isn't a player name, is refused before the server sees it", async () => {
        await expect(blocksApi.run(PANEL_ID, "kick-player", {}, { project: "s-a" })).rejects.toThrow('Kick Player: "Player" is required');
        await expect(blocksApi.run(PANEL_ID, "kick-player", { player: 7 }, { project: "s-a" })).rejects.toThrow('"Player": expected text');
        await expect(blocksApi.run(PANEL_ID, "kick-player", { player: "bob; stop" }, { project: "s-a" })).rejects.toThrow();
        expect(await read("online-players")).toEqual(["bob"]);
    });
});
