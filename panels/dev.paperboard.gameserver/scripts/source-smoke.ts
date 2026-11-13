/**
 * Operator-only: downloads a real Source dedicated server from Steam and
 * drives it through the real daemon. Never part of the gate (gigabytes, and
 * Steam's availability is no regression test).
 *
 *   bun panels/dev.paperboard.gameserver/scripts/source-smoke.ts garrys-mod
 *
 * SMOKE_INSTALL names a folder SteamCMD already installed the server into, to
 * start from instead of downloading. Run it from a short TMPDIR: a Source
 * server can't open files whose path passes 260 characters.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { sourceCalls, type SourceGameSpec } from "../src/games/source";
import { GMOD } from "../src/games/gmod";
import { assert, PANEL, until, withScenarioDaemon } from "./scenarioDaemon";

/** What differs between the games this script knows: a console command that adds a bot, a second installed map, an option a running server takes at once, and a Steam id in the form the game bans by. */
const GAMES: Record<string, { spec: SourceGameSpec; bot: string; otherMap: string; live: { option: string; value: boolean; cvar: string }; steamId: string; kept: string[] }> = {
    "garrys-mod": { spec: GMOD, bot: "bot", otherMap: "gm_flatgrass", live: { option: "sbox_godmode", value: true, cvar: "sbox_godmode" }, steamId: "STEAM_0:1:12345", kept: ["sv.db"] },
};

const game = GAMES[process.argv[2] ?? ""];
if (!game) throw new Error(`Name a game: ${Object.keys(GAMES).join(", ")}`);
const { spec } = game;
const ids = sourceCalls(spec.id);

