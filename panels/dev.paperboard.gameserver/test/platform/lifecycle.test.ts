import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "../helpers/crane";
import { minecraftServer, type McServer } from "../helpers/minecraft";
import {
    __lifecycleTest,
    restartServerInstance,
    startServerInstance,
    stopServerInstance,
} from "../../src/service/lifecycle";
import { processApi } from "../../src/service/api";
import { TRIGGER_IDS } from "../../src/service/contract";
import { decodePackets, encodePacket, SourceRcon } from "../../src/games/source/rcon";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const runs = (mc: McServer) => fs.readFileSync(path.join(mc.dir, "runs.log"), "utf8").split("\n").filter(Boolean);
const triggers = (mc: McServer, id: string) => mc.server.triggers.filter((t) => t.id === id);

async function startOnline(mc: McServer): Promise<void> {
    await startServerInstance(mc.server);
    await mc.server.waitFor((s) => s.serverStatus === "online", "the server to come online");
}

async function stopOffline(mc: McServer): Promise<void> {
    const exit = mc.nextExit();
    await stopServerInstance(mc.server);
    expect(await exit).toBe(0);
    expect(mc.server.state.serverStatus).toBe("offline");
}

// Start, stop and restart do what they say.
describe("start, stop and restart", () => {
    test("Done flips starting to online once, even split across writes; stop ends the process and marks offline", async () => {
        const mc = minecraftServer({ files: { "fake-server.json": JSON.stringify({ splitDone: true }) } });
        await startOnline(mc);
        const statuses = mc.server.states.map((s) => s.serverStatus).filter((s, i, all) => s !== all[i - 1]);
        expect(statuses).toEqual(["offline", "starting", "online"]);
        expect(triggers(mc, TRIGGER_IDS.serverStarted)).toHaveLength(1);
        // the Done line arrived in two chunks and is one console line
        const done = mc.server.state.serverEntries.filter((e) => e.content.includes("Done (1.234s)!"));
        expect(done).toHaveLength(1);
        expect(done.map((e) => e.content)).toEqual([`[12:00:01] [Server thread/INFO]: Done (1.234s)! For help, type "help"`]);

        await stopOffline(mc);
        expect(mc.commands().at(-1)).toBe("stop");
        expect(triggers(mc, TRIGGER_IDS.serverStopped)).toHaveLength(1);
        expect(triggers(mc, TRIGGER_IDS.serverCrashed)).toHaveLength(0);
        expect(await mc.server.process.exists("mc-server")).toBe(false);
    });

    test("a server that ignores stop is force-killed by one pending SIGKILL, and a clean exit cancels it", async () => {
        const mc = minecraftServer({ files: { "fake-server.json": JSON.stringify({ ignoreStop: true }) } });
        await startOnline(mc);
        await stopServerInstance(mc.server);
        expect(mc.server.state.serverStatus).toBe("stopping");
        expect(__lifecycleTest.isStopForceKillPending(mc.server)).toBe(true);
        // a second stop reschedules the one force-kill rather than adding one
        __lifecycleTest.scheduleStopForceKill(mc.server, 600_000);
        expect(__lifecycleTest.isStopForceKillPending(mc.server)).toBe(true);
        // the server exits on its own: the pending kill goes
        const exit = mc.nextExit();
        await mc.server.process.write("mc-server", "crash 0\n");
        expect(await exit).toBe(0);
        expect(__lifecycleTest.isStopForceKillPending(mc.server)).toBe(false);
        expect(mc.server.state.serverStatus).toBe("offline");

        // the same server again, and this time the force-kill fires
        await startOnline(mc);
        await stopServerInstance(mc.server);
        const killed = mc.nextExit();
        __lifecycleTest.scheduleStopForceKill(mc.server, 0);
        const code = await killed;
        expect(code).not.toBe(0);
        await mc.server.waitFor((s) => s.serverStatus === "offline", "the killed server to read offline");
        expect(await mc.server.process.exists("mc-server")).toBe(false);
    });

    test("a server that quits before its stop is acknowledged leaves no force-kill behind for its next run", async () => {
        const mc = minecraftServer();
        // the stop is answered only once the process is gone, as a fast server's SIGINT can be
        const stop = mc.server.game.stop.bind(mc.server.game);
        mc.server.game.stop = async () => { const exit = mc.nextExit(); await stop(); await exit; };
        for (const end of [stopServerInstance, restartServerInstance]) {
            await startOnline(mc);
            await end(mc.server);
            expect(__lifecycleTest.isStopForceKillPending(mc.server)).toBe(false);
        }
        await mc.server.waitFor((s) => s.serverStatus === "online", "the restart to come online");
        expect(mc.server.state.serverEntries.filter((e) => e.content.includes("Graceful stop timed out"))).toHaveLength(0);
        mc.server.game.stop = stop;
        await stopOffline(mc);
    });

    test("a force-killed restart comes back and stays online, and a server still running after a force-kill is never called offline", async () => {
        const mc = minecraftServer({ files: { "fake-server.json": JSON.stringify({ ignoreStop: true }) } });
        await startOnline(mc);
        await restartServerInstance(mc.server);
        const killed = mc.nextExit();
        __lifecycleTest.scheduleStopForceKill(mc.server, 0);
        expect(await killed).not.toBe(0);
        await mc.server.waitFor((s) => s.serverStatus === "online", "the force-killed restart to come online");
        // the exit ended the force-kill: nothing is left to write over the new instance
        expect(__lifecycleTest.isStopForceKillPending(mc.server)).toBe(false);
        expect(runs(mc)).toHaveLength(2);
        // a force-kill that finds the server process still there says so, and leaves it online to stop again
        await __lifecycleTest.confirmForceKill(mc.server);
        expect(mc.server.state.serverStatus).toBe("online");
        expect(mc.server.state.serverEntries.at(-1)?.content).toBe("[Server] Could not confirm the force-kill: the process is still running.");
        expect(mc.server.state.serverEntries.filter((e) => e.content === "[Server] Process stopped.")).toHaveLength(0);

        await stopServerInstance(mc.server);
        const stopped = mc.nextExit();
        __lifecycleTest.scheduleStopForceKill(mc.server, 0);
        await stopped;
        await mc.server.waitFor((s) => s.serverStatus === "offline", "the killed server to read offline");
        expect(mc.server.state.serverEntries.filter((e) => e.content === "[Server] Process stopped.")).toHaveLength(1);
    });

});

// Start, stop and restart do what they say. (TF2 RCON)
describe("TF2 RCON", () => {
});
