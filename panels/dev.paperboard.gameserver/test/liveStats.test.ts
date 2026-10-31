// Live player stats (bun test): the inspector asks the server for each
// stat with `data get entity <name> <path> <scale>` and reads the replies
// out of the console. Several players are asked at once and the server
// answers some queries with nothing a stat could be read from (a player who
// just left gets "No entity was found"), so a reply has to say whose stat
// it is. The reply lines below are copied from a real Paper 26.3 console
// (2026-10-30); the commands go through the real service and the replies
// through the real log parser. Only the process API is replaced, to record
// the commands written to the server.
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ServiceContext } from "@mileniumhq/paperapi";
import type { GameServerState } from "../src/service/types";

const written: string[] = [];
const api = { ...(await import("../src/service/api")) };
mock.module("../src/service/api", () => ({
    ...api,
    processApi: { write: async (_id: string, line: string) => void written.push(line) },
}));

const { handleProcessData, handleProcessExit } = await import("../src/service/lifecycle");
const { queryPlayerStats } = await import("../src/service/players");
const { extractStatReply } = await import("../src/core/players");

function makeCtx() {
    const state = {
        serverStatus: "online",
        serverSoftware: "paper",
        serverVersion: "26.3",
        serverEntries: [],
        chatMessages: [],
        onlinePlayers: [],
        seenPlayers: [],
        playerStats: {},
        playerPlaytime: {},
        playerPositions: {},
        gamerules: {},
        activeIssue: null,
    } as unknown as GameServerState;
    const ctx = {
        state,
        setState: (patch: any) => Object.assign(state, typeof patch === "function" ? patch(state) : patch),
        emitTrigger: () => {},
    } as unknown as ServiceContext<GameServerState>;
    return { ctx, state };
}

const line = (text: string) => `[20:57:59 INFO]: System chat: ${text}\n`;

beforeEach(() => {
    written.length = 0;
    handleProcessExit(makeCtx().ctx);
});

describe("stat replies", () => {
    it("reads the path, the player and the scaled value from a real reply", () => {
        expect(extractStatReply("[20:57:59 INFO]: System chat: Health on [Red] Steve after scale factor of 100.00 is 1962")).toEqual({
            path: "Health",
            scale: 100,
            entity: "[Red] Steve",
            value: 19.62,
        });
        expect(extractStatReply("[20:57:59 INFO]: System chat: Health on [Red] Steve after scale factor of 0.50 is 9")?.value).toBe(18);
    });

    it("never takes a chat message for a reply", () => {
        expect(extractStatReply("[20:57:59 INFO]: <Alex> Health on Steve after scale factor of 1.00 is 0")).toBeUndefined();
        expect(extractStatReply("[20:57:59 INFO]: [Not Secure] <Alex> x]: Health on Steve after scale factor of 1.00 is 0")).toBeUndefined();
    });

    it("asks with a scale, so every reply names its stat", () => {
        const { ctx } = makeCtx();
        queryPlayerStats(ctx, "Steve");
        expect(written).toEqual([
            "data get entity Steve Health 100\n",
            "data get entity Steve foodLevel 1\n",
            "data get entity Steve XpLevel 1\n",
            "data get entity Steve XpP 10000\n",
        ]);
    });

    it("puts each reply on its own player and stat, whatever order and gaps the server answers with", () => {
        const { ctx, state } = makeCtx();
        queryPlayerStats(ctx, "Steve");
        queryPlayerStats(ctx, ".Huddybud780");
        // Steve left: his first two queries get "No entity was found"
        handleProcessData(ctx, line("No entity was found") + line("No entity was found"));
        handleProcessData(ctx, line("XpLevel on .Huddybud780 after scale factor of 1.00 is 31"));
        handleProcessData(ctx, line("Health on .Huddybud780 after scale factor of 100.00 is 1962"));
        handleProcessData(ctx, line("XpP on [Red] Steve after scale factor of 10000.00 is 4235"));
        handleProcessData(ctx, line("foodLevel on .Huddybud780 after scale factor of 1.00 is 17"));
        handleProcessData(ctx, line("XpP on .Huddybud780 after scale factor of 10000.00 is 500"));

        expect(state.playerStats[".huddybud780"]).toEqual({ health: 19.62, food: 17, xpLevel: 31, xpProgress: 0.05 });
        expect(state.playerStats.steve).toEqual({ xpProgress: 0.4235 });
        // replies are poll chatter, not console output
        expect(state.serverEntries.some((e) => e.content.includes("scale factor"))).toBe(false);
    });

    it("shows a scaled data get someone typed for a player the panel did not ask about", () => {
        const { ctx, state } = makeCtx();
        handleProcessData(ctx, line("Health on Alex after scale factor of 1.00 is 20"));
        expect(state.playerStats.alex).toBeUndefined();
        expect(state.serverEntries.some((e) => e.content.includes("scale factor"))).toBe(true);
    });
});

describe("position replies", () => {
    it("puts each position on the player it names when a query goes unanswered", async () => {
        const { queryPlayerPositions } = await import("../src/service/players");
        const { ctx, state } = makeCtx();
        state.onlinePlayers = ["steve", "alex"];
        queryPlayerPositions(ctx);
        // Steve left before his Pos and Dimension queries ran
        handleProcessData(ctx, line("No entity was found") + line("No entity was found"));
        handleProcessData(ctx, line("Alex has the following entity data: [12.5d, 64.0d, -3.25d]"));
        handleProcessData(ctx, line('Alex has the following entity data: "minecraft:the_nether"'));
        expect(state.playerPositions).toEqual({ alex: { x: 12.5, y: 64, z: -3.25, dimension: "minecraft:the_nether" } });
    });
});
