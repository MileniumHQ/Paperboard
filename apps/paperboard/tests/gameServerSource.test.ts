import { test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PanelServicesManager } from "../papercrane/panelServices";
import { PaperCraneAuth } from "../papercrane/auth";
import { setupWebSocketServer } from "../papercrane/ws";
import { initPaperApi, closeTransport, actionsApi, config, fileApi, processApi, secretsApi } from "@mileniumhq/paperapi";
import { serverStateOf } from "../../../panels/dev.paperboard.gameserver/src/servers";
import { until } from "./fixtures/gameServerTerraria";

const PANEL = "dev.paperboard.gameserver";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

// A Team Fortress 2 stand-in compiled to a real executable, run as the real
// server is: through stdbuf, from the install, with ~/.steam/sdk64 in its HOME.
// It reads the cfgs the way srcds execs them, answers RCON on the game port
// with the password from paperboard_secrets.cfg, prints HL log lines for joins,
// leaves, chat and maps, and echoes every RCON command to its console as
// sv_rcon_log does. control.jsonl beside it makes players join and talk;
// requests.log records what it was asked.
const FAKE = `import fs from "node:fs"; import net from "node:net"; import path from "node:path";
const arg = (flag) => process.argv[process.argv.indexOf(flag) + 1];
const cfg = (name) => fs.readFileSync(path.join("tf/cfg", name), "utf8");
const cvar = (text, name) => new RegExp("^" + name + " \\"?([^\\"\\\\n]*)", "m").exec(text)?.[1] ?? "";
const log = (line) => fs.appendFileSync("requests.log", line + "\\n");
const L = (body) => console.log("L 10/31/2026 - 09:18:21: " + body);
if (!fs.existsSync(path.join(process.env.HOME, ".steam/sdk64/steamclient.so"))) { console.log("[S_API FAIL] SteamAPI_Init() failed; unable to locate a running instance of Steam, or a local steamclient.so."); process.exit(1); }
const secrets = cfg(arg("+exec"));
const rcon = cvar(secrets, "rcon_password");
const server = cfg("server.cfg");
let hostname = cvar(server, "hostname");
let map = arg("+map");
const max = Number(arg("+maxplayers"));
log("start " + process.argv.slice(2).join(" ") + " | join=" + cvar(secrets, "sv_password") + " quota=" + cvar(server, "tf_bot_quota") + " bans=" + cfg("banned_user.cfg").trim().split("\\n").filter((l) => l.startsWith("banid")).join(","));
const players = new Map([[2, { name: "Mega Baboon", steamId: "BOT" }], [3, { name: "Kill Me", steamId: "BOT" }]]);
let next = 4;
const leave = (id, reason) => { const p = players.get(id); players.delete(id); L('"' + p.name + "<" + id + "><" + p.steamId + '><Red>" disconnected (reason "' + reason + '")'); };
function run(command) {
  log("rcon " + command);
  console.log('rcon from "127.0.0.1:40000": command "' + command + '"');
  const [name, ...rest] = command.split(" ");
  if (name === "status") return "hostname: " + hostname + "\\nversion : 11191711/24 11191711 secure\\nmap     : " + map + " at: 0 x, 0 y, 0 z\\nplayers : " + [...players.values()].filter((p) => p.steamId !== "BOT").length + " humans, " + [...players.values()].filter((p) => p.steamId === "BOT").length + " bots (" + max + " max)\\n# userid name                uniqueid            connected ping loss state  adr\\n" + [...players].map(([id, p]) => "#      " + id + ' "' + p.name + '"       ' + (p.steamId === "BOT" ? "BOT                                     active" : p.steamId + "     00:12   45    0 active 127.0.0.1:27005")).join("\\n") + "\\n";
  if (name === "say") { L('"Console<0><Console><Console>" say "' + rest.join(" ") + '"'); return ""; }
  if (name === "kickid") { const id = Number(rest[0]); if (!players.has(id)) return 'userid "' + id + '" not found\\n'; leave(id, rest.slice(1).join(" ")); return ""; }
  if (name === "banid") { for (const [id, p] of players) if (p.steamId === rest[1]) leave(id, "Banned by server"); return ""; }
  if (name === "changelevel") { map = rest[0]; L('Started map "' + map + '" (CRC "a70bdd508912c2098fdcdfc9e2a53147")'); return ""; }
  if (name === "hostname") hostname = rest.join(" ").replace(/^"|"$/g, "");
  return "";
}
const packet = (id, type, body) => { const b = Buffer.from(body, "utf8"); const out = Buffer.alloc(14 + b.length); out.writeInt32LE(10 + b.length, 0); out.writeInt32LE(id, 4); out.writeInt32LE(type, 8); b.copy(out, 12); return out; };
const sockets = new Set();
const rconServer = net.createServer((socket) => {
  sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
  let buffer = Buffer.alloc(0); let authed = false;
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readInt32LE(0)) {
      const size = buffer.readInt32LE(0); const id = buffer.readInt32LE(4); const type = buffer.readInt32LE(8);
      const body = buffer.subarray(12, 4 + size - 2).toString("utf8"); buffer = buffer.subarray(4 + size);
      if (type === 3) { authed = body === rcon; socket.write(packet(id, 0, "")); socket.write(packet(authed ? id : -1, 2, "")); if (!authed) socket.destroy(); }
      else if (type === 2 && authed) {
        if (body === "quit") { log("rcon quit"); console.log("Shutting down"); for (const s of sockets) s.destroy(); rconServer.close(); setTimeout(() => process.exit(0), 50); return; }
        const reply = run(body); if (reply) console.log(reply.trimEnd()); socket.write(packet(id, 0, reply));
      } else if (type === 0) { socket.write(packet(id, 0, "")); socket.write(packet(id, 0, "\\u0000\\u0001\\u0000\\u0000")); }
    }
  });
});
console.log("Using Breakpad minidump system");
setTimeout(() => {
  L('Started map "' + map + '" (CRC "a70bdd508912c2098fdcdfc9e2a53147")');
  for (const [id, p] of players) { L('"' + p.name + "<" + id + '><BOT><>" connected, address "none"'); L('"<' + id + '><BOT><>" entered the game'); }
  rconServer.listen(Number(arg("-port")), arg("-ip"));
}, 300);
let handled = 0;
setInterval(() => {
  if (!fs.existsSync("control.jsonl")) return;
  const lines = fs.readFileSync("control.jsonl", "utf8").split("\\n").filter(Boolean);
  for (const line of lines.slice(handled)) {
    const c = JSON.parse(line);
    if (c.join) { const id = next++; players.set(id, c.join); L('"' + c.join.name + "<" + id + "><" + c.join.steamId + '><>" connected, address "127.0.0.1:27005"'); L('"' + c.join.name + "<" + id + "><" + c.join.steamId + '><>" entered the game'); }
    if (c.say) { const [id, p] = [...players].find(([, p]) => p.name === c.say.name); L('"' + p.name + "<" + id + "><" + p.steamId + '><Red>" ' + (c.say.team ? "say_team" : "say") + ' "' + c.say.text + '"'); }
  }
  handled = lines.length;
}, 50);
`;

