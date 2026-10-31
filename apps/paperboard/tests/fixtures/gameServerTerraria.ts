import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "../../papercrane/engine";
import { PanelServicesManager } from "../../papercrane/panelServices";
import { PaperCraneAuth } from "../../papercrane/auth";
import { setupWebSocketServer } from "../../papercrane/ws";
import { initPaperApi, closeTransport, actionsApi, backupApi, config, fileApi, processApi, secretsApi, WIDGET_CHOICES_ACTION } from "@mileniumhq/paperapi";
import { backupServiceFor } from "../../papercrane/rpc/backups";
import { getNetworkIp } from "../../papercrane/util";
import { LOCAL_DESTINATION_ID } from "../../papercrane/backups/config";
import { serverStateOf } from "../../../../panels/dev.paperboard.gameserver/src/servers";
import { releaseFor, entrypoint } from "../../../../panels/dev.paperboard.gameserver/src/games/terraria/catalog";
const PANEL = "dev.paperboard.gameserver";
export async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (!(await check())) { if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`); await Bun.sleep(25); }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function runTerrariaScenario(real: boolean): Promise<void> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), real ? "terraria-real-" : "terraria-wire-"));
    const previousDir = process.env.PAPERBOARD_DIR;
    process.env.PAPERBOARD_DIR = root;
    const bun = process.execPath;
    const launcher = path.join(root, "supervisor");
    const launcherSource = path.join(root, "supervisor.ts");
    fs.writeFileSync(launcherSource, `import { runSupervisor } from ${JSON.stringify(path.resolve(import.meta.dir, "../../papercrane/supervisor.ts"))}; if (process.argv.includes("--panel-service")) await import(process.argv.at(-1)!); else await runSupervisor(process.argv.at(-1)!);`);
    const build = Bun.spawnSync([bun, "build", launcherSource, "--compile", "--outfile", launcher]);
    if (build.exitCode) throw new Error(build.stderr.toString());
    process.execPath = launcher;
    const services = new PanelServicesManager(root);
    const engine = new PaperCraneEngine(root, services);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    setupWebSocketServer(wss, engine, auth); await once(wss, "listening");
    const backups = backupServiceFor(engine);
    const processes: string[] = [];
    let second: any;
    const blocker = net.createServer(socket => socket.end());
    try {
        await initPaperApi({ port: (wss.address() as any).port, token: auth.issuePanelToken(PANEL), computerId: "local", panelId: PANEL });
        const panelDir = path.join(root, "panels", PANEL); fs.mkdirSync(panelDir, { recursive: true });
        fs.writeFileSync(path.join(panelDir, "manifest.json"), JSON.stringify({ id: PANEL, version: "0.5.0", service: "service.mjs" }));
        const bundled = await Bun.build({ entrypoints: [path.resolve(import.meta.dir, "../../../../panels/dev.paperboard.gameserver/src/service.ts")], target: "bun", format: "esm" });
        if (!bundled.success) throw new AggregateError(bundled.logs, "Service build failed");
        let source = await bundled.outputs[0]!.text();
        if (!real) {
            assert(source.includes('120000, "save completion'), "Save deadline test seam did not match compiled service");
            source = source.replace("timeoutMs: 300000", "timeoutMs: 500").replace('120000, "save completion', '300, "save completion');
        }
        await Bun.write(path.join(panelDir, "service.mjs"), source);
        await config.set({ version: 2, serversDirectory: "servers-0123456789ab", servers: [] }, PANEL);
        services.init((wss.address() as any).port, undefined, auth); await services.waitUntilReady(PANEL);
        await actionsApi.call(PANEL, "add-server", { name: "Terraria", game: "terraria" });
        const saved = await config.get<any>(PANEL); const first = saved.servers[0];
        const call = <T = any>(id: string, input?: any) => actionsApi.call<T>(PANEL, `${first.id}/${id}`, input, { timeoutMs: null });
        const state = async () => serverStateOf(await actionsApi.call<any>(PANEL, "list-servers"), first.id);
        const directory = await fileApi.getPath(first.directory, PANEL);
        const version = "1.4.5.8"; const release = releaseFor(version);
        processes.push(`${first.id}-terraria-server`);
        if (real) await call("terraria-install", { version });
        else {
            const target = path.join(directory, "install", release.directory); const executable = path.join(target, entrypoint(process.platform)); fs.mkdirSync(path.dirname(executable), { recursive: true });
            const fixture = path.join(root, "tiny-server.ts");
            fs.writeFileSync(fixture, `import fs from 'node:fs'; import net from 'node:net'; import path from 'node:path';
const config = Object.fromEntries(fs.readFileSync(process.argv[process.argv.indexOf('-config') + 1], 'utf8').split('\\n').filter(x => x.includes('=')).map(x => [x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
fs.mkdirSync(path.dirname(config.world), { recursive: true }); if (!fs.existsSync(config.world)) fs.writeFileSync(config.world, 'created world');
const server = net.createServer(socket => socket.end()).listen(Number(config.port), '0.0.0.0', () => { if (!fs.existsSync(path.join(path.dirname(config.world), 'silent'))) console.log('Server started'); });
for await (const line of console) { fs.appendFileSync(path.join(path.dirname(config.world), 'commands.txt'), line + '\\n'); if (line === 'save' || line === 'exit') { if (line === 'exit' || !fs.existsSync(path.join(path.dirname(config.world), 'no-save'))) fs.writeFileSync(config.world, fs.readFileSync(config.world)); console.log('Backing up world file'); if (line === 'save') process.stdout.write(': '); } if (line === 'exit') { server.close(); process.exit(0); } else if (line !== 'save') console.log(line); }
`);
            const compiled = Bun.spawnSync([bun, "build", fixture, "--compile", "--outfile", executable]); if (compiled.exitCode) throw new Error(compiled.stderr.toString());
            fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify({ version, source: release.url, sha256: release.sha256, os: process.platform, arch: process.arch }));
            // Existing immutable artifact: the real install path's option loading is exercised via service restart.
            const current = await config.get<any>(PANEL); current.servers[0].settings = { configured: true, software: "vanilla", version }; await config.set(current, PANEL);
            await services.stopService(PANEL); services.startService(PANEL); await services.waitUntilReady(PANEL);
        }
        if (!real) {
            const added = await actionsApi.call<any>(PANEL, "add-server", { name: "Independent Terraria", game: "terraria" });
            const current = await config.get<any>(PANEL); second = current.servers.find((s: any) => s.id === added.id);
            second.settings = { configured: true, software: "vanilla", version };
            await config.set(current, PANEL);
            await fs.promises.cp(path.join(directory, "install"), path.join(await fileApi.getPath(second.directory, PANEL), "install"), { recursive: true });
            await services.stopService(PANEL); services.startService(PANEL); await services.waitUntilReady(PANEL);
            await actionsApi.call(PANEL, `${second.id}/start-server`);
            processes.push(`${second.id}-terraria-server`);
            await until(async () => serverStateOf(await actionsApi.call<any>(PANEL, "list-servers"), second.id).serverStatus === "online", "second server online");
        }
        let rejected = false;
        try { await call("op-player", { player: "Steve" }); } catch (err) { rejected = /not found|not registered|not available|does not support|Unknown action/i.test(String(err)); }
        assert(rejected, "Minecraft-only action did not visibly refuse Terraria");
        await call("write-game-options", { patch: { seed: "Paperboard", maxplayers: 4, password: "wire-secret" } });
        assert((await secretsApi.get(`${first.id}-terraria-join-password`, PANEL)).value === "wire-secret", "Password did not reach vault");
        assert(!JSON.stringify(await config.get(PANEL)).includes("wire-secret"), "Password leaked into panel settings");
        await new Promise<void>(resolve => blocker.listen(0, "0.0.0.0", resolve)); const occupied = (blocker.address() as net.AddressInfo).port;
        await call("terraria-world", { name: "Smoke", create: true, port: occupied });
        await call("start-server");
        await until(async () => { const s = await state(); if (s.serverStatus === "offline") throw new Error("Terraria stopped before readiness:\n" + s.serverEntries.map(e => e.content).slice(-25).join("\n")); return s.serverStatus === "online"; }, "Terraria readiness", real ? 300_000 : 15_000);
        const online = await state(); assert(Number(online.serverPort) !== occupied, "Occupied port was not relocated");
        assert(online.localIp === getNetworkIp(), `Overview address is ${online.localIp}, not the computer's LAN address ${getNetworkIp()}`);
        await new Promise<void>((resolve, reject) => { const socket = net.connect(Number(online.serverPort), "127.0.0.1"); socket.once("connect", () => { socket.destroy(); resolve(); }); socket.once("error", reject); });
        console.log(`Terraria ${version}: ONLINE, TCP ${online.serverPort}; collision ${occupied} relocated; host ${process.platform}/${process.arch}`);
        await call("run-command", { command: "playing" }); console.log("playing: command delivered"); await call("save-world");
        console.log("save: returned console prompt and changed world file confirmed");
        await call("stop-server"); await until(async () => !(await processApi.exists(processes[0]!)), "saved stop", 125_000);
        await until(async () => (await state()).serverStatus === "offline", "offline state");
        assert(fs.statSync(path.join(directory, "worlds/Smoke.wld")).size > 0, "World not created");
        // Add an unknown key on disk: option edits must preserve it.
        fs.appendFileSync(path.join(directory, "serverconfig.txt"), "npcstream=42\n");
        await call("write-game-options", { patch: { motd: "Smoke backup" } });
        assert(fs.readFileSync(path.join(directory, "serverconfig.txt"), "utf8").includes("npcstream=42"), "Unknown config key lost");
        await call("start-server"); await until(async () => (await state()).serverStatus === "online", "restart", 30_000);
        const key = backups.sources.resolve(PANEL, first.id); await backups.setPanelDestination(key, LOCAL_DESTINATION_ID);
        const api = backupApi.forSource(PANEL, first.id);
        const record = await api.create({ label: "Terraria smoke" });
        await until(async () => (await state()).serverStatus === "online", "restart after backup", 30_000);
        console.log(`backup: source ${record.sourceId}, ${record.size} bytes, SHA-256 ${record.sha256}; restarted ONLINE`);
        await api.setSchedule({ everyHours: 1, keep: 1 });
        const schedulesFile = path.join(root, "backups/schedules.json"); const schedules = JSON.parse(fs.readFileSync(schedulesFile, "utf8")); schedules.panels[key].nextRunAt = new Date(0).toISOString(); fs.writeFileSync(schedulesFile, JSON.stringify(schedules));
        await backups.runDue();
        assert((await api.status()).schedule?.last?.ok, "Scheduled offline backup failed");
        await until(async () => (await state()).serverStatus === "online", "scheduled restart", 30_000);
        // A second due run exercises real retention, keeping the manual backup.
        const dueAgain = JSON.parse(fs.readFileSync(schedulesFile, "utf8")); dueAgain.panels[key].nextRunAt = new Date(0).toISOString(); fs.writeFileSync(schedulesFile, JSON.stringify(dueAgain));
        await backups.runDue();
        assert((await api.list()).length === 2, "Routine retention removed a manual backup or kept excess routines");
        await until(async () => (await state()).serverStatus === "online", "retention restart", 30_000);
        console.log("scheduled offline backup: success, keep=1 retention verified, restarted ONLINE");
        fs.writeFileSync(path.join(directory, "after-backup.txt"), "must disappear on restore");
        await api.restore(record.id);
        await until(async () => (await state()).serverStatus === "online", "restart after restore", 30_000);
        assert(!fs.existsSync(path.join(directory, "after-backup.txt")), "Restore did not replace source data");
        assert((await secretsApi.get(`${first.id}-terraria-join-password`, PANEL)).value === "wire-secret", "Restore lost vault credential");
        assert(!(await actionsApi.call<any[]>(PANEL, WIDGET_CHOICES_ACTION, { widgetId: "players" })).some(x => x.value === first.id), "Terraria offered unsupported players widget");
        await call("run-command", { command: "playing" }); console.log("playing: command delivered"); await call("save-world");
        if (second) {
            const other = serverStateOf(await actionsApi.call<any>(PANEL, "list-servers"), second.id);
            assert(other.serverStatus === "online", "Backup or restore stopped another server");
            assert(other.serverPort !== (await state()).serverPort, "Servers share a port");
            await call("run-command", { command: "isolation-first" });
            await until(async () => fs.readFileSync(path.join(directory, "worlds/commands.txt"), "utf8").split("\n").includes("isolation-first"), "command at the first server");
            const otherDirectory = await fileApi.getPath(second.directory, PANEL);
            // the panel sends every server its own `playing` for the roster, so
            // only the command sent to the first one tells the servers apart
            const otherCommands = path.join(otherDirectory, "worlds/commands.txt");
            assert(!(fs.existsSync(otherCommands) && fs.readFileSync(otherCommands, "utf8").split("\n").includes("isolation-first")), "Command reached the wrong server");
            await actionsApi.call(PANEL, "remove-server", { server: second.id });
            assert(fs.existsSync(path.join(otherDirectory, "worlds/World.wld")), "Removing a server deleted its world");
        }
        console.log("restore: original world loaded, later file removed, vault credential retained, restarted ONLINE");
        await call("stop-server"); await until(async () => !(await processApi.exists(processes[0]!)), "final graceful stop", 125_000);
        await until(async () => (await state()).serverStatus === "offline", "final offline state");
        const final = await state();
        console.log("stop: exit completed; process absent; state OFFLINE");
        if (real) console.log("Publisher output:\n" + final.serverEntries.map(e => e.content).filter(line => /Terraria Server|Server started|Listening|World saved|Saving world|connected|Starting/i.test(String(line))).join("\n"));
        else {
            const commands = fs.readFileSync(path.join(directory, "worlds/commands.txt"), "utf8");
            assert(commands.includes("say Server stopping") && commands.includes("save\nexit"), "Backup did not announce/save/exit through real stdin");
            fs.writeFileSync(path.join(directory, "worlds/no-save"), "");
            await call("start-server"); await until(async () => (await state()).serverStatus === "online", "save failure test start");
            let noSave = false; try { await call("save-world"); } catch (err) { noSave = /save completion/.test(String(err)); }
            assert(noSave, "A returned prompt without a changed world file was accepted as a save");
            fs.writeFileSync(path.join(directory, "restore-refused.txt"), "must survive");
            let refusedRestore = false; try { await api.restore(record.id); } catch (err) { refusedRestore = /save completion/.test(String(err)); }
            assert(refusedRestore && fs.existsSync(path.join(directory, "restore-refused.txt")), "Failed pre-restore save still replaced source files");
            fs.unlinkSync(path.join(directory, "worlds/no-save"));
            await call("stop-server"); await until(async () => (await state()).serverStatus === "offline", "save failure test stop");
            fs.writeFileSync(path.join(directory, "worlds/silent"), "");
            await call("start-server"); await until(async () => (await state()).serverStatus === "offline", "bounded readiness timeout", 10_000);
            assert((await state()).serverEntries.some(e => String(e.content).includes("Startup timed out")), "Readiness deadline failure was swallowed");
            console.log("silent-process readiness: deadline reported and process stopped");
        }
    } catch (err) {
        if (real) {
            const snapshot = await actionsApi.call<any>(PANEL, "list-servers").catch(() => null);
            if (snapshot) for (const server of snapshot.servers) console.error("Failure console:\n" + serverStateOf(snapshot, server.id).serverEntries.map(e => e.content).filter(line => !/^\d+\.?\d*%/.test(String(line))).join("\n"));
        }
        throw err;
    } finally {
        blocker.close(); await services.stopService(PANEL);
        for (const id of processes) await engine.killProcess(id, "SIGKILL");
        process.execPath = bun; backups.dispose(); closeTransport("local");
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>(resolve => wss.close(() => resolve())); auth.dispose();
        if (previousDir === undefined) delete process.env.PAPERBOARD_DIR; else process.env.PAPERBOARD_DIR = previousDir;
        fs.rmSync(root, { recursive: true, force: true });
    }
}
