// Player data delete (bun test): the real service/players.ts and trash-remove
// run against a temporary server folder on disk; only the daemon's file API
// is replaced by direct reads and writes of that folder.
// Deleting a player must take their files out of a 26.x world (players/…),
// which the delete used to miss entirely, and drop them from usercache.json,
// which is what put a deleted player straight back on the roster.
import { describe, it, expect, mock, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gameserver-players-"));
const inRoot = (path: string) => nodePath.join(root, ...path.split("/"));
const exists = (path: string) => fs.existsSync(inRoot(path));

const fileApiFake = {
    read: async (path: string) =>
        exists(path) ? fs.readFileSync(inRoot(path), "utf8") : null,
    write: async (path: string, content: string) => {
        fs.mkdirSync(nodePath.dirname(inRoot(path)), { recursive: true });
        fs.writeFileSync(inRoot(path), content);
        return inRoot(path);
    },
    exists: async (path: string) => exists(path),
    getPath: async (path: string) => inRoot(path),
};

mock.module("../src/service/api", () => ({
    config: { get: async () => null, set: async () => true },
    files: fileApiFake,
    fileApi: fileApiFake,
    system: { getInfo: async () => ({ os: "linux" }) },
    processApi: {},
}));

const { deletePlayerData } = await import("../src/service/players");

const UUID = "0f3b2c1d-1111-4222-8333-444455556666";
const OTHER = "9a8b7c6d-1111-4222-8333-444455556666";

function seed(path: string, content = "x") {
    fs.mkdirSync(nodePath.dirname(inRoot(path)), { recursive: true });
    fs.writeFileSync(inRoot(path), content);
}

function ctxWith(name: string) {
    let state: any = {
        seenPlayers: [name],
        onlinePlayers: [],
        playerStats: { [name]: {} },
        playerPlaytime: { [name]: 10 },
        playerPositions: { [name]: { x: 0, y: 0, z: 0, dimension: "minecraft:overworld" } },
    };
    return {
        get state() {
            return state;
        },
        setState(patch: any) {
            state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
        },
    } as any;
}

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("deletePlayerData", () => {
    it("removes a 26.x player's files and their usercache entry", async () => {
        fs.writeFileSync(inRoot("server.properties"), "level-name=world\n");
        for (const path of [
            `world/players/data/${UUID}.dat`,
            `world/players/data/${UUID}.dat_old`,
            `world/players/stats/${UUID}.json`,
            `world/players/advancements/${UUID}.json`,
            `world/players/stats/${OTHER}.json`,
        ])
            seed(path);
        seed(
            "usercache.json",
            JSON.stringify([
                { name: "Steve", uuid: UUID, expiresOn: "2027-01-01 00:00:00 +0000" },
                { name: "Alex", uuid: OTHER, expiresOn: "2027-01-01 00:00:00 +0000" },
            ]),
        );
        const ctx = ctxWith("steve");

        await deletePlayerData(ctx, "Steve", UUID);

        expect(exists(`world/players/data/${UUID}.dat`)).toBe(false);
        expect(exists(`world/players/data/${UUID}.dat_old`)).toBe(false);
        expect(exists(`world/players/stats/${UUID}.json`)).toBe(false);
        expect(exists(`world/players/advancements/${UUID}.json`)).toBe(false);
        expect(exists(`world/players/stats/${OTHER}.json`)).toBe(true);
        const cache = JSON.parse(fs.readFileSync(inRoot("usercache.json"), "utf8"));
        expect(cache.map((e: { name: string }) => e.name)).toEqual(["Alex"]);
        expect(ctx.state.seenPlayers).toEqual([]);
        expect(ctx.state.playerPositions).toEqual({});
    });

    it("still removes a pre-26 world's files", async () => {
        fs.writeFileSync(inRoot("server.properties"), "level-name=old\n");
        seed(`old/playerdata/${UUID}.dat`);
        seed(`old/stats/${UUID}.json`);

        await deletePlayerData(ctxWith("steve"), "Steve", UUID);

        expect(exists(`old/playerdata/${UUID}.dat`)).toBe(false);
        expect(exists(`old/stats/${UUID}.json`)).toBe(false);
    });

    it("fails loudly on a damaged usercache instead of overwriting it", async () => {
        fs.writeFileSync(inRoot("server.properties"), "level-name=world\n");
        seed("usercache.json", "{not json");

        await expect(deletePlayerData(ctxWith("steve"), "Steve", UUID)).rejects.toThrow(
            "usercache.json is not valid JSON",
        );
        expect(fs.readFileSync(inRoot("usercache.json"), "utf8")).toBe("{not json");
    });
});
