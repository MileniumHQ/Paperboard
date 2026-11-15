import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { testServer } from "./helpers/scope";
import { handleProcessData } from "../src/service/lifecycle";
import { classifyExit, markStopRequested } from "../src/service/automation";
import { minecraftOf } from "../src/games/minecraft/state";
import { TRIGGER_IDS } from "../src/service/contract";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const PAPER = (text: string) => `[12:00:00 INFO]: ${text}`;

// Several servers run in one service, and nothing but the server a helper is
// handed says which one it works on: no async context, no "current" server.
// Their calls interleave here with no scope around any of them.
describe("servers in one service", () => {
    test("keep their own state, console, settings, processes and timers", async () => {
        const survival = testServer({ id: "s-a", name: "Survival", game: "minecraft", directory: "servers/s-a", settings: { software: "paper", version: "1.21.1" } }, { serverStatus: "online", serverSoftware: "paper", serverVersion: "1.21.1" });
        const creative = testServer({ id: "s-b", name: "Creative", game: "minecraft", directory: "servers/s-b", settings: { software: "paper", version: "1.21.1" } }, { serverStatus: "online", serverSoftware: "paper", serverVersion: "1.21.1" });
        const island = testServer({ id: "s-c", name: "Island", game: "terraria", directory: "servers/s-c", settings: { version: "1.4.5.8" } }, { serverStatus: "online" });

        // each names its processes and ports for itself
        expect([survival, creative, island].map((s) => s.processId(s.game.primaryProcessId))).toEqual(["s-a-mc-server", "s-b-mc-server", "s-c-terraria-server"]);
        expect(new Set([survival, creative, island].map((s) => s.portName("game"))).size).toBe(3);

        // console lines arrive in pieces, interleaved: each server joins only its own
        handleProcessData(survival, PAPER("Steve joi"));
        handleProcessData(creative, `${PAPER("Alex joined the game")}\n`);
        handleProcessData(island, "<Bob> ahoy");
        handleProcessData(survival, "ned the game\n");
        handleProcessData(island, " there\n");
        expect([survival, creative].map((s) => s.state.onlinePlayers)).toEqual([["steve"], ["alex"]]);
        expect(survival.state.serverEntries.map((e) => e.content)).toEqual([PAPER("Steve joined the game")]);
        expect(island.state.chatMessages.map((m) => m.text)).toEqual(["<Bob> ahoy there"]);
        const said = (s: typeof survival) => s.triggers.map((t) => t.id);
        expect([said(survival), said(creative), said(island)]).toEqual([[TRIGGER_IDS.playerJoined], [TRIGGER_IDS.playerJoined], [TRIGGER_IDS.chatMessage]]);

        // settings saved at once land on their own server
        await Promise.all([survival.updateSettings({ motd: "A" }), island.updateSettings({ motd: "C" }), creative.updateSettings((current) => ({ ...current, motd: "B" }))]);
        expect([survival, creative, island].map((s) => s.settings.motd)).toEqual(["A", "B", "C"]);

        // a stop asked of one server leaves the others' exits crashes
        markStopRequested(survival);
        expect(classifyExit(creative, 1)).toEqual({ kind: "crashed", whileStarting: false });
        expect(classifyExit(island, 1)).toEqual({ kind: "crashed", whileStarting: false });
        expect(classifyExit(survival, 1)).toEqual({ kind: "stopped" });

        // a Minecraft server's own maps and queues are its alone; a Terraria server has none
        expect(minecraftOf(survival)).not.toBe(minecraftOf(creative));
        minecraftOf(survival).installing = true;
        expect(minecraftOf(creative).installing).toBe(false);
        expect(() => minecraftOf(island)).toThrow("Island is not a Minecraft server");
        expect(survival.lifecycle).not.toBe(creative.lifecycle);
        expect(survival.automation).not.toBe(island.automation);
    });
});
