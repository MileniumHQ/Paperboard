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

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";

// A repair that fails says why, and a server that could not be set up offers setting it up again.
describe("the server issue repairs", () => {
    test("a port conflict's Kill Process & Retry that could not look up the port shows the service's reason", async () => {
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-mc", name: "s-mc", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }, { id: "s-bad", name: "Broken", game: "minecraft", directory: `${SERVERS}/s-bad`, createdAt: 0, settings: {} }, { id: "s-eula", name: "s-eula", game: "minecraft", directory: `${SERVERS}/s-eula`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
        writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-eula"), { "server.jar": "jar", "eula.txt": "eula=false\n", "fake-server.json": JSON.stringify({ eulaHold: "release-eula" }) });
        writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc"), { "server.jar": "jar", "eula.txt": "eula=true\n", "fake-server.json": "{}" });
        // s-bad can't be set up: a file stands where its folder goes
        fs.writeFileSync(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-bad"), "not a folder");
        installFakeJava(javaPackageFor("1.21.1")!, daemon.dataDir);
        // the lookup of what holds the port fails the way a missing or refused lsof does
        const run = rawProcess.run;
        rawProcess.run = (async (options: Parameters<typeof run>[0]) =>
            options.command === "lsof" ? { exitCode: 2, stdout: "", stderr: "" } : run(options)) as typeof run;
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
        const served = await servePanel(daemon);
        const exited = new Promise<void>((resolve) => rawProcess.onExit("s-mc-mc-server", () => resolve()));
        await serverCalls("s-mc").startServer();
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await page.waitFor(`document.body.innerText.includes("ONLINE")`, "the server to show online");
            // the server says its port is taken
            await page.type('input[placeholder="Enter command..."]', "say FAILED TO BIND TO PORT", true);
            await page.waitFor(`document.body.innerText.includes("Port Conflict Detected")`, "the port conflict to be shown");
            await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.includes("Kill Process")).dataset.test = "kill"`);
            await page.click('button[data-test="kill"]');
            await page.waitFor(`document.body.innerText.includes("Repair failed")`, "the failed repair to be shown");
            expect(await page.evaluate<string>("document.body.innerText")).toMatch(/Could not look up the process on port \d+ \(lsof exited 2\)/);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            rawProcess.run = run;
            await serverCalls("s-mc").stopServer();
            await exited;
            served.stop();
        }
    });

    test("a server that could not be set up says why and sets itself up again from its Overview", async () => {
        const served = await servePanel(daemon);
        const page = await openPage(`${served.url}/?server=s-bad`);
        const button = (label: string) => `[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)})`;
        try {
            await page.waitFor(`document.body.innerText.includes("This server could not be set up")`, "the setup failure on the Overview");
            expect(await page.evaluate<string>("document.body.innerText")).toContain("EEXIST");
            expect(await page.evaluate<string>("document.body.innerText")).not.toContain("needs cleaning up");
            fs.rmSync(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-bad"));
            await page.evaluate(`${button("Try again")}.click()`);
            await page.waitFor(`!document.body.innerText.includes("This server could not be set up")`, "the notice to go once it is set up");
            expect(fs.statSync(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-bad")).isDirectory()).toBe(true);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

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
