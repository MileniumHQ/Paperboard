import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { serviceApi, backupApi, backupLocationsApi } from "@mileniumhq/paperapi";
import { callServer } from "./helpers/serverCall";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { installFakeJava } from "./helpers/fakeJava";
import { installPanel, restartService, servicesState, waitForFile } from "./helpers/installedPanel";
import { readTree, writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";

const SERVERS = "servers-0123456789ab";
const dataDir = process.env.PAPERBOARD_DIR!;
const filesRoot = path.join(dataDir, "files", PANEL_ID, SERVERS);
const serverDir = (id: string) => path.join(filesRoot, id);
const historyFile = (id: string) => path.join(filesRoot, "history", `${id}.json`);
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
const call = <T = unknown>(name: string, input: unknown = {}) => serviceApi.call<T>(PANEL_ID, name, input, { timeoutMs: null });

let daemon: TestDaemon;
beforeAll(async () => {
    installPanel(dataDir);
    fs.mkdirSync(path.join(dataDir, "configs"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "configs", `${PANEL_ID}.json`), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [stored("s-a"), stored("s-b")] }));
    for (const id of ["s-a", "s-b"]) writeTree(serverDir(id), { "server.jar": "jar", "eula.txt": "eula=true\n", "world/level.dat": `${id} world` });
    writeTree(serverDir("s-a"), { "fake-server.json": JSON.stringify({ players: ["alice", "bob"], maxPlayers: 10 }) });
    installFakeJava(javaPackageFor("1.21.1")!, dataDir);
    daemon = await startTestDaemon();
    // the daemon started the installed service; this waits for one that is ready
    await restartService();
});
afterAll(async () => {
    // no stand-in this file started outlives it
    for (const pid of [...runs("s-a"), ...runs("s-b")]) if (alive(pid)) process.kill(pid, "SIGKILL");
    await daemon?.stop();
});

// Game Server keeps servers, history and backups through restarts and migration.
describe("servers through restarts", () => {
    test("a server running when the service starts again is shown online with its players and its console history", async () => {
        const state = servicesState();
        await callServer("s-a", "start-server");
        const before = await state.waitFor("s-a", (s) => s.serverStatus === "online" && s.onlinePlayers.length === 2, "s-a online with its players");
        expect(Date.now() - before.onlineSince!).toBeLessThan(60_000);
        await callServer("s-a", "run-command", { command: "say before the restart" });
        await state.waitFor("s-a", (s) => s.serverEntries.some((e) => e.content.includes("[Server] before the restart")), "the command's echo");
        // the console is kept on disk for the next service, with when the server came online
        await waitForFile(historyFile("s-a"), (text) => text.includes("[Server] before the restart") && text.includes(`"onlineSince":${before.onlineSince}`), "the console history to be saved");
        const [pid] = runs("s-a");

        await restartService();
        const after = await state.waitFor("s-a", (s) => s.serverStatus === "online" && s.onlinePlayers.length === 2, "s-a online again after the restart");
        expect(after.onlinePlayers.sort()).toEqual(["alice", "bob"]);
        // its uptime carries on from its start, not from the service's
        expect(after.onlineSince).toBe(before.onlineSince);
        expect(after.serverEntries.map((e) => e.content)).toContain("[12:00:00] [Server thread/INFO]: [Server] before the restart");
        // the same process: adopted, not started again
        expect(runs("s-a")).toEqual([pid!]);
        expect(alive(pid!)).toBe(true);
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
        await callServer("s-a", "stop-server");
        await state.waitFor("s-a", (s) => s.serverStatus === "offline", "s-a to stop");
    });

    test("each server is its own backup source: restoring one touches only that server, and removing a server keeps its world", async () => {
        await backupLocationsApi.setForPanel(PANEL_ID, "local", undefined, "s-a");
        const a = backupApi.forSource(PANEL_ID, "s-a");
        const backup = await a.create({ label: "before" });
        expect((await a.list()).map((b) => b.id)).toEqual([backup.id]);
        // s-b is a source of its own: s-a's location is not its
        expect((await backupApi.forSource(PANEL_ID, "s-b").status()).location).toBeNull();
        await expect(backupApi.forSource(PANEL_ID, "s-b").list()).rejects.toThrow("No backup location chosen for this panel");

        fs.writeFileSync(path.join(serverDir("s-a"), "world", "level.dat"), "s-a changed");
        fs.writeFileSync(path.join(serverDir("s-b"), "world", "level.dat"), "s-b changed");
        await a.restore(backup.id);
        expect(fs.readFileSync(path.join(serverDir("s-a"), "world", "level.dat"), "utf8")).toBe("s-a world");
        expect(fs.readFileSync(path.join(serverDir("s-b"), "world", "level.dat"), "utf8")).toBe("s-b changed");

        const before = readTree(serverDir("s-b"));
        expect(await call("remove-server", { server: "s-b" })).toEqual({ removed: "s-b" });
        expect(readTree(serverDir("s-b"))).toEqual(before);
        const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "configs", `${PANEL_ID}.json`), "utf8"));
        expect(saved.servers.map((s: { id: string }) => s.id)).toEqual(["s-a"]);
    });
});
