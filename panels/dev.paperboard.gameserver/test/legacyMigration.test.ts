import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { actionsApi, backupApi, backupLocationsApi, processApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { installFakeJava } from "./helpers/fakeJava";
import { installPanel, restartService, servicesState, waitForFile } from "./helpers/installedPanel";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";

const dataDir = process.env.PAPERBOARD_DIR!;
// a v1 install kept one server in the panel's own folder and its settings at the config's top level
const legacyDir = path.join(dataDir, "files", PANEL_ID);
const configFile = path.join(dataDir, "configs", `${PANEL_ID}.json`);
const V1 = { configured: true, software: "paper", version: "1.21.1", ramGB: 3, dailyRestart: null };
const runs = () => fs.readFileSync(path.join(legacyDir, "runs.log"), "utf8").split("\n").filter(Boolean).map(Number);
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
    // started by hand below, once the v1 server is running, as an update finds it
    const manifest = path.join(dataDir, "panels", PANEL_ID, "manifest.json");
    fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, "utf8")), autostart: false }));
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(V1));
    writeTree(legacyDir, { "server.jar": "jar", "eula.txt": "eula=true\n", "world/level.dat": "the v1 world", "fake-server.json": JSON.stringify({ players: ["carol"] }) });
    installFakeJava(javaPackageFor("1.21.1")!, dataDir);
    daemon = await startTestDaemon();
});
afterAll(async () => {
    if (fs.existsSync(path.join(legacyDir, "runs.log"))) for (const pid of runs()) if (alive(pid)) process.kill(pid, "SIGKILL");
    await daemon?.stop();
});

// Game Server keeps servers, history and backups through restarts and migration.
describe("v1 migration", () => {
    test("a v1 config becomes the legacy server first, keeping its settings, running process and backup schedule; legacy actions still act on it", async () => {
        // what the v1 service left: its server running under the bare process id, a backup schedule on the panel
        await backupLocationsApi.setForPanel(PANEL_ID, "local");
        await backupApi.setSchedule(PANEL_ID, { everyHours: 12, keep: 5 });
        const java = path.join(dataDir, "packages", javaPackageFor("1.21.1")!, "bin", process.platform === "win32" ? "java.exe" : "java");
        await processApi.start({ id: "mc-server", command: java, args: ["-jar", "server.jar", "nogui"], cwd: legacyDir });
        await waitForFile(path.join(legacyDir, "runs.log"), (text) => text.trim().length > 0, "the v1 server to start");
        const [pid] = runs();

        await restartService();
        const saved = JSON.parse(fs.readFileSync(configFile, "utf8"));
        expect(saved).toMatchObject({ version: 2, legacyServer: saved.servers[0].id });
        expect(saved.servers).toHaveLength(1);
        expect(saved.servers[0]).toMatchObject({ game: "minecraft", directory: "", settings: V1 });

        const id = saved.servers[0].id as string;
        const legacy = await servicesState().waitFor(id, (s) => s.serverStatus === "online" && s.onlinePlayers.includes("carol"), "the legacy server online with its player");
        expect(legacy.ramAllocation).toBe(3);
        expect(runs()).toEqual([pid!]);
        expect((await backupApi.forSource(PANEL_ID, id).status()).schedule).toMatchObject({ everyHours: 12, keep: 5 });

        // an automation made before servers had projects calls the bare action
        await actionsApi.call(PANEL_ID, "run-command", { command: "say from an old flow" });
        await waitForFile(path.join(legacyDir, "commands.log"), (text) => text.includes("say from an old flow"), "the legacy action to reach the server");
        // and the server's own project acts on the same server
        await actionsApi.call(PANEL_ID, `${id}/run-command`, { command: "say from its project" });
        await waitForFile(path.join(legacyDir, "commands.log"), (text) => text.includes("say from its project"), "the project action to reach the server");
        expect(fs.readFileSync(path.join(legacyDir, "world", "level.dat"), "utf8")).toBe("the v1 world");

        await actionsApi.call(PANEL_ID, `${id}/stop-server`, {});
        await servicesState().waitFor(id, (s) => s.serverStatus === "offline", "the legacy server to stop");
    });
});
