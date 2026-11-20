import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { processApi as rawProcess } from "@mileniumhq/paperapi";
import { serverCalls } from "./helpers/serverCall";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { installFakeJava } from "./helpers/fakeJava";
import { openPage, servePanel } from "./helpers/browser";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";

const SERVERS = "servers-0123456789ab";
let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
    const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-eula", name: "s-eula", game: "minecraft", directory: `${SERVERS}/s-eula`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
    writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-eula"), { "server.jar": "jar", "eula.txt": "eula=false\n", "fake-server.json": JSON.stringify({ eulaHold: "release-eula" }) });
    installFakeJava(javaPackageFor("1.21.1")!, daemon.dataDir);
    const { gameServerService } = await import("../src/service");
    await gameServerService.ready;
});
afterAll(async () => {
    await daemon?.stop();
});

// Accept EULA & Launch starts the server only once the start that needed it has ended.
describe("the server issue repairs", () => {
    test("Accept EULA & Launch starts the server once the start that needed it has ended", async () => {
        const dir = path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-eula");
        const served = await servePanel(daemon);
        const nextExit = () => new Promise<void>((resolve) => rawProcess.onExit("s-eula-mc-server", () => resolve()));
        const refused = nextExit();
        await serverCalls("s-eula").startServer();
        const page = await openPage(`${served.url}/?server=s-eula`);
        try {
            await page.waitFor(`document.body.innerText.includes("EULA Agreement Required")`, "the EULA to be asked for");
            // the page's short waits end at once: a repair that waited a guessed
            // while for the refused start to end would start while it still runs
            await page.evaluate(`(() => { const later = window.setTimeout; window.setTimeout = (fn, ms, ...args) => later(fn, ms < 1000 ? 0 : ms, ...args); })()`);
            await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.includes("Accept EULA")).dataset.test = "accept"`);
            await page.click('button[data-test="accept"]');
            await page.waitFor(`!document.querySelector("[role=dialog]")`, "the issue to close");
            await page.settled();
            expect(fs.readFileSync(path.join(dir, "eula.txt"), "utf8")).toBe("eula=true\n");
            // the refused start ends only now
            fs.writeFileSync(path.join(dir, "release-eula"), "");
            await refused;
            await page.waitFor(`document.body.innerText.includes("ONLINE")`, "the server to start once the refused start ended");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            const stopped = nextExit();
            await serverCalls("s-eula").stopServer();
            if (fs.readFileSync(path.join(dir, "runs.log"), "utf8").trim().split("\n").length > 1) await stopped;
            served.stop();
        }
    }, 60_000);
});
