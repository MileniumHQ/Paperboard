import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { setupWebSocketServer } from "../papercrane/ws";
import {
    initPaperApi,
    closeTransport,
    actionsApi,
    backupApi,
    config,
    fileApi,
    processApi,
    WIDGET_CHOICES_ACTION,
} from "@mileniumhq/paperapi";
import { backupServiceFor } from "../papercrane/rpc/backups";
import { LOCAL_DESTINATION_ID } from "../papercrane/backups/config";
import { serverStateOf } from "../../../panels/dev.paperboard.gameserver/src/servers";
const PANEL = "dev.paperboard.gameserver";
async function until(check: () => boolean | Promise<boolean>) {
    const deadline = Date.now() + 10_000;
    while (!(await check())) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for server state");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

test("Game Server over the real daemon: migration, independent servers, projects, ports and legacy forwarding", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gameservers-wire-"));
    const bunExecutable = process.execPath;
    const launcherSource = path.join(root, "supervisor.ts");
    const launcher = path.join(
        root,
        process.platform === "win32" ? "supervisor.exe" : "supervisor",
    );
    fs.writeFileSync(
        launcherSource,
        `import { runSupervisor } from ${JSON.stringify(path.resolve(import.meta.dir, "../papercrane/supervisor.ts"))}; await runSupervisor(process.argv.at(-1)!);`,
    );
    const build = Bun.spawnSync([
        bunExecutable,
        "build",
        launcherSource,
        "--compile",
        "--outfile",
        launcher,
    ]);
    if (build.exitCode !== 0) throw new Error(build.stderr.toString());
    process.execPath = launcher;
    const engine = new PaperCraneEngine(root);
    const auth = new PaperCraneAuth(false, path.join(root, "local"));
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    setupWebSocketServer(wss, engine, auth);
    await once(wss, "listening");
    const processes: string[] = [];
    const backups = backupServiceFor(engine);
    try {
        await initPaperApi({
            port: (wss.address() as any).port,
            token: auth.issuePanelToken(PANEL),
            computerId: "local",
            panelId: PANEL,
        });
        const panelDir = path.join(root, "panels", PANEL);
        fs.mkdirSync(panelDir, { recursive: true });
        fs.writeFileSync(
            path.join(panelDir, "manifest.json"),
            JSON.stringify({ id: PANEL, version: "0.4.0" }),
        );
        const legacy = {
            configured: true,
            software: "vanilla",
            version: "1.21.4",
            ramGB: 3,
            installedSoftware: { keep: "the installed record" },
            pendingRuntimeProperties: { difficulty: "hard" },
        };
        await config.set(legacy, PANEL);
        await fileApi.write("world/level.dat", "legacy world", PANEL);
        await fileApi.write("servers/custom/plugin-data.txt", "original nested data", PANEL);
        await fileApi.write("server.properties", "server-port=25565\nmotd=Legacy\n", PANEL);
        const legacyDir = await fileApi.getPath("", PANEL);
        await backups.setPanelDestination(PANEL, LOCAL_DESTINATION_ID);
        await backups.setSchedule(PANEL, { everyHours: 24, keep: 7 });

        const beforeMigrationBackup = await backups.create(PANEL, "Before several servers");
        const child = `console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"'); for await (const line of console) { if (line === 'stop') process.exit(0); console.log('[Server thread/INFO]: ' + line); }`;
        await processApi.start({ id: "mc-server", command: bunExecutable, args: ["-e", child], cwd: legacyDir });
        processes.push("mc-server");

        const { gameServerService, LEGACY_DEPRECATION } = await import(
            "../../../panels/dev.paperboard.gameserver/src/service"
        );
        await gameServerService.ready;
        expect(gameServerService.getState().serversError).toBeNull();
        expect(gameServerService.getState().servers[0]!.state.serverStatus).toBe("online");
        const migrated = await config.get<any>(PANEL);
        const first = migrated.servers[0];
        expect(migrated.version).toBe(2);
        expect(migrated.legacyServer).toBe(first.id);
        expect(first).toMatchObject({ directory: "", game: "minecraft", settings: legacy });
        expect(fs.readFileSync(path.join(legacyDir, "world/level.dat"), "utf8")).toBe(
            "legacy world",
        );
        expect(backups.status(PANEL).schedule).toMatchObject({ everyHours: 24, keep: 7 });
        const second = await actionsApi.call<any>(PANEL, "add-server", { name: "Creative" });
        const saved = await config.get<any>(PANEL);
        expect(saved.servers).toHaveLength(2);
        expect(saved.servers[0].id).toBe(first.id);
        const secondDirectory = saved.servers[1].directory;
        expect(secondDirectory).toBe(`${saved.serversDirectory}/${second.id}`);
        expect((await actionsApi.listProjects(PANEL)).map((p) => p.id).sort()).toEqual(
            [first.id, second.id].sort(),
        );
        const listed = await actionsApi.list(PANEL);
        expect(listed.find((a) => a.action === `${second.id}/run-command`)?.project).toBe(
            second.id,
        );
        expect(listed.find((a) => a.action === "run-command")?.schema?.deprecated).toBe(
            LEGACY_DEPRECATION,
        );
        expect(
            await actionsApi.call(PANEL, WIDGET_CHOICES_ACTION, {
                widgetId: "status",
                optionId: "server",
            }),
        ).toEqual([
            { value: first.id, label: first.name },
            { value: second.id, label: "Creative" },
        ]);
        await actionsApi.call(PANEL, `${second.id}/update-panel-config`, {
            patch: { ramGB: 8, configured: true },
        });
        expect((await config.get<any>(PANEL)).servers[0].settings).toEqual(legacy);
        expect(serverStateOf(gameServerService.getState(), second.id).ramAllocation).toBe(8);
        await expect(actionsApi.call(PANEL, "prepare-crossplay", {})).rejects.toThrow("does not support action");
        await actionsApi.call(PANEL, "update-panel-config", { patch: { ramGB: 5 } });
        expect((await config.get<any>(PANEL)).servers.map((s: any) => s.settings.ramGB)).toEqual([
            5, 8,
        ]);

        const { selectedWidgetServer } = await import(
            "../../../panels/dev.paperboard.gameserver/src/widget/connection"
        );
        expect(selectedWidgetServer(gameServerService.getState(), undefined).id).toBe(first.id);
        expect(selectedWidgetServer(gameServerService.getState(), second.id).id).toBe(second.id);
        expect(() => selectedWidgetServer(gameServerService.getState(), "removed")).toThrow(
            "No server is chosen",
        );

        // Run two actual supervised console processes. Their input/output is
        // intentionally tiny; the service's real parser and action handlers
        // sit between these OS processes and the WebSocket client.

        const { inServer } = await import(
            "../../../panels/dev.paperboard.gameserver/src/service/scope"
        );
        const { processApi: scopedProcessApi } = await import(
            "../../../panels/dev.paperboard.gameserver/src/service/api"
        );
        // Launch preparation crosses the real config, file, package and system
        // APIs. No Java is run: fixture package directories describe the runtime.
        const { gameServiceFor } = await import("../../../panels/dev.paperboard.gameserver/src/games/service");
        const { initialServerState } = await import("../../../panels/dev.paperboard.gameserver/src/service/initialState");
        const javaHome = path.join(root, "packages", "java-21");
        fs.mkdirSync(path.join(javaHome, "bin"), { recursive: true });
        const launchServer = { ...saved.servers[1], settings: { software: "paper", version: "1.21.4" } };
        const launchContext = { state: { ...initialServerState(), serverSoftware: "paper", serverVersion: "1.21.4", ramAllocation: 6 } } as any;
        const launchDir = path.join(legacyDir, secondDirectory);
        fs.writeFileSync(path.join(launchDir, "server.jar"), "launch fixture");
        const resolveLaunch = () => inServer({ server: launchServer, legacy: false } as any, () => gameServiceFor(launchServer.game).prepareLaunch(launchContext));
        const jar = await resolveLaunch();
        expect(jar.command).toEqual({
            executable: `${javaHome}/bin/${process.platform === "win32" ? "java.exe" : "java"}`,
            args: ["-Xmx6G", "-Xms6G", "-jar", "server.jar", "nogui"],
            cwd: launchDir,
            env: { JAVA_HOME: javaHome },
        });
        const launch = { type: "argfile", unix: "libraries/unix_args.txt", windows: "libraries/win_args.txt" };
        fs.mkdirSync(path.join(launchDir, "libraries"));
        for (const name of [launch.unix, launch.windows]) fs.writeFileSync(path.join(launchDir, name), "launch fixture");
        Object.assign(launchServer.settings, { install: { software: "neoforge", version: "1.21.4", build: "test", launch, files: ["libraries"], staging: ".install-1-1" } });
        expect((await resolveLaunch()).command).toEqual({
            ...jar.command,
            args: ["-Xmx6G", "-Xms6G", `@${process.platform === "win32" ? launch.windows : launch.unix}`, "nogui"],
        });
        fs.unlinkSync(path.join(launchDir, process.platform === "win32" ? launch.windows : launch.unix));
        await expect(resolveLaunch()).rejects.toThrow("is missing in the server folder");

        for (const server of saved.servers) {
            const legacy = server.id === first.id;
            if (legacy) continue; // the original process survived migration
            await inServer({ server, legacy } as any, () =>
                scopedProcessApi.start({
                    id: "mc-server",
                    command: bunExecutable,
                    args: ["-e", child],
                    cwd: legacyDir,
                }),
            );
            processes.push(legacy ? "mc-server" : `${server.id}-mc-server`);
        }
        await until(() =>
            gameServerService
                .getState()
                .servers.every(
                    (s) =>
                        serverStateOf(gameServerService.getState(), s.id).serverStatus === "online",
                ),
        );
        await actionsApi.call(PANEL, `${second.id}/run-command`, { command: "creative-only" });
        await actionsApi.call(PANEL, "run-command", { command: "legacy-only" });
        await until(() =>
            serverStateOf(gameServerService.getState(), second.id).serverEntries.some((e) =>
                e.content.includes("creative-only"),
            ),
        );
        const states = gameServerService
            .getState()
            .servers.map((s) => serverStateOf(gameServerService.getState(), s.id));
        expect(states[0]!.serverEntries.some((e) => e.content.includes("creative-only"))).toBe(
            false,
        );
        expect(states[1]!.serverEntries.some((e) => e.content.includes("legacy-only"))).toBe(false);
        await actionsApi.call(PANEL, `${second.id}/stop-server`);
        await until(
            () => gameServerService.getState().servers[1]!.state.serverStatus === "offline",
        );
        expect(await processApi.exists("mc-server")).toBe(true);
        await actionsApi.call(PANEL, "stop-server");
        await until(
            () => gameServerService.getState().servers[0]!.state.serverStatus === "offline",
        );

        // The actual Port API registry, with the panel's production adapters.
        const { prepareServerPorts } = await import(
            "../../../panels/dev.paperboard.gameserver/src/service/ports"
        );
        const { livePortDeps } = await import(
            "../../../panels/dev.paperboard.gameserver/src/service/portDeps"
        );
        for (const server of (await config.get<any>(PANEL)).servers) {
            await inServer({ server, legacy: server.id === first.id } as any, () =>
                prepareServerPorts("vanilla", livePortDeps()),
            );
        }
        const { portApi } = await import("@mileniumhq/paperapi");
        const ports = await portApi.list(PANEL);
        expect(ports).toHaveLength(2);
        expect(new Set(ports.map((p) => p.port)).size).toBe(2);
        expect(new Set(ports.map((p) => p.name)).size).toBe(2);
        expect(ports.some((p) => p.label.includes("Creative"))).toBe(true);
        const secondProps = fs.readFileSync(
            path.join(legacyDir, `${secondDirectory}/server.properties`),
            "utf8",
        );
        expect(secondProps).not.toContain("server-port=25565");

        // The renderer's Crossplay removal must give back its own Bedrock
        // claim, even while the migrated server also owns one.
        const { portApi: scopedPorts } = await import("../../../panels/dev.paperboard.gameserver/src/service/api");
        for (const server of saved.servers) {
            await inServer({ server, legacy: server.id === first.id } as any, () => scopedPorts.claim(PANEL, { name: "bedrock", label: "Bedrock", protocol: "udp", preferred: 19132 }));
        }
        const oldWindow = (globalThis as any).window;
        try {
            (globalThis as any).window = { location: { href: `http://fixture/panel?server=${second.id}` } };
            const renderer = await import("../../../panels/dev.paperboard.gameserver/src/lib/api");
            renderer.selectedServer(gameServerService.getState());
            await renderer.portApi.release(PANEL, "bedrock");
            expect((await portApi.list(PANEL)).filter((p) => p.name.endsWith("bedrock")).map((p) => p.name)).toEqual(["bedrock"]);
            renderer.serversBridge.dispose();
        } finally {
            if (oldWindow === undefined) delete (globalThis as any).window;
            else (globalThis as any).window = oldWindow;
        }

        // Sources use the same remote/local stores and scheduling machinery,
        // while copying and restoring only the selected server's files/config.
        const firstKey = backups.sources.resolve(PANEL, first.id);
        const secondKey = backups.sources.resolve(PANEL, second.id);
        await backups.setPanelDestination(secondKey, LOCAL_DESTINATION_ID);
        await backups.setSchedule(secondKey, { everyHours: 12, keep: 2 });
        expect(backups.status(firstKey).schedule?.everyHours).toBe(24);
        expect(backups.status(secondKey).schedule?.everyHours).toBe(12);
        await fileApi.write(`${secondDirectory}/world/level.dat`, "creative world", PANEL);
        const secondBackups = backupApi.forSource(PANEL, second.id);
        expect((await secondBackups.status()).schedule?.keep).toBe(2);
        const record = await secondBackups.create({ label: "Creative test" });
        expect((await backups.list(firstKey)).map((record) => record.id)).toEqual([beforeMigrationBackup.id]);
        expect(await secondBackups.list()).toHaveLength(1);
        await fileApi.write(`${secondDirectory}/world/level.dat`, "changed world", PANEL);
        await secondBackups.restore(record.id);
        expect(
            fs.readFileSync(path.join(legacyDir, `${secondDirectory}/world/level.dat`), "utf8"),
        ).toBe("creative world");
        expect(fs.readFileSync(path.join(legacyDir, "world/level.dat"), "utf8")).toBe(
            "legacy world",
        );
        expect((await config.get<any>(PANEL)).servers[0].settings.ramGB).toBe(5);
        const oldRecord = await backups.create(firstKey, "Legacy test");
        await fileApi.write("world/level.dat", "changed legacy", PANEL);
        await backups.restore(firstKey, oldRecord.id);
        expect(fs.readFileSync(path.join(legacyDir, "world/level.dat"), "utf8")).toBe(
            "legacy world",
        );
        expect(
            fs.readFileSync(path.join(legacyDir, "servers/custom/plugin-data.txt"), "utf8"),
        ).toBe("original nested data");
        expect(
            fs.readFileSync(path.join(legacyDir, `${secondDirectory}/world/level.dat`), "utf8"),
        ).toBe("creative world");

        await actionsApi.call(PANEL, "rename-server", {
            server: second.id,
            name: "Creative renamed",
        });
        expect((await actionsApi.listProjects(PANEL)).find((p) => p.id === second.id)?.name).toBe(
            "Creative renamed",
        );
        await actionsApi.call(PANEL, "remove-server", { server: second.id });
        expect(fs.existsSync(path.join(legacyDir, `${secondDirectory}/world/level.dat`))).toBe(
            true,
        );
        expect(backups.status(secondKey).schedule).toBeNull();
        expect((await config.get<any>(PANEL)).servers.map((s: any) => s.id)).toEqual([first.id]);
        await expect(
            actionsApi.call(PANEL, `${second.id}/run-command`, { command: "no" }),
        ).rejects.toThrow();
        // A backup made before migration restores only the legacy source,
        // keeping the new list and every other server's directory intact.
        await backups.restore(firstKey, beforeMigrationBackup.id);
        const restoredLegacy = await config.get<any>(PANEL);
        expect(restoredLegacy.servers).toHaveLength(1);
        expect(restoredLegacy.legacyServer).toBe(first.id);
        expect(restoredLegacy.servers[0].settings).toEqual(legacy);
        expect(fs.readFileSync(path.join(legacyDir, `${secondDirectory}/world/level.dat`), "utf8")).toBe("creative world");
    } finally {
        for (const id of processes) await engine.killProcess(id, "SIGKILL");
        process.execPath = bunExecutable;
        backups.dispose();
        closeTransport("local");
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        auth.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 45_000);