async function freePort(): Promise<number> {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1"); await once(probe, "listening");
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
}

test("Team Fortress 2 through daemon: RCON control with a vaulted password, cfgs from options, log-read players and chat, bans that work offline, map changes and a graceful quit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-wire-"));
    const previousDir = process.env.PAPERBOARD_DIR;
    process.env.PAPERBOARD_DIR = root;
    const bun = process.execPath;
    const launcher = path.join(root, "supervisor");
    const launcherSource = path.join(root, "supervisor.ts");
    fs.writeFileSync(launcherSource, `import { runSupervisor } from ${JSON.stringify(path.resolve(import.meta.dir, "../papercrane/supervisor.ts"))}; if (process.argv.includes("--panel-service")) await import(process.argv.at(-1)!); else await runSupervisor(process.argv.at(-1)!);`);
    const build = Bun.spawnSync([bun, "build", launcherSource, "--compile", "--outfile", launcher]);
    if (build.exitCode) throw new Error(build.stderr.toString());
    process.execPath = launcher;
    const services = new PanelServicesManager(root);
    const engine = new PaperCraneEngine(root, services);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    setupWebSocketServer(wss, engine, auth); await once(wss, "listening");
    let proc = "";
    try {
        await initPaperApi({ port: (wss.address() as any).port, token: auth.issuePanelToken(PANEL), computerId: "local", panelId: PANEL });
        const panelDir = path.join(root, "panels", PANEL); fs.mkdirSync(panelDir, { recursive: true });
        fs.writeFileSync(path.join(panelDir, "manifest.json"), JSON.stringify({ id: PANEL, version: "0.5.0", service: "service.mjs" }));
        const bundled = await Bun.build({ entrypoints: [path.resolve(import.meta.dir, "../../../panels/dev.paperboard.gameserver/src/service.ts")], target: "bun", format: "esm" });
        if (!bundled.success) throw new AggregateError(bundled.logs, "Service build failed");
        await Bun.write(path.join(panelDir, "service.mjs"), await bundled.outputs[0]!.text());
        await config.set({ version: 2, serversDirectory: "servers-0123456789ab", servers: [] }, PANEL);
        services.init((wss.address() as any).port, undefined, auth); await services.waitUntilReady(PANEL);
        await actionsApi.call(PANEL, "add-server", { name: "Team Fortress 2", game: "team-fortress-2" });
        const first = (await config.get<any>(PANEL)).servers[0];
        proc = `${first.id}-team-fortress-2-server`;
        const call = <T = any>(id: string, input?: any) => actionsApi.call<T>(PANEL, `${first.id}/${id}`, input, { timeoutMs: null });
        const state = async () => serverStateOf(await actionsApi.call<any>(PANEL, "list-servers"), first.id);
        const refuses = async (id: string, input: any, pattern: RegExp, message: string) => {
            let refused = false;
            try { await call(id, input); } catch (err) { refused = pattern.test(String(err)); if (!refused) throw err; }
            assert(refused, message);
        };
        const directory = await fileApi.getPath(first.directory, PANEL);

        // what SteamCMD leaves: the server binary, its maps and Steam's app manifest, and its own client library
        const install = path.join(directory, "install");
        for (const dir of ["steamapps", "bin/linux64", "tf/maps"]) fs.mkdirSync(path.join(install, dir), { recursive: true });
        fs.writeFileSync(path.join(root, "fake-srcds.ts"), FAKE);
        const compiled = Bun.spawnSync([bun, "build", path.join(root, "fake-srcds.ts"), "--compile", "--outfile", path.join(install, "srcds_linux64")]);
        if (compiled.exitCode) throw new Error(compiled.stderr.toString());
        for (const map of ["ctf_2fort", "cp_badlands", "background01"]) fs.writeFileSync(path.join(install, "tf/maps", `${map}.bsp`), "VBSP");
        fs.writeFileSync(path.join(install, "steamapps/appmanifest_232250.acf"), `"AppState"\n{\n\t"buildid"\t\t"11191711"\n}\n`);
        const steam = await fileApi.getPath(".steam/steamcmd", PANEL);
        fs.mkdirSync(path.join(steam, "linux64"), { recursive: true });
        fs.writeFileSync(path.join(steam, "steamcmd.sh"), "#!/bin/sh\n", { mode: 0o755 });
        fs.writeFileSync(path.join(steam, "linux64/steamclient.so"), "steamclient");
        const current = await config.get<any>(PANEL); current.servers[0].settings = { configured: true, build: "11191711" }; await config.set(current, PANEL);
        await services.stopService(PANEL); services.startService(PANEL); await services.waitUntilReady(PANEL);

        await refuses("op-player", { player: "Steve" }, /does not support|not registered|Unknown action|not found/i, "A Minecraft action reached Team Fortress 2");
        const port = await freePort();
        await call("write-game-options", { patch: { port, hostname: "Wire TF2", password: "join-secret", tf_bot_quota: 4, internet: false } });
        const serverCfg = fs.readFileSync(path.join(install, "tf/cfg/server.cfg"), "utf8");
        assert(serverCfg.includes('hostname "Wire TF2"') && serverCfg.includes("tf_bot_quota 4") && serverCfg.includes("sv_logecho 1") && serverCfg.includes("exec banned_user.cfg"), `Options did not reach server.cfg:\n${serverCfg}`);
        assert(!serverCfg.includes("join-secret"), "The join password was written to server.cfg");
        assert((await secretsApi.get(`${first.id}-team-fortress-2-join-password`, PANEL)).value === "join-secret", "Join password did not reach the vault");
        assert(!JSON.stringify(await config.get(PANEL)).includes("join-secret"), "Join password leaked into panel settings");
        await refuses("write-game-options", { patch: { hostname: 'Wire"; rcon_password x' } }, /quote|semicolon|;/i, "A console line break-out was let into server.cfg");
        const options = await call<Record<string, unknown>>("read-game-options");
        assert(options.hostname === "Wire TF2" && options.password === true && options.rconPassword === false && options.internet === false, `Options did not read back: ${JSON.stringify(options)}`);

        const maps = await call<string[]>("team-fortress-2-maps");
        assert(JSON.stringify(maps) === JSON.stringify(["cp_badlands", "ctf_2fort"]), `Maps not listed: ${maps}`);
        assert((await call<any>("team-fortress-2-change-map", { map: "cp_badlands" })).now === false, "A stopped server's map change claimed to apply now");
        await refuses("team-fortress-2-change-map", { map: "pl_upward" }, /not installed/, "A missing map was accepted");
        await refuses("team-fortress-2-change-map", { map: "ctf_2fort; quit" }, /map/i, "An unsafe map name was accepted");
        // a ban taken while stopped reaches the server through banned_user.cfg
        await call("team-fortress-2-ban", { steamId: "[U:1:42]" });
        await refuses("team-fortress-2-ban", { steamId: "[U:1:42]; quit" }, /Steam id/, "An unsafe Steam id was accepted");

        await call("start-server");
        await until(async () => { const s = await state(); if (s.serverStatus === "offline") throw new Error("Team Fortress 2 stopped before readiness:\n" + s.serverEntries.map(e => e.content).slice(-25).join("\n")); return s.serverStatus === "online"; }, "Team Fortress 2 readiness", 30_000);
        const rcon = (await secretsApi.get(`${first.id}-team-fortress-2-rcon-password`, PANEL)).value;
        assert(rcon && rcon.length >= 20, "No RCON password was made");
        const requests = () => fs.readFileSync(path.join(install, "requests.log"), "utf8");
        assert(requests().includes(`-ip 0.0.0.0 -port ${port}`) && requests().includes("+maxplayers 24 +sv_lan 1") && requests().includes("+map cp_badlands") && requests().includes("join=join-secret quota=4 bans=banid 0 [U:1:42]"), `Launch did not carry the options, secrets and bans:\n${requests()}`);
        assert(!fs.existsSync(path.join(install, "tf/cfg/paperboard_secrets.cfg")), "The start passwords stayed on disk after the server was ready");
        let online = await state();
        assert(online.maxPlayers === 24 && online.serverLevel === "cp_badlands" && online.onlinePlayers.length === 0, `Server facts not read: ${online.maxPlayers} ${online.serverLevel} ${online.onlinePlayers}`);

        const control = (entry: unknown) => fs.appendFileSync(path.join(install, "control.jsonl"), JSON.stringify(entry) + "\n");
        control({ join: { name: "Scout Main", steamId: "[U:1:7]" } });
        await until(async () => (await state()).onlinePlayers.includes("Scout Main"), "a player joining", 15_000);
        control({ say: { name: "Scout Main", text: "gg", team: true } });
        await until(async () => (await state()).chatMessages.some((m) => m.sender === "Scout Main" && m.content === "(Team) gg"), "team chat");
        await call("say-chat", { message: "Hello mercs" });
        await until(async () => (await state()).chatMessages.some((m) => m.text === "<Server> Hello mercs"), "the server's message in chat");
        await call("run-command", { command: "mp_restartgame 1" });
        await until(async () => requests().includes("rcon mp_restartgame 1"), "a console command over RCON");
        const roster = await call<any>("team-fortress-2-players");
        assert(roster.seen.some((p: any) => p.steamId === "[U:1:7]" && p.name === "Scout Main") && roster.online.filter((p: any) => p.steamId === "BOT").length === 2, `Roster not recorded: ${JSON.stringify(roster)}`);

        // a live option goes over RCON; the new password never reaches the console
        await call("write-game-options", { patch: { hostname: "Live TF2", password: "new-secret" } });
        await until(async () => requests().includes('rcon hostname "Live TF2"') && requests().includes('rcon sv_password "new-secret"'), "live options over RCON");
        await Bun.sleep(300);
        online = await state();
        const consoleText = online.serverEntries.map(e => String(e.content)).join("\n");
        assert(consoleText.includes("[redacted]") && !consoleText.includes("new-secret") && !consoleText.includes("join-secret") && !consoleText.includes(rcon), "A password reached the console");

        // a restarted panel service finds the running server and talks to it again
        await services.stopService(PANEL); services.startService(PANEL); await services.waitUntilReady(PANEL);
        await until(async () => { const s = await state(); return s.serverStatus === "online" && s.maxPlayers === 24 && s.onlinePlayers.includes("Scout Main"); }, "reattach to the running server", 15_000);
        const scout = (await call<any>("team-fortress-2-players")).online.find((p: any) => p.name === "Scout Main");
        await call("team-fortress-2-kick", { userId: scout.userId });
        await until(async () => !(await state()).onlinePlayers.includes("Scout Main"), "the kicked player leaving");
        assert((await state()).chatMessages.some((m) => m.text === "Scout Main left the game"), "The kick did not show in chat");
        await refuses("team-fortress-2-kick", { userId: scout.userId }, /not online/, "A kick for a player who left was accepted");
        await call("team-fortress-2-ban", { steamId: "[U:1:7]" });
        await call("team-fortress-2-unban", { steamId: "[U:1:42]" });
        assert(requests().includes("rcon banid 0 [U:1:7] kick") && requests().includes("rcon removeid [U:1:42]"), `Bans did not reach the server:\n${requests()}`);
        const bans = (await call<any>("team-fortress-2-players")).bans.map((b: any) => b.steamId);
        assert(JSON.stringify(bans) === JSON.stringify(["[U:1:7]"]), `Ban list wrong: ${bans}`);
        assert((await call<any>("team-fortress-2-change-map", { map: "ctf_2fort" })).now === true, "A running server's map change did not apply now");
        await until(async () => (await state()).serverLevel === "ctf_2fort", "the new map");

        await refuses("write-server-file", { path: "install/tf/cfg/server.cfg", content: "rcon_password x" }, /managed by Updates/, "The install was writable through Files");
        await call("stop-server");
        await until(async () => !(await processApi.exists(proc)), "graceful shutdown", 30_000);
        await until(async () => (await state()).serverStatus === "offline", "offline state");
        assert(requests().includes("rcon quit"), "The server was not asked to quit");
        assert(fs.readFileSync(path.join(install, "tf/cfg/banned_user.cfg"), "utf8").includes("banid 0 [U:1:7]"), "The ban list did not reach banned_user.cfg");
        console.log("Source wire: RCON readiness and commands, vaulted passwords, cfgs, log-read players and chat, reattach, kick/ban/unban, map changes, graceful quit");
    } finally {
        await services.stopService(PANEL);
        if (proc) await engine.killProcess(proc, "SIGKILL");
        process.execPath = bun; closeTransport("local");
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>(resolve => wss.close(() => resolve())); auth.dispose();
        if (previousDir === undefined) delete process.env.PAPERBOARD_DIR; else process.env.PAPERBOARD_DIR = previousDir;
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 180_000);
