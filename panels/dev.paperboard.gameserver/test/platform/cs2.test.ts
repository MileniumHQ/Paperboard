import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { secretsApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "../helpers/crane";
import type { GameServer } from "../helpers/game";
import { cs2Call as call, cs2Server } from "../helpers/cs2";
import { PANEL_ID } from "../../src/servers";
import { sendServerCommand, sendChatMessage, startServerInstance, stopServerInstance } from "../../src/service/lifecycle";
import { gameFor } from "../../src/games";
import { SOURCE_CALLS } from "../../src/games/source";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

// whether this computer runs the dedicated server, by the game's own rule
// (Paperboard runs the Linux build, on x64 only)
const support = gameFor("counter-strike-2").hostSupport({ os: process.platform, arch: process.arch }, { software: "", version: "" });
const ids = SOURCE_CALLS;
const BANNED = "[U:1:24691]";
const command = (server: GameServer, line: string) => sendServerCommand(server.server, line);
const consoleOf = (server: GameServer) => server.server.state.serverEntries.map((e) => String(e.content));
const commands = (server: GameServer) => fs.readFileSync(path.join(server.dir, "install", "commands.txt"), "utf8").split("\n").filter(Boolean);
const said = (server: GameServer, text: string, what: string) => server.server.waitFor((s) => s.serverEntries.some((e) => String(e.content).includes(text)), what);

// Counter-Strike 2 running, against a stand-in that prints what the real server was measured to (build 26598758).
describe("Counter-Strike 2", () => {
    test.skipIf(!support.supported)("the server is driven through its console: passwords stay out of sight, a banned player is put out as they join, chat, kicks and map changes are read back, and time on survives a failed save", async () => {
        const server = await cs2Server();
        await call(server, "writeGameOptions", { patch: { password: "join-Secret-1", token: "token-Secret-1", gamemode: "casual", bot_quota: 2 } });
        await startServerInstance(server.server);
        await server.server.waitFor((s) => s.serverStatus === "online", "Counter-Strike 2 to say its map is running");
        expect(server.server.state.serverLevel).toBe("de_dust2");
        expect(server.server.state.maxPlayers).toBe(10);
        const started = JSON.parse(fs.readFileSync(path.join(server.dir, "install", "started-with.json"), "utf8")) as { args: string[]; secrets: string; configs: Record<string, string> };
        expect(started.args).toEqual(expect.arrayContaining(["-dedicated", "-maxplayers", "10", "+game_type", "0", "+game_mode", "0", "+sv_lan", "0", "+map", "de_dust2"]));
        expect(started.args.join(" ")).not.toMatch(/Secret|usercon|rcon/);
        expect(started.secrets).toBe('sv_password "join-Secret-1"\nsv_setsteamaccount "token-Secret-1"\n');
        expect(started.configs["gamemode_casual_server.cfg"]).toContain("bot_quota 2");
        // the passwords file is gone once the server is up, and nothing else on disk holds them
        expect(fs.existsSync(path.join(server.dir, "install", "game", "csgo", "cfg", "paperboard_secrets.cfg"))).toBe(false);
        expect((await secretsApi.get(`${server.server.id}-counter-strike-2-join-password`, PANEL_ID)).value).toBe("join-Secret-1");
        expect(JSON.stringify(server.server.settings)).not.toMatch(/Secret/);
        // asked for, the server prints its join password; the console hides it
        await command(server, "sv_password");
        await said(server, "sv_password = [redacted]", "the password line");
        expect(consoleOf(server).join("\n")).not.toContain("join-Secret-1");
        await expect(command(server, "quit")).rejects.toThrow("use Options and Stop");
        await expect(command(server, "sv_setsteamaccount stolen")).rejects.toThrow("Paperboard keeps the server's passwords");
        await expect(command(server, "status\nquit")).rejects.toThrow();

        await sendChatMessage(server.server, "hello everyone");
        await server.server.waitFor((s) => s.chatMessages.some((m) => m.event === "server" && m.content === "hello everyone"), "the console's chat line");

        // a player joins, is counted, and is kicked by the server's id for them
        await command(server, "fake_connect 5 [U:1:1] Ann");
        await server.server.waitFor((s) => s.onlinePlayers.includes("Ann"), "Ann online");
        await command(server, "fake_connect 6 BOT Baroud");
        await said(server, '"Baroud<6><BOT><>" connected', "the bot's join");
        expect((await call(server, ids.metrics) as { bots: number }).bots).toBe(1);
        expect(server.server.state.onlinePlayers).toEqual(["Ann"]);
        // her time on is saved as she goes; a save that fails keeps it for the next one
        fs.chmodSync(server.dir, 0o555);
        try {
            await call(server, ids.kick, { userId: 5 });
            await server.server.waitFor((s) => !s.onlinePlayers.includes("Ann"), "Ann kicked");
            await said(server, "Could not save Ann's stats", "the failed stats save");
        } finally {
            fs.chmodSync(server.dir, 0o755);
        }
        expect(commands(server)).toContain("kickid 5 Kicked by the server admin");
        await expect(call(server, ids.kick, { userId: 5 })).rejects.toThrow("That player is not online");

        // Paperboard's own list bans: someone on it is put out the moment they connect, and when they are banned while on
        await call(server, ids.ban, { steamId: BANNED });
        await command(server, `fake_connect 7 ${BANNED} Cheater`);
        await server.server.waitFor(() => commands(server).includes("kickid 7 Banned from this server"), "the banned player put out");
        await said(server, "[Paperboard] Cheater is banned and was put out as they joined.", "the console's note");
        await command(server, "fake_connect 8 [U:1:2] Bob");
        await server.server.waitFor((s) => s.onlinePlayers.includes("Bob"), "Bob online");
        await call(server, ids.ban, { steamId: "[U:1:2]" });
        await server.server.waitFor(() => commands(server).includes("kickid 8 Banned from this server"), "Bob put out when banned");
        for (const bad of ["STEAM_0:1:1", "[U:1:1]; quit", ""]) await expect(call(server, ids.ban, { steamId: bad })).rejects.toThrow("Steam id");
        await call(server, ids.unban, { steamId: BANNED });
        expect(((await call(server, ids.players)) as { bans: { steamId: string }[] }).bans.map((b) => b.steamId)).toEqual(["[U:1:2]"]);

        await call(server, ids.changeMap, { map: "de_inferno" });
        await server.server.waitFor((s) => s.serverLevel === "de_inferno", "the map change");
        expect(server.server.settings.map).toBe("de_inferno");
        // an option the server takes at once is typed into its console
        await call(server, "writeGameOptions", { patch: { mp_autoteambalance: false } });
        await server.server.waitFor(() => commands(server).includes("mp_autoteambalance 0"), "the live option");

        const exit = server.nextExit();
        await stopServerInstance(server.server);
        expect(await exit).toBe(0);
        expect(commands(server).at(-1)).toBe("quit");
        const seen = JSON.parse(fs.readFileSync(path.join(server.dir, "players.json"), "utf8")) as { steamId: string; playtime?: number }[];
        expect(seen.find((p) => p.steamId === "[U:1:1]")?.playtime).toBeGreaterThan(0);
    });

    test.skipIf(!support.supported)("a player whose join could not be recorded still has their time on saved, and keeps no one else's out", async () => {
        const server = await cs2Server();
        await startServerInstance(server.server);
        await server.server.waitFor((s) => s.serverStatus === "online", "Counter-Strike 2 to say its map is running");
        await command(server, "fake_connect 5 [U:1:2] Bob");
        const seenFile = path.join(server.dir, "players.json");
        await server.server.waitFor((s) => s.onlinePlayers.includes("Bob"), "Bob online");
        // the roster writes one at a time, so the Players tab reads it after his join record
        expect(((await call(server, ids.players)) as { seen: { steamId: string }[] }).seen.map((p) => p.steamId)).toContain("[U:1:2]");
        fs.chmodSync(server.dir, 0o555);
        try {
            await command(server, "fake_connect 6 [U:1:1] Ann");
            await said(server, "Could not record Ann", "Ann's failed join record");
        } finally {
            fs.chmodSync(server.dir, 0o755);
        }
        const exit = server.nextExit();
        await stopServerInstance(server.server);
        expect(await exit).toBe(0);
        // time on is saved as the server's run is cleaned up
        await server.server.lifecycle.released;
        const seen = JSON.parse(fs.readFileSync(seenFile, "utf8")) as { steamId: string; name: string; playtime?: number }[];
        const ann = seen.find((p) => p.steamId === "[U:1:1]");
        const bob = seen.find((p) => p.steamId === "[U:1:2]");
        expect(ann?.name).toBe("Ann");
        expect(ann?.playtime).toBeGreaterThan(0);
        expect(bob?.playtime).toBeGreaterThan(0);
    });

    test.skipIf(support.supported)("a computer it doesn't run on is told why at Start, and the server stays offline", async () => {
        const server = await cs2Server();
        await expect(startServerInstance(server.server)).rejects.toThrow(support.reason!);
        expect(server.server.state.serverStatus).toBe("offline");
    });
});