await withScenarioDaemon(`${spec.id}-real`, async ({ addServer }) => {
    const { backupApi, backupLocationsApi, processApi, secretsApi } = await import("@mileniumhq/paperapi");
    const server = await addServer(spec.name, spec.id, `${spec.id}-server`);
    const proc = `${server.id}-${spec.id}-server`;
    const online = (label: string, timeout = 300_000) => until(async () => {
        const s = await server.state();
        if (s.serverStatus === "offline") throw new Error(`${spec.name} stopped before it was ready`);
        return s.serverStatus === "online";
    }, label, timeout);
    const offline = async (label: string) => {
        await until(async () => !(await processApi.exists(proc)), `${label}: process exit`, 60_000);
        await until(async () => (await server.state()).serverStatus === "offline", `${label}: offline state`);
    };
    const said = async (text: RegExp, label: string) => until(async () => (await server.console()).some((line) => text.test(line)), label, 20_000);

    // an install already on this computer saves the download: SteamCMD then only checks it
    const seed = process.env.SMOKE_INSTALL;
    if (seed) fs.cpSync(seed, path.join(server.directory, "install"), { recursive: true, mode: fs.constants.COPYFILE_FICLONE, verbatimSymlinks: true });
    let shown = -1;
    const progress = setInterval(() => void server.state().then((s) => {
        const p = s.installProgress;
        if (p && p.percent !== shown && p.percent % 10 === 0) { shown = p.percent; console.log(`install: ${p.stage} ${p.percent}%`); }
    }, () => {}), 2_000);
    try { await server.call(ids.install); } finally { clearInterval(progress); }
    const info = await server.call<{ build: string; downloaded: boolean }>(ids.info);
    assert(info.build && info.downloaded, "The install reported no build");
    console.log(`install: app ${spec.appId}${spec.branch ? ` branch ${spec.branch}` : ""}, build ${info.build}; host ${process.platform}/${process.arch}`);
    const latest = await server.call<{ installed: string; latest: string; updateAvailable: boolean }>(ids.latest);
    assert(latest.installed === info.build && latest.latest === info.build && !latest.updateAvailable, `A fresh install is not Steam's newest build: ${JSON.stringify(latest)}`);
    console.log(`update check: Steam's newest${spec.branch ? ` ${spec.branch}` : ""} build is ${latest.latest}; none available`);

    // a port in use moves the server to another, which the launch then uses
    const blocker = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => blocker.listen(0, "0.0.0.0", resolve));
    const occupied = (blocker.address() as net.AddressInfo).port;
    try {
        if (spec.rconReadsTls) {
            let refused = false;
            try { await server.call("write-game-options", { patch: { rconPassword: "abcdefghijkl" } }); } catch (err) { refused = /longer or shorter/.test(String(err)); }
            assert(refused, "A 12-character RCON password was accepted");
        }
        await server.call("write-game-options", { patch: { hostname: "Paperboard smoke", password: "wire-secret", port: occupied } });
        assert((await secretsApi.get(`${server.id}-${spec.id}-join-password`, PANEL)).value === "wire-secret", "The join password did not reach the vault");
        await server.call("start-server");
        await online("first start");
        const up = await server.state();
        assert(Number(up.serverPort) !== occupied, "The occupied port was not relocated");
        assert(up.maxPlayers && up.serverLevel, `No player cap or map after the start: ${up.maxPlayers}, ${up.serverLevel}`);
        console.log(`start: ONLINE on ${up.serverPort} (occupied ${occupied} relocated), map ${up.serverLevel}, ${up.maxPlayers} players max, version ${up.serverVersion}`);
        const secrets = path.join(server.directory, "install", spec.gameDir, "cfg", "paperboard_secrets.cfg");
        assert(!fs.existsSync(secrets), "The start's passwords file is still there once the server is up");
        assert(!JSON.stringify(await server.console()).includes("wire-secret"), "The join password is in the console");
        for (const file of game.kept) {
            assert(fs.lstatSync(path.join(server.directory, "install", spec.gameDir, file)).isSymbolicLink(), `${file} in the install is not a link`);
            assert(fs.statSync(path.join(server.directory, file)).isFile(), `${file} is not in the server folder`);
        }
        for (const folder of spec.keeps?.folders ?? []) assert(fs.lstatSync(path.join(server.directory, "install", spec.gameDir, folder)).isSymbolicLink(), `${folder} in the install is not a link`);
        if (game.kept.length) console.log(`kept data: ${[...game.kept, ...(spec.keeps?.folders ?? [])].join(", ")} live in the server folder, linked into the install`);

        await server.call("run-command", { command: game.bot });
        await until(async () => (await server.call<{ online: { steamId: string }[] }>(ids.players)).online.some((p) => p.steamId === "BOT"), "a bot in the roster", 20_000);
        const bot = (await server.call<{ online: { steamId: string; userId: number; name: string }[] }>(ids.players)).online.find((p) => p.steamId === "BOT")!;
        assert((await server.state()).onlinePlayers.length === 0, "A bot was counted as a player");
        await server.call(ids.kick, { userId: bot.userId });
        await until(async () => !(await server.call<{ online: { userId: number }[] }>(ids.players)).online.some((p) => p.userId === bot.userId), "the bot kicked", 20_000);
        console.log(`roster: bot ${bot.name} joined through the game log, kicked by user id, not counted as a player`);

        await server.call("say-chat", { message: "hello from Paperboard" });
        await until(async () => (await server.state()).chatMessages.some((m) => m.event === "server" && m.content === "hello from Paperboard"), "the console's chat line", 20_000);
        console.log("chat: say delivered and read back from the game log");

        await server.call(ids.ban, { steamId: game.steamId });
        await server.call("run-command", { command: "listid" });
        await said(new RegExp(`${game.steamId.replace(/[[\]]/g, "\\$&")} : permanent`), "the ban in the server's own list");
        await server.call(ids.unban, { steamId: game.steamId });
        await server.call("run-command", { command: "listid" });
        await said(/ID filter list: empty/, "the ban gone from the server's own list");
        console.log(`bans: ${game.steamId} banned and unbanned on the running server`);

        await server.call("write-game-options", { patch: { [game.live.option]: game.live.value } });
        await server.call("run-command", { command: game.live.cvar });
        await said(new RegExp(`"${game.live.cvar}" = "${game.live.value ? 1 : 0}"`), `${game.live.cvar} set on the running server`);
        console.log(`options: ${game.live.cvar} applied at once (a ${game.live.cvar.length}-character command)`);

        await server.call(ids.changeMap, { map: game.otherMap });
        await until(async () => (await server.state()).serverLevel === game.otherMap, "the map change", 60_000);
        console.log(`map: changed to ${game.otherMap} while running`);

        await backupLocationsApi.setForPanel(PANEL, "local", undefined, server.id);
        const api = backupApi.forSource(PANEL, server.id);
        const record = await api.create({ label: `${spec.name} smoke` });
        await online("restart after backup");
        console.log(`backup: ${record.size} bytes, SHA-256 ${record.sha256}; ${spec.offlineBackups ? "stopped for the copy and restarted" : "copied while running"}`);
        fs.writeFileSync(path.join(server.directory, "after-backup.txt"), "must disappear on restore");
        await api.restore(record.id);
        await online("restart after restore");
        assert(!fs.existsSync(path.join(server.directory, "after-backup.txt")), "Restore did not replace the server's files");
        assert(fs.existsSync(path.join(server.directory, "install", spec.binaries.linux!.executable)), "Restore removed the install, which backups leave out");
        assert((await secretsApi.get(`${server.id}-${spec.id}-join-password`, PANEL)).value === "wire-secret", "Restore lost the vault's join password");
        console.log("restore: files replaced, install kept, vault kept, restarted ONLINE");

        await server.call("stop-server");
        await offline("stop");
        assert(!fs.existsSync(secrets), "The start's passwords file was left behind");
        console.log("stop: quit over RCON; process absent; state OFFLINE");
    } finally { blocker.close(); }
});
