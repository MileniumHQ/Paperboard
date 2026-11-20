// Settings saved at once from different parts of the panel all stay saved.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { writeTree } from "./helpers/tmp";
import { serverCalls } from "./helpers/serverCall";
import { PANEL_ID } from "../src/servers";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const configFile = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const settings = () => JSON.parse(fs.readFileSync(configFile(), "utf8")).servers[0].settings as Record<string, any>;

async function setUp() {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
    writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc"), { "server.jar": "jar", "eula.txt": "eula=true\n" });
    const { gameServerService } = await import("../src/service");
    await gameServerService.ready;
}

describe("settings saved at once", () => {
    test("from different parts of the panel all stay saved", async () => {
        await setUp();
        // the server is stopped, so each gamerule edit is kept for its next start
        await Promise.all([
            serverCalls("s-mc").writeAutomation({ patch: { dailyRestart: "04:00" } }),
            serverCalls("s-mc").setGamerule({ name: "keep_inventory", value: "true" }),
            serverCalls("s-mc").writeGameOptions({ patch: { ramGB: 3 } }),
        ]);
        expect(settings().automation.dailyRestart).toBe("04:00");
        expect(settings().pendingGamerules).toEqual({ keep_inventory: "true" });
        expect(settings().ramGB).toBe(3);
    });
});
