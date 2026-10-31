import { test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PanelServicesManager } from "../papercrane/panelServices";
import { PaperCraneAuth } from "../papercrane/auth";
import { setupWebSocketServer } from "../papercrane/ws";
import { initPaperApi, closeTransport, actionsApi, backupApi, config, fileApi, processApi, secretsApi } from "@mileniumhq/paperapi";
import { backupServiceFor } from "../papercrane/rpc/backups";
import { LOCAL_DESTINATION_ID } from "../papercrane/backups/config";
import { serverStateOf } from "../../../panels/dev.paperboard.gameserver/src/servers";
import { until } from "./fixtures/gameServerTerraria";

const PANEL = "dev.paperboard.gameserver";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

// A Palworld stand-in run as the real server is: PalServer.sh in the install,
// started by the daemon. It reads PalWorldSettings.ini through install/Pal/Saved
// the way the game does, prints the game's startup lines, writes Level.sav on
// save and shutdown, and answers the REST API only with the admin password
// from the ini. What it was asked is written to requests.log beside it.
const FAKE = `import fs from "node:fs"; import path from "node:path";
const saved = path.join(process.cwd(), "Pal", "Saved");
const ini = fs.readFileSync(path.join(saved, "Config/LinuxServer/PalWorldSettings.ini"), "utf8");
const get = (key) => new RegExp("[(,]" + key + "=(\\"[^\\"]*\\"|[^,)]*)").exec(ini)?.[1]?.replace(/^"|"$/g, "");
const log = (line) => fs.appendFileSync(path.join(process.cwd(), "requests.log"), line + "\\n");
const port = Number(process.argv.find((a) => a.startsWith("-port="))?.slice(6));
const restPort = Number(get("RESTAPIPort"));
if (get("RESTAPIEnabled") !== "True" || !get("AdminPassword")) { console.log("REST API disabled"); process.exit(3); }
log("start port=" + port + " rest=" + restPort + " join=" + get("ServerPassword") + " exp=" + get("ExpRate") + " args=" + process.argv.slice(2).join(" "));
const guid = "715B666D4CE442DCB48153193D5796A1";
fs.mkdirSync(path.join(saved, "Config/LinuxServer"), { recursive: true });
fs.writeFileSync(path.join(saved, "Config/LinuxServer/GameUserSettings.ini"), "[/Script/Pal.PalGameLocalSettings]\\nDedicatedServerName=" + guid + "\\n");
const world = path.join(saved, "SaveGames/0", guid);
fs.mkdirSync(world, { recursive: true });
const write = () => fs.writeFileSync(path.join(world, "Level.sav"), "level " + Date.now() + Math.random());
write();
const auth = "Basic " + Buffer.from("admin:" + get("AdminPassword")).toString("base64");
const playersFile = path.join(process.cwd(), "players.json");
const bans = path.join(saved, "SaveGames/banlist.txt");
console.log("Game version is v1.0.5.102999");
Bun.serve({ port: restPort, hostname: "0.0.0.0", async fetch(req) {
  const url = new URL(req.url);
  if (req.headers.get("authorization") !== auth) return new Response("Unauthorized", { status: 401 });
  if (req.method === "POST" && !req.headers.get("content-length")) return new Response("length required", { status: 411 });
  const body = req.method === "POST" ? await req.json() : null;
  const endpoint = url.pathname.replace("/v1/api/", "");
  console.log("[2026-10-31 01:56:39] [LOG] REST accessed endpoint " + url.pathname + " OK");
  console.log("");
  log(endpoint + " " + JSON.stringify(body));
  if (endpoint === "info") return Response.json({ version: "v1.0.5.102999", servername: get("ServerName"), description: "", worldguid: guid });
  if (endpoint === "metrics") return Response.json({ currentplayernum: 0, serverfps: 60, maxplayernum: Number(get("ServerPlayerMaxNum")), uptime: 1, days: 0 });
  if (endpoint === "players") return Response.json({ players: fs.existsSync(playersFile) ? JSON.parse(fs.readFileSync(playersFile, "utf8")) : [] });
  if (endpoint === "save") { if (!fs.existsSync(path.join(process.cwd(), "no-save"))) write(); return new Response(""); }
  if (endpoint === "announce" || endpoint === "kick") return new Response("");
  // as Palworld writes it: the user id, then a player uid it derives
  if (endpoint === "ban") { fs.appendFileSync(bans, body.userid + ",553A04FD000000000000000000000000\\n"); return new Response(""); }
  if (endpoint === "unban") { fs.writeFileSync(bans, fs.readFileSync(bans, "utf8").split("\\n").filter((l) => l && !l.startsWith(body.userid + ",")).map((l) => l + "\\n").join("")); return new Response(""); }
  if (endpoint === "shutdown") { write(); setTimeout(() => { console.log("REST API stopped"); process.exit(0); }, body.waittime * 1000); return new Response(""); }
  return new Response("Bad Request", { status: 400 });
} });
console.log("REST API started on port " + restPort);
console.log("Running Palworld dedicated server on :" + port);
setInterval(() => {}, 1000);
`;

