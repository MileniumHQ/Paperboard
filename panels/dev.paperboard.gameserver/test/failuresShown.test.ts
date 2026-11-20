import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { problemsApi, processApi as rawProcess, type PanelProblem } from "@mileniumhq/paperapi";
import { processApi } from "../src/service/api";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer } from "./helpers/minecraft";
import { gameServer } from "./helpers/game";
import { freePort, installPalworld } from "./helpers/palworld";
import { PANEL_ID } from "../src/servers";
import { sendServerCommand, startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { tryListDirectory } from "../src/service/filesystem";
import { listLogFiles } from "../src/service/logs";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const INI = "saved/Config/LinuxServer/PalWorldSettings.ini";

// Failures are shown, not swallowed.
describe("failures are shown", () => {
    test("a console command or chat line sent while offline rejects and says so in the console and chat", async () => {
        const mc = minecraftServer();
        await expect(sendServerCommand(mc.server, "list")).rejects.toThrow("Cannot execute command: server is offline.");
        expect(mc.server.state.serverEntries.map((e) => [e.type, e.content])).toEqual([
            ["command", "list"],
            ["error", "Cannot execute command: server is offline."],
        ]);
        await expect(mc.server.game.sendChat!("hello")).rejects.toThrow("Cannot send message: server is offline.");
        expect(mc.server.state.chatMessages.map((m) => m.text)).toEqual(["Cannot send message: server is offline."]);
    });

    test("a folder that can't be listed says why, and is never shown as an empty one", async () => {
        const mc = minecraftServer({ files: { "logs/latest.log": "[12:00:00] Done\n" } });
        const logs = path.join(mc.dir, "logs");
        expect((await listLogFiles(mc.server)).map((file) => file.name)).toEqual(["latest.log"]);
        fs.chmodSync(logs, 0o000);
        try {
            await expect(listLogFiles(mc.server)).rejects.toThrow(/Could not list "logs\/": .*Permission denied/);
            expect((await tryListDirectory(mc.server, "logs")).error).toMatch(/Permission denied/);
        } finally {
            fs.chmodSync(logs, 0o700);
        }
        // a failure before the lister runs names its cause too
        expect((await tryListDirectory(mc.server, "../elsewhere")).error).toBe('Could not list "../elsewhere/": Unsafe directory name: "../elsewhere"');
    });

    test("a server that failed to start and then could not be ended says so in the console, and as the panel's problem", async () => {
        const server = gameServer("palworld", { settings: { port: await freePort(), restPort: await freePort() } });
        installPalworld(server.dir, { refuse: { info: "broken world" } });
        await server.server.game.initialize(false);
        const kill = rawProcess.kill;
        rawProcess.kill = (async () => { throw new Error("the supervisor did not answer"); }) as typeof kill;
        try {
            await startServerInstance(server.server);
            await server.server.waitFor((s) => s.serverEntries.some((e) => String(e.content).includes("could not be ended")), "the failed kill to be reported");
        } finally {
            rawProcess.kill = kill;
        }
        expect(server.server.state.serverEntries.map((e) => String(e.content))).toContain("[Paperboard] The server that failed to start could not be ended: the supervisor did not answer");
        // the console only shows while its page is open: Paperboard shows the problem by the panel's name
        let off = () => {};
        const problem = await new Promise<PanelProblem>((resolve, reject) => {
            off = problemsApi.watch(PANEL_ID, (problems) => {
                const found = problems.find((p) => p.title.endsWith(": The server that failed to start could not be ended"));
                if (found) resolve(found);
            }, reject);
        }).finally(() => off());
        expect(problem).toMatchObject({ title: `${server.server.name}: The server that failed to start could not be ended`, message: "the supervisor did not answer" });
        const exit = server.nextExit();
        await server.server.process.kill(server.server.game.primaryProcessId, "SIGKILL");
        await exit;
    });

    test("a Palworld settings file that can't be read when the server stops is reported in the console", async () => {
        const server = gameServer("palworld", { settings: { port: await freePort(), restPort: await freePort() } });
        installPalworld(server.dir);
        await server.server.game.initialize(false);
        await startServerInstance(server.server);
        await server.server.waitFor((s) => s.serverStatus === "online", "Palworld to answer its REST API");
        const ini = path.join(server.dir, ...INI.split("/"));
        fs.chmodSync(ini, 0o000);
        try {
            const exit = server.nextExit();
            await stopServerInstance(server.server);
            expect(await exit).toBe(0);
            await server.server.waitFor((s) => s.serverEntries.some((e) => e.content.startsWith("[Server] Could not clean up after the server stopped:")), "the failed cleanup to be reported");
        } finally {
            fs.chmodSync(ini, 0o600);
        }
        const line = server.server.state.serverEntries.find((e) => e.content.startsWith("[Server] Could not clean up"))!;
        expect(line.type).toBe("error");
        expect(line.content).toMatch(/EACCES|permission denied/i);
    });

});
