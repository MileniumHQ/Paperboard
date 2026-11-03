// A Game Server's console and chat outlive its service, and a server that
// went down while the service was away is started again. Real daemon, real
// supervised processes, the bundled service run as a panel service and
// restarted between the two halves.
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { setupWebSocketServer } from "../papercrane/ws";
import { initPaperApi, closeTransport, actionsApi, config, fileApi, processApi } from "@mileniumhq/paperapi";
import { backupServiceFor } from "../papercrane/rpc/backups";
import { serverStateOf } from "../../../panels/dev.paperboard.gameserver/src/servers";
const PANEL = "dev.paperboard.gameserver";
async function until(check: () => boolean | Promise<boolean>, what: string) {
    const deadline = Date.now() + 15_000;
    while (!(await check())) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

test("a service restart keeps each server's console and chat, and starts a server that died meanwhile", async () => {
    const { PanelServicesManager } = await import("../papercrane/panelServices");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gameservers-history-"));
    const bunExecutable = process.execPath;
    const launcherSource = path.join(root, "supervisor.ts");
    const launcher = path.join(root, process.platform === "win32" ? "supervisor.exe" : "supervisor");
    fs.writeFileSync(launcherSource, `import { runSupervisor } from ${JSON.stringify(path.resolve(import.meta.dir, "../papercrane/supervisor.ts"))}; if (process.argv.includes("--panel-service")) await import(process.argv.at(-1)!); else await runSupervisor(process.argv.at(-1)!);`);
    const build = Bun.spawnSync([bunExecutable, "build", launcherSource, "--compile", "--outfile", launcher]);
    if (build.exitCode !== 0) throw new Error(build.stderr.toString());
    process.execPath = launcher;
    const services = new PanelServicesManager(root);
    const engine = new PaperCraneEngine(root, services);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    setupWebSocketServer(wss, engine, auth);
    await once(wss, "listening");
    const backups = backupServiceFor(engine);
    try {
        await initPaperApi({ port: (wss.address() as any).port, token: auth.issuePanelToken(PANEL), computerId: "local", panelId: PANEL });
        const panelDir = path.join(root, "panels", PANEL);
        fs.mkdirSync(panelDir, { recursive: true });
        fs.writeFileSync(path.join(panelDir, "manifest.json"), JSON.stringify({ id: PANEL, version: "0.4.0", service: "service.mjs" }));
        const bundle = await Bun.build({ entrypoints: [path.resolve(import.meta.dir, "../../../panels/dev.paperboard.gameserver/src/service.ts")], target: "bun", format: "esm" });
        if (!bundle.success) throw new AggregateError(bundle.logs, "Service build failed");
        await Bun.write(path.join(panelDir, "service.mjs"), bundle.outputs[0]!);
        const serversDirectory = "servers-0123456789ab";
        const servers = ["survival", "creative"].map((id) => ({ id, name: id, game: "minecraft", directory: `${serversDirectory}/${id}`, createdAt: 1, settings: { configured: true, software: "vanilla", version: "1.21.4" } }));
        await config.set({ version: 2, serversDirectory, servers }, PANEL);
        for (const server of servers) await fileApi.write(`${server.directory}/world/level.dat`, server.id, PANEL);
        const child = `console.log('[Server thread/INFO]: Done (0.1s)!'); for await (const line of console) { if (line === 'villagers') console.log('[14:00:00] [Server thread/INFO]: <Hyper> where are my villagers'); if (line === 'list') console.log('[14:00:00] [Server thread/INFO]: There are 1 of a max of 20 players online: Hyper'); }`;
        await processApi.start({ id: "survival-mc-server", command: bunExecutable, args: ["-e", child], cwd: await fileApi.getPath(servers[0]!.directory, PANEL) });
        services.init((wss.address() as any).port, undefined, auth);
        await services.waitUntilReady(PANEL);
        const state = async (id: string) => serverStateOf(await actionsApi.call<any>(PANEL, "list-servers"), id);
        expect((await state("survival")).serverStatus).toBe("online");
        // a server the service adopts is asked who is on, not shown empty until its next start
        await until(async () => (await state("survival")).onlinePlayers.length === 1, "the adopted server's players");

        await actionsApi.call(PANEL, "survival/run-command", { command: "villagers" });
        await until(async () => (await state("survival")).chatMessages.some((m) => m.text.includes("where are my villagers")), "the chat line");
        // the history is written once the output settles
        const historyFile = path.join(await fileApi.getPath(serversDirectory, PANEL), "history", "survival.json");
        await until(() => fs.existsSync(historyFile) && fs.readFileSync(historyFile, "utf8").includes("where are my villagers"), "the history to be written");

        // the service goes away, and the server dies while nobody watches
        await services.stopService(PANEL);
        await engine.killProcess("survival-mc-server", "SIGKILL");
        await until(async () => !(await processApi.exists("survival-mc-server")), "the server to die");

        services.startService(PANEL);
        await services.waitUntilReady(PANEL);
        const after = await state("survival");
        expect(after.chatMessages.map((m) => m.text)).toContain("<Hyper> where are my villagers");
        expect(after.serverEntries.some((e) => String(e.content).includes("villagers"))).toBe(true);
        // the server was running and nobody stopped it, so it starts again;
        // this fixture has no Java, so the launch itself fails, out loud
        await until(async () => (await state("survival")).serverEntries.some((e) => e.content === "[Server] The server stopped while Paperboard was not running. Starting it again."), "the restart notice");
        await until(async () => (await state("survival")).serverEntries.some((e) => String(e.content).startsWith("[Server] Failed to launch")), "the launch to fail out loud");
        // a server that was never running is left alone
        const creative = await state("creative");
        expect(creative.serverStatus).toBe("offline");
        expect(creative.serverEntries.some((e) => String(e.content).includes("not running"))).toBe(false);
    } finally {
        await services.stopService(PANEL);
        await engine.killProcess("survival-mc-server", "SIGKILL");
        process.execPath = bunExecutable;
        backups.dispose();
        closeTransport("local");
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        auth.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 60_000);
