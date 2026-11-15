import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { cs2Call as call, cs2Server } from "./helpers/cs2";
import { CS2 } from "../src/games/cs2";
import { configFiles, installedMaps } from "../src/games/cs2/service";
import { activatedMap, consoleSaid, parseStatusPlayers, withoutPositions } from "../src/games/cs2/console";
import { parseLogLine } from "../src/games/source/log";
import { describedCalls, SOURCE_CALLS } from "../src/games/source";
import { TF2 } from "../src/games/tf2";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const ids = SOURCE_CALLS;

// Counter-Strike 2, against a stand-in that prints what the real server was measured to (build 26598758).
describe("Counter-Strike 2", () => {
    test("what the real server prints is read as it was measured", () => {
        expect(activatedMap("Host activate: Loading (de_dust2)")).toBe("de_dust2");
        expect(activatedMap("Host activate: Changelevel (de_inferno)")).toBe("de_inferno");
        for (const other of ["Host activate: Idle (console)", "Host activate: Quitting", 'Loading map "de_dust2"']) expect(activatedMap(other)).toBeNull();
        expect(parseStatusPlayers(["  id     time ping loss      state   rate adr name", "   0      BOT    0    0     active      0 'Baroud'", "   2    01:02   45    0     active 786432 1.2.3.4:27005 'It's Ann'"]))
            .toEqual([{ userId: 0, bot: true, name: "Baroud" }, { userId: 2, bot: false, name: "It's Ann" }]);
        expect(consoleSaid('"Console<0>" say "hello from stdin"')).toBe("hello from stdin");
        expect(consoleSaid('"Ann<2><[U:1:1]><CT>" say "hi"')).toBeNull();
        // a bot's join as the server logs it, and a kill with the positions it writes in
        expect(parseLogLine('L 11/12/2026 - 18:51:36: "Mae<2><BOT><>" connected, address "(unknown)"')).toMatchObject({ kind: "connected", player: { name: "Mae", userId: 2, steamId: "BOT" } });
        expect(parseLogLine(withoutPositions('L 11/12/2026 - 18:51:36: "Ann<2><[U:1:1]><CT>" [-100 20 3] killed "Bob<3><[U:1:2]><TERRORIST>" [5 -6 7] with "ak47"'))).toMatchObject({ kind: "kill", player: { name: "Ann" }, victim: { name: "Bob" } });
    });

    test("gameplay settings go where the game's own mode config can't undo them, and only places to play are maps", async () => {
        const files = configFiles({ gamemode: "wingman", bot_quota: 3, hostname: "Mine" }, true);
        expect(Object.keys(files).sort()).toEqual(["gamemode_competitive2v2_server.cfg", "server.cfg"]);
        expect(files["server.cfg"]).toContain("log on\nsv_logecho 1\n");
        expect(files["server.cfg"]).not.toContain("bot_quota");
        expect(files["gamemode_competitive2v2_server.cfg"]!.split("\n")).toEqual(expect.arrayContaining(['hostname "Mine"', "bot_quota 3", 'bot_difficulty "1"', "mp_autoteambalance 1", "exec paperboard_user.cfg"]));
        expect(() => configFiles({ gamemode: "surf" }, false)).toThrow('Counter-Strike 2 has no game mode "surf"');
        expect(() => configFiles({ hostname: 'x"; quit' }, false)).toThrow("can't hold quotes or semicolons");

        const server = await cs2Server();
        expect(await installedMaps(path.join(server.dir, "install", "game", "csgo"))).toEqual(["de_dust2", "de_inferno"]);
        await expect(call(server, "writeGameOptions", { patch: { map: "lobby_mapveto" } })).rejects.toThrow("is not installed");
        await expect(call(server, ids.changeMap, { map: "../cfg/server" })).rejects.toThrow("Choose a map by its name");
        // a game answers what it describes: one with no rotation, Workshop or SourceMod describes none of their calls
        expect(describedCalls(CS2)).not.toContain(ids.mapCycleSet);
        expect(describedCalls(CS2)).not.toContain(ids.sourcemodSet);
        expect(describedCalls(TF2)).toEqual(expect.arrayContaining([SOURCE_CALLS.mapCycleSet, SOURCE_CALLS.workshopAdd, SOURCE_CALLS.sourcemodSet]));
    });

});
