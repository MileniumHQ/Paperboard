/**
 * Operator-only: downloads the real Rust dedicated server from Steam and
 * drives it through the real daemon. Never part of the gate (gigabytes, and
 * Steam's availability is no regression test).
 *
 *   bun panels/dev.paperboard.gameserver/scripts/rust-smoke.ts
 *
 * SMOKE_INSTALL names a folder SteamCMD already installed the server into, to
 * start from instead of downloading.
 */
import dgram from "node:dgram";
import fs from "node:fs";
import path from "node:path";
import { RUST_APP_ID } from "../src/games/rust";
import type { RustBan } from "../src/games/rust/roster";
import type { RustInfo } from "../src/games/rust/webrcon";
import { assert, PANEL, until, withScenarioDaemon } from "./scenarioDaemon";

await withScenarioDaemon("rust-real", async ({ addServer }) => {
    const { backupApi, backupLocationsApi, processApi, secretsApi } = await import("@mileniumhq/paperapi");
    const server = await addServer("Rust", "rust", "rust-server");
    const proc = `${server.id}-rust-server`;
    const online = (label: string, timeout = 900_000) => until(async () => {
        const s = await server.state();
        if (s.serverStatus === "offline") throw new Error("Rust stopped before it was ready");
        return s.serverStatus === "online";
    }, label, timeout);
    const offline = async (label: string) => {
        await until(async () => !(await processApi.exists(proc)), `${label}: process exit`, 130_000);
        await until(async () => (await server.state()).serverStatus === "offline", `${label}: offline state`);
    };
    const said = async (text: RegExp, label: string) => until(async () => (await server.console()).some((line) => text.test(line)), label, 20_000);
    const refused = async (patch: Record<string, unknown>, why: RegExp, label: string) => {
        let caught = "";
        try { await server.call("write-game-options", { patch }); } catch (err) { caught = String(err); }
        assert(why.test(caught), `${label} was not refused: ${caught || "it was accepted"}`);
    };

    const seed = process.env.SMOKE_INSTALL;
    if (seed) fs.cpSync(seed, path.join(server.directory, "install"), { recursive: true, mode: fs.constants.COPYFILE_FICLONE, verbatimSymlinks: true });
    await server.call("rust-install");
    const installed = await server.call<{ build: string; downloaded: boolean }>("rust-info");
    assert(installed.build && installed.downloaded, "The install reported no build");
    console.log(`install: app ${RUST_APP_ID}, build ${installed.build}; host ${process.platform}/${process.arch}`);
    const latest = await server.call<{ installed: string; latest: string; updateAvailable: boolean }>("rust-latest");
    assert(latest.latest === installed.build && !latest.updateAvailable, `A fresh install is not Steam's newest build: ${JSON.stringify(latest)}`);
    console.log(`update check: Steam's newest build is ${latest.latest}; none available`);

    // a port in use moves the server to another, which the launch then uses
    const blocker = dgram.createSocket("udp4");
    await new Promise<void>((resolve) => blocker.bind(0, "0.0.0.0", resolve));
    const occupied = blocker.address().port;
    try {
        const options = await server.call<Record<string, unknown>>("read-game-options");
        assert(typeof options.seed === "number" && options.seed > 0, "A new server was given no map seed of its own");
        await refused({ rconPassword: "short" }, /8 to 64/, "A 5-character RCON password");
        await refused({ hostname: 'A "quoted" name' }, /can't hold quotes/, "A server name with quotes");
        await refused({ description: "+server.seed 1" }, /can't begin with \+ or -/, "A description that reads as a setting");
        // a small map, so the first start takes a minute and not twenty
        await server.call("write-game-options", { patch: { hostname: "Paperboard smoke", description: "A smoke test; nothing to see", worldsize: 1000, seed: 12345, port: occupied } });
        await server.call("start-server");
        await online("first start");
        const up = await server.state();
        assert(Number(up.serverPort) !== occupied, "The occupied port was not relocated");
        assert(up.maxPlayers === 50, `The player cap after the start is ${up.maxPlayers}`);
        const password = (await secretsApi.get(`${server.id}-rust-rcon-password`, PANEL)).value;
        assert(password && password.length >= 8, "No RCON password was made");
        const lines = await server.console();
        assert(lines.some((line) => line.startsWith("Command Line:")), "The server's command line is not in the console, so its redaction was not checked");
        assert(!JSON.stringify(lines).includes(password), "The RCON password is in the console");
        assert(lines.some((line) => /Generating procedural map of size 1000 with seed 12345/.test(line)), "The map was not made from the saved size and seed");
        assert(fs.lstatSync(path.join(server.directory, "install", "server")).isSymbolicLink(), "The install's server folder is not a link");
        assert(fs.readdirSync(path.join(server.directory, "server", "paperboard")).some((name) => name.endsWith(".map")), "The map is not in the server folder");
        console.log(`start: ONLINE on ${up.serverPort} (occupied ${occupied} relocated), version ${up.serverVersion}, ${up.maxPlayers} players max; map and saves in the server folder; password out of the console`);

        const health = await server.call<RustInfo>("rust-metrics");
        assert(health.Hostname === "Paperboard smoke" && health.MaxPlayers === 50 && health.Framerate > 0, `serverinfo answered ${JSON.stringify(health)}`);
        console.log(`health: ${Math.round(health.Framerate)} fps, ${health.EntityCount} entities, ${health.Players}/${health.MaxPlayers} players`);

        await server.call("run-command", { command: "status" });
        await said(/^hostname: Paperboard smoke/, "the status reply in the console");
        let unknown = "";
        try { await server.call("run-command", { command: "nosuchcommand" }); } catch (err) { unknown = String(err); }
        assert(/gave no answer to "nosuchcommand"/.test(unknown), `An unknown command did not fail visibly: ${unknown || "it was accepted"}`);
        let quit = "";
        try { await server.call("run-command", { command: "quit" }); } catch (err) { quit = String(err); }
        assert(/use Options, Stop and Restart/.test(quit), "quit was let through the console");
        console.log("console: status answered into the console; an unknown command and quit refused out loud");

        await server.call("say-chat", { message: "hello from Paperboard" });
        await until(async () => (await server.state()).chatMessages.some((m) => m.event === "server" && m.content === "hello from Paperboard"), "the console's chat line", 20_000);
        console.log("chat: say delivered and pushed back by the server");

        const id = "76561198000000001";
        await server.call("rust-ban", { steamId: id });
        let roster = await server.call<{ bans: RustBan[] }>("rust-players");
        assert(roster.bans.some((ban) => ban.steamId === id), "The ban is not in the running server's list");
        assert(fs.readFileSync(path.join(server.directory, "server", "paperboard", "cfg", "bans.cfg"), "utf8").includes(id), "The ban was not written to bans.cfg");
        let twice = "";
        try { await server.call("rust-kick", { steamId: id }); } catch (err) { twice = String(err); }
        assert(/not online/.test(twice), "Kicking someone who is not online did not fail");
        console.log(`bans: ${id} banned on the running server and written to bans.cfg`);

        await server.call("write-game-options", { patch: { maxplayers: 12 } });
        assert((await server.call<RustInfo>("rust-metrics")).MaxPlayers === 12, "The player cap did not change on the running server");
        console.log("options: maximum players applied at once");

        await server.call("save-world");
        console.log("save: Rust confirmed it and the save file changed");

        await backupLocationsApi.setForPanel(PANEL, "local", undefined, server.id);
        const api = backupApi.forSource(PANEL, server.id);
        const record = await api.create({ label: "Rust smoke" });
        await online("restart after backup");
        console.log(`backup: ${record.size} bytes, SHA-256 ${record.sha256}; stopped for the copy and restarted`);
        await server.call("rust-unban", { steamId: id });
        fs.writeFileSync(path.join(server.directory, "after-backup.txt"), "must disappear on restore");
        await api.restore(record.id);
        await online("restart after restore");
        assert(!fs.existsSync(path.join(server.directory, "after-backup.txt")), "Restore did not replace the server's files");
        assert(fs.existsSync(path.join(server.directory, "install", "RustDedicated")), "Restore removed the install, which backups leave out");
        roster = await server.call<{ bans: RustBan[] }>("rust-players");
        assert(roster.bans.some((ban) => ban.steamId === id), "Restore did not bring back the ban list of the backup");
        const generated = (await server.console()).filter((line) => /Generating procedural map/.test(line)).length;
        console.log(`restore: files replaced, install kept, the backup's ban list back, restarted ONLINE (${generated} map generation${generated === 1 ? "" : "s"} in this console)`);

        await server.call("stop-server");
        await offline("stop");
        const stopped = await server.call<{ bans: RustBan[] }>("rust-players");
        assert(stopped.bans.some((ban) => ban.steamId === id), "The ban list is not readable while the server is stopped");
        let needsServer = "";
        try { await server.call("rust-unban", { steamId: id }); } catch (err) { needsServer = String(err); }
        assert(/Start the server to ban or unban/.test(needsServer), "Unbanning a stopped server did not say it needs the server");
        console.log("stop: saved and quit over the remote console; process absent; state OFFLINE; bans readable while stopped");

        await server.call("write-game-options", { patch: { gamemode: "hardcore" } });
        await server.call("start-server");
        await online("start in hardcore");
        await said(/Game created! type was : assets\/prefabs\/gamemodes\/hardcore\.prefab/, "the hardcore game mode");
        await server.call("stop-server");
        await offline("second stop");
        console.log("game mode: hardcore started and stopped");
    } finally { blocker.close(); }
});
