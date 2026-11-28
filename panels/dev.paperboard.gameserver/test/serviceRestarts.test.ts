import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { backupApi, backupLocationsApi } from "@mileniumhq/paperapi";
import { waitFor } from "testkit/wait";
import { serverCalls } from "./helpers/serverCall";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { installFakeJava } from "./helpers/fakeJava";
import { installPanel, restartService, servicesState, waitForFile } from "./helpers/installedPanel";
import { readTree, writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";
import { joinPort } from "../src/core/portNames";
import { ROUTINE_BACKUP_LABEL } from "../src/backupSchedule";

const SERVERS = "servers-0123456789ab";
const dataDir = process.env.PAPERBOARD_DIR!;
const filesRoot = path.join(dataDir, "files", PANEL_ID, SERVERS);
const serverDir = (id: string) => path.join(filesRoot, id);
const historyFile = (id: string) => path.join(filesRoot, "history", `${id}.json`);
const configFile = path.join(dataDir, "configs", `${PANEL_ID}.json`);
const stored = (id: string) => ({ id, name: `Server ${id}`, game: "minecraft", directory: `${SERVERS}/${id}`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } });
/** the stand-in server's pids, one per start (helpers/fakeJava.main.ts) */
const runs = (id: string) => (fs.existsSync(path.join(serverDir(id), "runs.log")) ? fs.readFileSync(path.join(serverDir(id), "runs.log"), "utf8").split("\n").filter(Boolean).map(Number) : []);
const alive = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw err;
    }
};

let daemon: TestDaemon;
beforeAll(async () => {
    installPanel(dataDir);
    fs.mkdirSync(path.join(dataDir, "configs"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "configs", `${PANEL_ID}.json`), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [stored("s-a"), stored("s-b"), stored("s-e"), { ...stored("s-c"), settings: {} }, { ...stored("s-d"), settings: {} }] }));
    // s-c and s-d can't be set up: a file stands where each one's folder goes
    fs.mkdirSync(filesRoot, { recursive: true });
    for (const id of ["s-c", "s-d"]) fs.writeFileSync(serverDir(id), "not a folder");
    for (const id of ["s-a", "s-b", "s-e"]) writeTree(serverDir(id), { "server.jar": "jar", "eula.txt": "eula=true\n", "world/level.dat": `${id} world` });
    writeTree(serverDir("s-a"), { "fake-server.json": JSON.stringify({ players: ["alice", "bob"], maxPlayers: 10 }) });
    installFakeJava(javaPackageFor("1.21.1")!, dataDir);
    daemon = await startTestDaemon();
    // the daemon started the installed service; this waits for one that is ready
    await restartService();
});
afterAll(async () => {
    // no stand-in this file started outlives it
    for (const pid of [...runs("s-a"), ...runs("s-b"), ...runs("s-e")]) if (alive(pid)) process.kill(pid, "SIGKILL");
    await daemon?.stop();
});

