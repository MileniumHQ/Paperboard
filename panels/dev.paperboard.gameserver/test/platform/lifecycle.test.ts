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
const triggers = (mc: McServer, id: string) => mc.scope.triggers.filter((t) => t.id === id);

async function startOnline(mc: McServer): Promise<void> {
    await mc.run(() => startServerInstance(mc.scope.ctx));
    await mc.scope.waitFor((s) => s.serverStatus === "online", "the server to come online");
}

async function stopOffline(mc: McServer): Promise<void> {
    const exit = mc.nextExit();
    await mc.run(() => stopServerInstance(mc.scope.ctx));
    expect(await exit).toBe(0);
    expect(mc.scope.ctx.state.serverStatus).toBe("offline");
}

// Start, stop and restart do what they say.
describe("start, stop and restart", () => {
    test("Done flips starting to online once, even split across writes; stop ends the process and marks offline", async () => {
        const mc = minecraftServer({ files: { "fake-server.json": JSON.stringify({ splitDone: true }) } });
        await startOnline(mc);
        const statuses = mc.scope.history.map((s) => s.serverStatus).filter((s, i, all) => s !== all[i - 1]);
        expect(statuses).toEqual(["offline", "starting", "online"]);
        expect(triggers(mc, TRIGGER_IDS.serverStarted)).toHaveLength(1);
        // the Done line arrived in two chunks and is one console line
        const done = mc.scope.ctx.state.serverEntries.filter((e) => e.content.includes("Done (1.234s)!"));
        expect(done).toHaveLength(1);
        expect(done.map((e) => e.content)).toEqual([`[12:00:01] [Server thread/INFO]: Done (1.234s)! For help, type "help"`]);

        await stopOffline(mc);
        expect(mc.commands().at(-1)).toBe("stop");
        expect(triggers(mc, TRIGGER_IDS.serverStopped)).toHaveLength(1);
        expect(triggers(mc, TRIGGER_IDS.serverCrashed)).toHaveLength(0);
        expect(await mc.run(() => processApi.exists("mc-server"))).toBe(false);
    });

    test("restart stops the server and starts a fresh instance", async () => {
        const mc = minecraftServer();
        await startOnline(mc);
        const exit = mc.nextExit();
        await mc.run(() => restartServerInstance(mc.scope.ctx));
        expect(mc.scope.ctx.state.serverStatus).toBe("restarting");
        expect(await exit).toBe(0);
        await mc.scope.waitFor((s) => s.serverStatus === "online", "the restarted server to come online");
        const pids = runs(mc);
        expect(pids).toHaveLength(2);
        expect(pids[0]).not.toBe(pids[1]);
        expect(triggers(mc, TRIGGER_IDS.serverStarted)).toHaveLength(2);
        await stopOffline(mc);
    });

    test("a server that ignores stop is force-killed by one pending SIGKILL, and a clean exit cancels it", async () => {
        const mc = minecraftServer({ files: { "fake-server.json": JSON.stringify({ ignoreStop: true }) } });
        await startOnline(mc);
        await mc.run(() => stopServerInstance(mc.scope.ctx));
        expect(mc.scope.ctx.state.serverStatus).toBe("stopping");
        expect(mc.run(() => __lifecycleTest.isStopForceKillPending())).toBe(true);
        // a second stop reschedules the one force-kill rather than adding one
        mc.run(() => __lifecycleTest.scheduleStopForceKill(mc.scope.ctx, 600_000));
        expect(mc.run(() => __lifecycleTest.isStopForceKillPending())).toBe(true);
        // the server exits on its own: the pending kill goes
        const exit = mc.nextExit();
        await mc.run(() => processApi.write("mc-server", "crash 0\n"));
        expect(await exit).toBe(0);
        expect(mc.run(() => __lifecycleTest.isStopForceKillPending())).toBe(false);
        expect(mc.scope.ctx.state.serverStatus).toBe("offline");

        // the same server again, and this time the force-kill fires
        await startOnline(mc);
        await mc.run(() => stopServerInstance(mc.scope.ctx));
        const killed = mc.nextExit();
        mc.run(() => __lifecycleTest.scheduleStopForceKill(mc.scope.ctx, 0));
        const code = await killed;
        expect(code).not.toBe(0);
        await mc.scope.waitFor((s) => s.serverStatus === "offline", "the killed server to read offline");
        expect(await mc.run(() => processApi.exists("mc-server"))).toBe(false);
    });

    test("a stop the daemon refuses fails and keeps the status", async () => {
        // the console says online, but no process exists: the daemon refuses the write
        const mc = minecraftServer({ state: { serverStatus: "online" } });
        await expect(mc.run(() => stopServerInstance(mc.scope.ctx))).rejects.toThrow();
        expect(mc.scope.ctx.state.serverStatus).toBe("online");
        expect(mc.run(() => __lifecycleTest.isStopForceKillPending())).toBe(false);
    });

    test("a last line with no newline is flushed when the process exits, and the exit marks offline", async () => {
        const mc = minecraftServer({ files: { "fake-server.json": JSON.stringify({ exitBeforeDone: 3 }) } });
        const exit = mc.nextExit();
        await mc.run(() => startServerInstance(mc.scope.ctx));
        expect(await exit).toBe(3);
        const last = mc.scope.ctx.state.serverEntries.find((e) => e.content.includes("Failed to start the minecraft server"));
        expect(last).toBeDefined();
        expect(mc.scope.ctx.state.serverStatus).toBe("offline");
        expect(triggers(mc, TRIGGER_IDS.serverCrashed)).toEqual([{ id: TRIGGER_IDS.serverCrashed, output: 3 }]);
        expect(mc.scope.ctx.state.serverEntries.some((e) => e.content.includes("crashed while starting (exit code 3)"))).toBe(true);
    });
});

// Start, stop and restart do what they say. (TF2 RCON)
describe("TF2 RCON", () => {
    test("a dropped reply fails that command and the next one reconnects", async () => {
        const AUTH = 3;
        let connections = 0;
        const server = net.createServer((socket) => {
            const connection = ++connections;
            let buffer = Buffer.alloc(0);
            socket.on("data", (chunk) => {
                const decoded = decodePackets(Buffer.concat([buffer, chunk]));
                buffer = decoded.rest;
                for (const packet of decoded.packets) {
                    if (packet.type === AUTH) {
                        socket.write(encodePacket(packet.id, 0, ""));
                        socket.write(encodePacket(packet.body === "secret" ? packet.id : -1, 2, ""));
                    } else if (connection === 1) {
                        // the first connection never answers a command, as srcds does
                        // while it bans another client's bad RCON attempt
                    } else if (packet.body === "status") {
                        socket.write(encodePacket(packet.id, 0, "hostname: test\n"));
                    } else if (packet.body === "") {
                        socket.write(encodePacket(packet.id, 0, ""));
                    }
                }
            });
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as net.AddressInfo).port;
        try {
            const rcon = new SourceRcon(port, "secret", "TF2", 300);
            await expect(rcon.exec("status")).rejects.toThrow("did not finish answering over RCON");
            expect(await rcon.exec("status")).toBe("hostname: test\n");
            expect(connections).toBe(2);
            rcon.close();
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
