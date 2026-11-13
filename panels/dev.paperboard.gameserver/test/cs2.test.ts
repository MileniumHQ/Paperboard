import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { secretsApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { gameServer, type GameServer } from "./helpers/game";
import { freePort } from "./helpers/palworld";
import { placeStandIn } from "./helpers/standIn";
import { fakeSteamcmd, steamcmdDir } from "./helpers/steamcmd";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { CALLS } from "../src/service/contract";
import { sendServerCommand, sendChatMessage, startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { CS2 } from "../src/games/cs2";
import { configFiles, cs2Service, installedMaps } from "../src/games/cs2/service";
import { activatedMap, consoleSaid, parseStatusPlayers, withoutPositions } from "../src/games/cs2/console";
import { parseLogLine } from "../src/games/source/log";
import { describedCalls, sourceCalls } from "../src/games/source";
import { TF2 } from "../src/games/tf2";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const linux = process.platform === "linux";
const ids = sourceCalls(CS2.id);
const BANNED = "[U:1:24691]";

async function cs2Server(): Promise<GameServer> {
    const server = gameServer("counter-strike-2", { settings: { port: await freePort() }, state: cs2Service.initialState() });
    fakeSteamcmd({});
    // the Steam client library SteamCMD unpacks, which the server loads from its profile
    writeTree(steamcmdDir(), { "linux64/steamclient.so": "steamclient" });
    writeTree(server.dir, {
        [`install/steamapps/appmanifest_${CS2.appId}.acf`]: `"AppState"\n{\n\t"appid"\t\t"${CS2.appId}"\n\t"buildid"\t\t"26598758"\n}\n`,
        "install/game/csgo/maps/de_dust2.vpk": "", "install/game/csgo/maps/de_dust2_vanity.vpk": "", "install/game/csgo/maps/de_inferno.vpk": "",
        "install/game/csgo/maps/lobby_mapveto.vpk": "", "install/game/csgo/maps/graphics_settings.vpk": "", "install/game/csgo/cfg/server.cfg": "// the game's own\n",
    });
    placeStandIn("fakeCs2", path.join(server.dir, "install", "game", "bin", "linuxsteamrt64", "cs2"));
    await server.run(() => cs2Service.initialize(server.scope.ctx, false));
    return server;
}
const call = async (server: GameServer, id: string, input: unknown = {}) => server.run(async () => (await cs2Service.calls())[id]!(server.scope.ctx, input));
const command = (server: GameServer, line: string) => server.run(() => sendServerCommand(server.scope.ctx, line));
const consoleOf = (server: GameServer) => server.scope.ctx.state.serverEntries.map((e) => String(e.content));
const commands = (server: GameServer) => fs.readFileSync(path.join(server.dir, "install", "commands.txt"), "utf8").split("\n").filter(Boolean);
const said = (server: GameServer, text: string, what: string) => server.scope.waitFor((s) => s.serverEntries.some((e) => String(e.content).includes(text)), what);

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
        await expect(call(server, CALLS.writeGameOptions, { patch: { map: "lobby_mapveto" } })).rejects.toThrow("is not installed");
        await expect(call(server, ids.changeMap, { map: "../cfg/server" })).rejects.toThrow("Choose a map by its name");
        // a game answers what it describes: one with no rotation, Workshop or SourceMod describes none of their calls
        expect(describedCalls(CS2)).not.toContain(ids.mapCycleSet);
        expect(describedCalls(CS2)).not.toContain(ids.sourcemodSet);
        expect(describedCalls(TF2)).toEqual(expect.arrayContaining([sourceCalls(TF2.id).mapCycleSet, sourceCalls(TF2.id).workshopAdd, sourceCalls(TF2.id).sourcemodSet]));
    });

    test.skipIf(!linux)("the server is driven through its console: passwords stay out of sight, a banned player is put out as they join, and chat, kicks and map changes are read back", async () => {
        const server = await cs2Server();
        await call(server, CALLS.writeGameOptions, { patch: { password: "join-Secret-1", token: "token-Secret-1", gamemode: "casual", bot_quota: 2 } });
        await server.run(() => startServerInstance(server.scope.ctx));
        await server.scope.waitFor((s) => s.serverStatus === "online", "Counter-Strike 2 to say its map is running");
        expect(server.scope.ctx.state.serverLevel).toBe("de_dust2");
        expect(server.scope.ctx.state.maxPlayers).toBe(10);
        const started = JSON.parse(fs.readFileSync(path.join(server.dir, "install", "started-with.json"), "utf8")) as { args: string[]; secrets: string; configs: Record<string, string> };
        expect(started.args).toEqual(expect.arrayContaining(["-dedicated", "-maxplayers", "10", "+game_type", "0", "+game_mode", "0", "+sv_lan", "0", "+map", "de_dust2"]));
        expect(started.args.join(" ")).not.toMatch(/Secret|usercon|rcon/);
        expect(started.secrets).toBe('sv_password "join-Secret-1"\nsv_setsteamaccount "token-Secret-1"\n');
        expect(started.configs["gamemode_casual_server.cfg"]).toContain("bot_quota 2");
        // the passwords file is gone once the server is up, and nothing else on disk holds them
        expect(fs.existsSync(path.join(server.dir, "install", "game", "csgo", "cfg", "paperboard_secrets.cfg"))).toBe(false);
        expect((await secretsApi.get(`${server.scope.server.id}-counter-strike-2-join-password`, PANEL_ID)).value).toBe("join-Secret-1");
        expect(JSON.stringify(server.scope.server.settings)).not.toMatch(/Secret/);
        // asked for, the server prints its join password; the console hides it
        await command(server, "sv_password");
        await said(server, "sv_password = [redacted]", "the password line");
        expect(consoleOf(server).join("\n")).not.toContain("join-Secret-1");
        await expect(command(server, "quit")).rejects.toThrow("use Options and Stop");
        await expect(command(server, "sv_setsteamaccount stolen")).rejects.toThrow("Paperboard keeps the server's passwords");
        await expect(command(server, "status\nquit")).rejects.toThrow();

        await server.run(() => sendChatMessage(server.scope.ctx, "hello everyone"));
        await server.scope.waitFor((s) => s.chatMessages.some((m) => m.event === "server" && m.content === "hello everyone"), "the console's chat line");

        // a player joins, is counted, and is kicked by the server's id for them
        await command(server, "fake_connect 5 [U:1:1] Ann");
        await server.scope.waitFor((s) => s.onlinePlayers.includes("Ann"), "Ann online");
        await command(server, "fake_connect 6 BOT Baroud");
        await said(server, '"Baroud<6><BOT><>" connected', "the bot's join");
        expect((await call(server, ids.metrics) as { bots: number }).bots).toBe(1);
        expect(server.scope.ctx.state.onlinePlayers).toEqual(["Ann"]);
        await call(server, ids.kick, { userId: 5 });
        await server.scope.waitFor((s) => !s.onlinePlayers.includes("Ann"), "Ann kicked");
        expect(commands(server)).toContain("kickid 5 Kicked by the server admin");
        await expect(call(server, ids.kick, { userId: 5 })).rejects.toThrow("That player is not online");

        // Paperboard's own list bans: someone on it is put out the moment they connect, and when they are banned while on
        await call(server, ids.ban, { steamId: BANNED });
        await command(server, `fake_connect 7 ${BANNED} Cheater`);
        await server.scope.waitFor(() => commands(server).includes("kickid 7 Banned from this server"), "the banned player put out");
        await said(server, "[Paperboard] Cheater is banned and was put out as they joined.", "the console's note");
        await command(server, "fake_connect 8 [U:1:2] Bob");
        await server.scope.waitFor((s) => s.onlinePlayers.includes("Bob"), "Bob online");
        await call(server, ids.ban, { steamId: "[U:1:2]" });
        await server.scope.waitFor(() => commands(server).includes("kickid 8 Banned from this server"), "Bob put out when banned");
        for (const bad of ["STEAM_0:1:1", "[U:1:1]; quit", ""]) await expect(call(server, ids.ban, { steamId: bad })).rejects.toThrow("Steam id");
        await call(server, ids.unban, { steamId: BANNED });
        expect(((await call(server, ids.players)) as { bans: { steamId: string }[] }).bans.map((b) => b.steamId)).toEqual(["[U:1:2]"]);

        await call(server, ids.changeMap, { map: "de_inferno" });
        await server.scope.waitFor((s) => s.serverLevel === "de_inferno", "the map change");
        expect(server.scope.server.settings.map).toBe("de_inferno");
        // an option the server takes at once is typed into its console
        await call(server, CALLS.writeGameOptions, { patch: { mp_autoteambalance: false } });
        await server.scope.waitFor(() => commands(server).includes("mp_autoteambalance 0"), "the live option");

        const exit = server.nextExit();
        await server.run(() => stopServerInstance(server.scope.ctx));
        expect(await exit).toBe(0);
        expect(commands(server).at(-1)).toBe("quit");
    });
});