// Game Server keeps servers, history and backups through restarts and migration.
describe("servers through restarts", () => {
    test("a server that could not be set up says why, refuses its calls, and is set up again once the cause is gone", async () => {
        const state = servicesState();
        const failed = await state.waitFor("s-c", (s) => typeof s.initFailure === "string", "s-c's setup failure");
        expect(failed.initFailure).toContain("EEXIST");
        // not an interrupted install: there is nothing to clean up
        expect(failed.recoveryBlock).toBeNull();
        await expect(serverCalls("s-c").startServer()).rejects.toThrow("could not be set up");
        fs.rmSync(serverDir("s-c"));
        expect(await serverCalls("s-c").retryInitialize()).toBe(true);
        expect((await state.server("s-c"))!.initFailure).toBeNull();
        expect(fs.statSync(serverDir("s-c")).isDirectory()).toBe(true);
        expect(await serverCalls("s-c").readAutomation()).toBeTruthy();
        expect(await serverCalls("s-c").removeServer()).toEqual({ removed: "s-c" });
    });

    test("a server that could not be set up is renamed and removed as it is, and what stands at its folder is kept", async () => {
        const state = servicesState();
        await state.waitFor("s-d", (s) => typeof s.initFailure === "string", "s-d's setup failure");
        expect(await serverCalls("s-d").renameServer({ name: "Broken" })).toBe(true);
        const named = JSON.parse(fs.readFileSync(path.join(dataDir, "configs", `${PANEL_ID}.json`), "utf8"));
        expect(named.servers.find((s: { id: string }) => s.id === "s-d").name).toBe("Broken");
        expect(await serverCalls("s-d").removeServer()).toEqual({ removed: "s-d" });
        const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "configs", `${PANEL_ID}.json`), "utf8"));
        expect(saved.servers.map((s: { id: string }) => s.id)).not.toContain("s-d");
        expect(fs.readFileSync(serverDir("s-d"), "utf8")).toBe("not a folder");
    });

    test("a server running when the service starts again is shown online with its players and its console history", async () => {
        const state = servicesState();
        await serverCalls("s-a").startServer();
        const before = await state.waitFor("s-a", (s) => s.serverStatus === "online" && s.onlinePlayers.length === 2, "s-a online with its players");
        expect(Date.now() - before.onlineSince!).toBeLessThan(60_000);
        await serverCalls("s-a").runCommand({ command: "say before the restart" });
        await state.waitFor("s-a", (s) => s.serverEntries.some((e) => e.content.includes("[Server] before the restart")), "the command's echo");
        // the console is kept on disk for the next service, with when the server came online
        await waitForFile(historyFile("s-a"), (text) => text.includes("[Server] before the restart") && text.includes(`"onlineSince":${before.onlineSince}`), "the console history to be saved");
        const [pid] = runs("s-a");

        await restartService();
        const after = await state.waitFor("s-a", (s) => s.serverStatus === "online" && s.onlinePlayers.length === 2, "s-a online again after the restart");
        expect(after.onlinePlayers.sort()).toEqual(["alice", "bob"]);
        // its uptime carries on from its start, not from the service's
        expect(after.onlineSince).toBe(before.onlineSince);
        expect(after.serverEntries.map((e) => e.content)).toContain("[12:00:00] [Server thread/INFO]: [Not Secure] [Server] before the restart");
        // the same process: adopted, not started again
        expect(runs("s-a")).toEqual([pid!]);
        expect(alive(pid!)).toBe(true);
    });

    test("a server running on a moved port is shown on that port after the service starts again, and its stop puts the chosen one back", async () => {
        const state = servicesState();
        // another program has the port the user chose
        const holder = net.createServer();
        await new Promise<void>((resolve, reject) => holder.once("error", reject).listen(0, "127.0.0.1", resolve));
        const chosen = (holder.address() as net.AddressInfo).port;
        const properties = path.join(serverDir("s-e"), "server.properties");
        fs.writeFileSync(properties, `server-port=${chosen}\nmotd=Hi\n`);
        try {
            await serverCalls("s-e").startServer();
            const before = await state.waitFor("s-e", (s) => s.serverStatus === "online", "s-e online on a moved port");
            const moved = Number(joinPort(before));
            expect(moved).toBeGreaterThan(chosen);
            // the server saved the run's port into its file as it started, as Paper does
            expect(fs.readFileSync(properties, "utf8")).toContain(`server-port=${moved}\n`);
            await waitForFile(historyFile("s-e"), (text) => text.includes(`"to":${moved}`), "the run's port to be saved with its history");

            await restartService();
            const after = await state.waitFor("s-e", (s) => s.serverStatus === "online", "s-e online again after the restart");
            // the address players copy is the port it listens on, and the Overview still says why
            expect(joinPort(after)).toBe(String(moved));
            expect(after.portMoves).toEqual([{ label: "Minecraft", from: chosen, to: moved, primary: true }]);
            expect((await serverCalls("s-e").readGameOptions())["server-port"]).toBe(chosen);

            await serverCalls("s-e").stopServer();
            await state.waitFor("s-e", (s) => s.serverStatus === "offline", "s-e to stop");
            expect((await serverCalls("s-e").readGameOptions())["server-port"]).toBe(chosen);
            expect(fs.readFileSync(properties, "utf8")).toContain(`server-port=${chosen}\n`);
            expect(await serverCalls("s-e").removeServer()).toEqual({ removed: "s-e" });
        } finally {
            await new Promise<void>((resolve, reject) => holder.close((err) => (err ? reject(err) : resolve())));
        }
    });

    test("a server that stopped while Paperboard was not running is started again", async () => {
        const state = servicesState();
        const [pid] = runs("s-a");
        // Paperboard goes away; the server keeps running under its supervisor, then dies
        await daemon.stop();
        expect(alive(pid!)).toBe(true);
        process.kill(pid!, "SIGKILL");
        daemon = await startTestDaemon();
        await restartService();
        const back = await state.waitFor("s-a", (s) => s.serverStatus === "online" && runs("s-a").length === 2, "s-a started again");
        expect(back.serverEntries.map((e) => e.content)).toContain("[Server] The server stopped while Paperboard was not running. Starting it again.");
        expect(runs("s-a")[1]).not.toBe(pid);
        await serverCalls("s-a").stopServer();
        await state.waitFor("s-a", (s) => s.serverStatus === "offline", "s-a to stop");
    });

    test("a server stopped just before the service stops stays stopped when the service starts again", async () => {
        const state = servicesState();
        await serverCalls("s-b").startServer();
        await state.waitFor("s-b", (s) => s.serverStatus === "online", "s-b online");
        await waitForFile(historyFile("s-b"), (text) => text.includes(`"running":true`), "the running server's history to be saved");
        await serverCalls("s-b").stopServer();
        await state.waitFor("s-b", (s) => s.serverStatus === "offline", "s-b to stop");
        // an update or a restart stops the service right after: the stop is what it keeps
        await restartService();
        const after = (await state.server("s-b"))!;
        expect(after.serverStatus).toBe("offline");
        expect(after.serverEntries.map((e) => e.content)).toContain("[Server] Process stopped.");
        expect(after.serverEntries.map((e) => e.content)).not.toContain("[Server] The server stopped while Paperboard was not running. Starting it again.");
        expect(runs("s-b")).toHaveLength(1);
    });

    test("each server's backups are its own: restoring one puts back only that server's files and settings, and removing a server keeps its world", async () => {
        await backupLocationsApi.setForPanel(PANEL_ID, "local");
        const settingsOf = (id: string) => JSON.parse(fs.readFileSync(configFile, "utf8")).servers.find((s: { id: string }) => s.id === id).settings;
        const automation = await serverCalls("s-a").readAutomation();
        const settingsThen = settingsOf("s-a");
        const backup = await serverCalls("s-a").backUp({ label: "before" });
        expect(backup).toMatchObject({ target: "s-a", label: "before", paths: [`${SERVERS}/s-a`] });
        expect((await backupApi.list(PANEL_ID, { target: "s-a" })).map((b) => b.id)).toEqual([backup.id]);
        expect(await backupApi.list(PANEL_ID, { target: "s-b" })).toEqual([]);
        // the label routine backups are told apart by is theirs alone
        await expect(serverCalls("s-a").backUp({ label: ROUTINE_BACKUP_LABEL })).rejects.toThrow("kept for routine backups");
        // a backup of the panel as a whole would be every server's at once
        await expect(backupApi.create(PANEL_ID)).rejects.toThrow("one server at a time");

        fs.writeFileSync(path.join(serverDir("s-a"), "world", "level.dat"), "s-a changed");
        fs.writeFileSync(path.join(serverDir("s-b"), "world", "level.dat"), "s-b changed");
        await serverCalls("s-a").writeAutomation({ patch: { dailyRestart: "04:00" } });
        await serverCalls("s-a").restoreBackup({ backupId: backup.id });
        expect(fs.readFileSync(path.join(serverDir("s-a"), "world", "level.dat"), "utf8")).toBe("s-a world");
        expect(fs.readFileSync(path.join(serverDir("s-b"), "world", "level.dat"), "utf8")).toBe("s-b changed");
        // its settings are the backup's, saved and read again
        expect(await serverCalls("s-a").readAutomation()).toEqual(automation);
        expect(settingsOf("s-a")).toEqual(settingsThen);

        const before = readTree(serverDir("s-b"));
        expect(await serverCalls("s-b").removeServer()).toEqual({ removed: "s-b" });
        expect(readTree(serverDir("s-b"))).toEqual(before);
        const saved = JSON.parse(fs.readFileSync(configFile, "utf8"));
        expect(saved.servers.map((s: { id: string }) => s.id)).toEqual(["s-a"]);
    });

    test("a running server a restore replaces starts again on the restored files, as a restore and not a crash", async () => {
        const state = servicesState();
        // a crash would leave it stopped: only the restore's own resume starts it
        await serverCalls("s-a").writeAutomation({ patch: { restartAfterCrash: false } });
        const backup = await serverCalls("s-a").backUp({ label: "running" });
        await serverCalls("s-a").startServer();
        const seen = (await state.waitFor("s-a", (s) => s.serverStatus === "online", "s-a online")).serverEntries.length;
        // its stand-in notes each start's pid in the server folder, which the restore replaces too
        const pid = runs("s-a").at(-1);
        fs.writeFileSync(path.join(serverDir("s-a"), "world", "level.dat"), "s-a after the backup");
        await serverCalls("s-a").restoreBackup({ backupId: backup.id });
        expect(fs.readFileSync(path.join(serverDir("s-a"), "world", "level.dat"), "utf8")).toBe("s-a world");
        const back = await state.waitFor("s-a", (s) => s.serverStatus === "online" && runs("s-a").at(-1) !== pid, "s-a started again on the restored files");
        expect(alive(pid!)).toBe(false);
        const since = back.serverEntries.slice(seen).map((e) => String(e.content));
        expect(since.join("\n")).not.toContain("stopped while Paperboard was not running");
        // the restore says why it stops the server, before the stop it causes
        const stopping = since.indexOf("[Server] Stopping to restore a backup...");
        expect(stopping).toBeGreaterThanOrEqual(0);
        expect(since.indexOf("[Server] Process stopped.", stopping)).toBeGreaterThan(stopping);
        await serverCalls("s-a").stopServer();
        await state.waitFor("s-a", (s) => s.serverStatus === "offline", "s-a to stop");
    });

    test("a server's due routine backup runs, and pruning deletes only its routine backups beyond the newest kept", async () => {
        const made = await serverCalls("s-a").backUp({ label: "by hand" });
        // two older routine backups, as earlier runs of the schedule left them
        const older = [await backupApi.create(PANEL_ID, { target: "s-a", label: ROUTINE_BACKUP_LABEL }), await backupApi.create(PANEL_ID, { target: "s-a", label: ROUTINE_BACKUP_LABEL })];
        const byHand = (await backupApi.list(PANEL_ID, { target: "s-a" })).filter((b) => b.label !== ROUTINE_BACKUP_LABEL).map((b) => b.id);
        expect(byHand).toContain(made.id);

        const schedule = await serverCalls("s-a").writeBackupSchedule({ schedule: { everyHours: 24, keep: 1 } });
        expect(schedule).toMatchObject({ everyHours: 24, keep: 1, last: null });
        expect(Date.parse(schedule!.nextRunAt) - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
        // the schedule is the server's own, beside the settings a restore replaces
        const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
        const entry = config.servers.find((s: { id: string }) => s.id === "s-a");
        expect(entry.backupSchedule).toEqual(schedule);
        expect(entry.settings.backupSchedule).toBeUndefined();

        // a day later: it is due as the service starts
        entry.backupSchedule.nextRunAt = new Date(Date.now() - 1000).toISOString();
        fs.writeFileSync(configFile, JSON.stringify(config));
        await restartService();
        const ran = await waitFor("the routine backup to run", async () => (await serverCalls("s-a").readBackupSchedule())?.last ?? null, { timeoutMs: 60_000, intervalMs: 200 });
        expect(ran).toMatchObject({ ok: true, message: null });
        const after = await serverCalls("s-a").readBackupSchedule();
        expect(Date.parse(after!.nextRunAt) - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);

        const kept = await backupApi.list(PANEL_ID, { target: "s-a" });
        const routine = kept.filter((b) => b.label === ROUTINE_BACKUP_LABEL);
        expect(routine).toHaveLength(1);
        expect(older.map((b) => b.id)).not.toContain(routine[0]!.id);
        // every backup made by hand stays
        expect(kept.filter((b) => b.label !== ROUTINE_BACKUP_LABEL).map((b) => b.id)).toEqual(byHand);

        expect(await serverCalls("s-a").writeBackupSchedule({ schedule: null })).toBeNull();
        const off = JSON.parse(fs.readFileSync(configFile, "utf8"));
        expect(off.servers.find((s: { id: string }) => s.id === "s-a").backupSchedule).toBeUndefined();
    });
});