const DEFAULT_INI = `; sample
[/Script/Pal.PalGameWorldSettings]
OptionSettings=(Difficulty=None,ExpRate=1.000000,ServerPlayerMaxNum=32,ServerName="Default Palworld Server",ServerDescription="",AdminPassword="",ServerPassword="",PublicPort=8211,RCONEnabled=False,RCONPort=25575,RESTAPIEnabled=False,RESTAPIPort=8212,CrossplayPlatforms=(Steam,Xbox,PS5,Mac),LogFormatType=Text,bIsPvP=False)
`;

test("Palworld through daemon: REST control with a vaulted admin password, options in the ini, players, save, stop and an offline backup without the install", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "palworld-wire-"));
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
    const backups = backupServiceFor(engine);
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
        await actionsApi.call(PANEL, "add-server", { name: "Palworld", game: "palworld" });
        const first = (await config.get<any>(PANEL)).servers[0];
        proc = `${first.id}-palworld-server`;
        const call = <T = any>(id: string, input?: any) => actionsApi.call<T>(PANEL, `${first.id}/${id}`, input, { timeoutMs: null });
        const state = async () => serverStateOf(await actionsApi.call<any>(PANEL, "list-servers"), first.id);
        const refuses = async (id: string, input: any, pattern: RegExp, message: string) => {
            let refused = false;
            try { await call(id, input); } catch (err) { refused = pattern.test(String(err)); if (!refused) throw err; }
            assert(refused, message);
        };
        const directory = await fileApi.getPath(first.directory, PANEL);

        // what SteamCMD leaves: the start script, the settings template and Steam's app manifest
        const install = path.join(directory, "install");
        fs.mkdirSync(path.join(install, "steamapps"), { recursive: true });
        fs.writeFileSync(path.join(install, "fake-palworld.ts"), FAKE);
        fs.writeFileSync(path.join(install, "PalServer.sh"), `#!/bin/sh\nexec ${JSON.stringify(bun)} ${JSON.stringify(path.join(install, "fake-palworld.ts"))} "$@"\n`, { mode: 0o755 });
        fs.writeFileSync(path.join(install, "DefaultPalWorldSettings.ini"), DEFAULT_INI);
        fs.mkdirSync(path.join(install, "Pal/Content/Paks"), { recursive: true });
        fs.writeFileSync(path.join(install, "Pal/Content/Paks/Pal-LinuxServer.pak"), crypto.randomBytes(2_000_000));
        fs.writeFileSync(path.join(install, "steamapps/appmanifest_2394010.acf"), `"AppState"\n{\n\t"buildid"\t\t"25247047"\n}\n`);
        const current = await config.get<any>(PANEL); current.servers[0].settings = { configured: true, build: "25247047" }; await config.set(current, PANEL);
        await services.stopService(PANEL); services.startService(PANEL); await services.waitUntilReady(PANEL);

        await refuses("op-player", { player: "Steve" }, /does not support|not registered|Unknown action|not found/i, "A Minecraft action reached Palworld");
        await call("write-game-options", { patch: { ExpRate: 2.5, ServerName: "Wire Palworld", password: "join-secret", community: true } });
        const ini = path.join(directory, "saved/Config/LinuxServer/PalWorldSettings.ini");
        const written = fs.readFileSync(ini, "utf8");
        assert(written.includes("ExpRate=2.500000") && written.includes('ServerName="Wire Palworld"') && written.includes("CrossplayPlatforms=(Steam,Xbox,PS5,Mac)"), `Options did not reach the ini or lost other keys:\n${written}`);
        assert(!written.includes("join-secret"), "The join password was written to a stopped server's ini");
        assert((await secretsApi.get(`${first.id}-palworld-join-password`, PANEL)).value === "join-secret", "Join password did not reach the vault");
        assert(!JSON.stringify(await config.get(PANEL)).includes("join-secret"), "Join password leaked into panel settings");
        await refuses("write-game-options", { patch: { ExpRate: 2.55 } }, /steps of 0\.1/, "A rate off its step was accepted");
        await refuses("write-game-options", { patch: { ServerName: 'Pal"s' } }, /quotes/, "A quote was let into the ini");
        const options = await call<Record<string, unknown>>("read-game-options");
        assert(options.ExpRate === 2.5 && options.password === true && options.adminPassword === false && options.community === true, `Options did not read back: ${JSON.stringify(options)}`);

        await call("start-server");
        await until(async () => { const s = await state(); if (s.serverStatus === "offline") throw new Error("Palworld stopped before readiness:\n" + s.serverEntries.map(e => e.content).slice(-25).join("\n")); return s.serverStatus === "online"; }, "Palworld readiness", 30_000);
        const admin = (await secretsApi.get(`${first.id}-palworld-admin-password`, PANEL)).value;
        assert(admin && admin.length >= 20, "No admin password was made for the REST API");
        const requests = () => fs.readFileSync(path.join(install, "requests.log"), "utf8");
        assert(requests().includes("join=join-secret exp=2.500000") && requests().includes("-publiclobby"), `Launch did not carry the options and secrets:\n${requests()}`);
        const online = await state();
        assert(online.maxPlayers === 32 && online.serverVersion === "1.0.5.102999", `Server facts not read: ${online.maxPlayers} ${online.serverVersion}`);
        assert(!online.serverEntries.some(e => String(e.content).includes(admin)), "The admin password reached the console");
        await refuses("read-server-file", { path: "saved/Config/LinuxServer/PalWorldSettings.ini" }, /holds the admin password/, "The running server's ini was readable");
        await refuses("run-command", { command: "ShowPlayers" }, /does not support action "run-command"/, "A console command was accepted");

        fs.writeFileSync(path.join(install, "players.json"), JSON.stringify([{ name: "Pal Tamer", accountName: "tamer", playerId: "AF00", userId: "steam_76561190000000001", ip: "10.0.0.2", ping: 12.5, level: 7 }]));
        await until(async () => (await state()).onlinePlayers.includes("Pal Tamer"), "player poll", 15_000);
        const polled = (await state()).serverEntries;
        assert(polled.some(e => String(e.content).includes("Running Palworld")) && !polled.some(e => String(e.content).includes("REST accessed endpoint") || !String(e.content).trim()), "REST call lines or their blank lines reached the console");
        const roster = await call<any>("palworld-players");
        assert(roster.seen[0]?.userId === "steam_76561190000000001" && roster.online[0]?.level === 7, `Roster not recorded: ${JSON.stringify(roster)}`);
        // a restarted panel service finds the running server and talks to it again
        await services.stopService(PANEL); services.startService(PANEL); await services.waitUntilReady(PANEL);
        await until(async () => { const s = await state(); return s.serverStatus === "online" && s.maxPlayers === 32 && s.onlinePlayers.includes("Pal Tamer"); }, "reattach to the running server", 15_000);
        await call("palworld-kick", { userId: "steam_76561190000000001" });
        await call("palworld-ban", { userId: "steam_76561190000000001" });
        assert((await call<any>("palworld-players")).bans.includes("steam_76561190000000001"), "Ban not on the ban list");
        await call("palworld-unban", { userId: "steam_76561190000000001" });
        assert(!(await call<any>("palworld-players")).bans.includes("steam_76561190000000001"), "Unban left the player on the ban list");
        await refuses("palworld-kick", { userId: "../etc" }, /user id/, "An unsafe user id was accepted");
        await call("say-chat", { message: "Hello Pals" });
        assert(requests().includes('kick {"userid":"steam_76561190000000001"}') && requests().includes('announce {"message":"Hello Pals"}'), `REST calls not made:\n${requests()}`);

        await call("save-world");
        fs.writeFileSync(path.join(install, "no-save"), "");
        await refuses("save-world", undefined, /to write Level\.sav/, "A save answered without a changed Level.sav was accepted");
        fs.unlinkSync(path.join(install, "no-save"));

        // an online backup stops the server, copies without the install, and starts it again
        const key = backups.sources.resolve(PANEL, first.id); await backups.setPanelDestination(key, LOCAL_DESTINATION_ID);
        const api = backupApi.forSource(PANEL, first.id);
        const record = await api.create({ label: "Palworld smoke" });
        assert(record.size < 1_000_000, `The backup carried the game install: ${record.size} bytes`);
        await until(async () => (await state()).serverStatus === "online", "restart after backup", 30_000);
        assert(requests().includes("announce") && requests().includes("shutdown {\"waittime\":1"), "Backup did not announce and shut down through REST");

        await call("stop-server");
        await until(async () => !(await processApi.exists(proc)), "graceful shutdown", 30_000);
        await until(async () => (await state()).serverStatus === "offline", "offline state");
        const stopped = await call<any>("read-server-file", { path: "saved/Config/LinuxServer/PalWorldSettings.ini" });
        const text = JSON.stringify(stopped);
        assert(text.includes("Wire Palworld") && !text.includes(admin) && !text.includes("join-secret"), "A stopped server's ini showed its passwords");
        await refuses("palworld-ban", { userId: "steam_76561190000000002" }, /Start the server to ban/, "A stopped server took a ban Palworld would have to write");
        await refuses("write-server-file", { path: "install/PalServer.sh", content: "rm -rf /" }, /managed by Versions/, "The install was writable through Files");
        console.log("Palworld wire: REST readiness, vaulted admin password, ini options, players, kick/ban/unban, announce, save proof, backup without install, graceful stop");
    } finally {
        await services.stopService(PANEL);
        if (proc) await engine.killProcess(proc, "SIGKILL");
        process.execPath = bun; backups.dispose(); closeTransport("local");
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>(resolve => wss.close(() => resolve())); auth.dispose();
        if (previousDir === undefined) delete process.env.PAPERBOARD_DIR; else process.env.PAPERBOARD_DIR = previousDir;
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 180_000);
