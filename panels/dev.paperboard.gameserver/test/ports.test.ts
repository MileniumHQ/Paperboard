import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { portSettingsApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { PANEL_ID, createServerId } from "../src/servers";
import { portApi } from "../src/service/api";
import { livePortDeps } from "../src/service/portDeps";
import { prepareServerPorts } from "../src/service/ports";
import { startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { BEDROCK_PORT_NAME, JAVA_PORT_NAME, NETHERNET_PORT_NAME, serverPortName } from "../src/core/portNames";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const GEYSER_CONFIG = path.join(import.meta.dir, "fixtures", "crossplay", "paper", "plugins", "Geyser-Spigot", "config.yml");

/** a TCP port this test holds on loopback, as another program would; the registry's probe binds every interface, so it collides */
async function holdPort(): Promise<{ port: number; release: () => Promise<void> }> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        port: (server.address() as net.AddressInfo).port,
        release: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
}

const claims = async (mc: McServer) =>
    Object.fromEntries((await mc.run(() => portApi.list(PANEL_ID))).filter((c) => c.name.startsWith(`${mc.scope.server.id}-`)).map((c) => [c.name.slice(mc.scope.server.id.length + 1), c.port]));
const property = (mc: McServer, key: string) => fs.readFileSync(path.join(mc.dir, "server.properties"), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];

// Port conflicts are moved or refused and written where the server reads them.
describe("ports", () => {
    test("a taken Java port moves to a free one under next-free, written into server.properties with every other key kept", async () => {
        const held = await holdPort();
        try {
            const mc = minecraftServer({ files: { "server.properties": `#Minecraft server properties\nmotd=\\u00A7aHi\nserver-port=${held.port}\nmax-players=7\n` } });
            await mc.run(() => startServerInstance(mc.scope.ctx));
            await mc.scope.waitFor((s) => s.serverStatus === "online", "the server to come online");
            const moved = Number(property(mc, "server-port"));
            expect(moved).toBeGreaterThan(held.port);
            expect(moved).toBeLessThanOrEqual(held.port + 100);
            expect(await claims(mc)).toEqual({ [JAVA_PORT_NAME]: moved });
            expect(mc.scope.ctx.state.serverEntries.map((e) => e.content)).toContain(`[Server] Port ${held.port} is taken, so Game Server (Java) uses ${moved}.`);
            expect([property(mc, "motd"), property(mc, "max-players")]).toEqual(["\\u00A7aHi", "7"]);
            const exit = mc.nextExit();
            await mc.run(() => stopServerInstance(mc.scope.ctx));
            await exit;
        } finally {
            await held.release();
        }
    });

    test("under refuse, a taken Java port fails the start naming the port, and nothing is launched or written", async () => {
        const held = await holdPort();
        const original = `server-port=${held.port}\nmotd=x\n`;
        const mc = minecraftServer({ files: { "server.properties": original } });
        await portSettingsApi.setPolicy("refuse");
        try {
            await mc.run(() => startServerInstance(mc.scope.ctx));
        } finally {
            await portSettingsApi.setPolicy("next-free");
            await held.release();
        }
        expect(mc.scope.ctx.state.serverStatus).toBe("offline");
        expect(mc.scope.ctx.state.serverEntries.map((e) => e.content).join("\n")).toContain(`Game Server (Java) can't use port ${held.port}`);
        expect(fs.existsSync(path.join(mc.dir, "runs.log"))).toBe(false);
        expect(fs.readFileSync(path.join(mc.dir, "server.properties"), "utf8")).toBe(original);
        expect(await claims(mc)).toEqual({});
    });

    test("with Geyser installed its Bedrock and NetherNet ports are claimed and moves written to its config.yml; removing Geyser releases them", async () => {
        const held = await holdPort();
        const config = fs.readFileSync(GEYSER_CONFIG, "utf8").replace("  port: 19132\n", `  port: ${held.port}\n`);
        const mc = minecraftServer({
            software: "paper",
            // Java asks for the same taken port, so all three move
            files: { "server.properties": `server-port=${held.port}\n`, "plugins/Geyser-Spigot/config.yml": config },
        });
        fs.writeFileSync(path.join(mc.dir, "plugins", "Geyser.jar"), zipSync({ "plugin.yml": strToU8("name: Geyser-Spigot\nversion: 1\nmain: x.M\n") }));
        const geyser = () => fs.readFileSync(path.join(mc.dir, "plugins", "Geyser-Spigot", "config.yml"), "utf8");
        try {
            const moves = await mc.run(() => prepareServerPorts("paper", livePortDeps()));
            const claimed = await claims(mc);
            expect(Object.keys(claimed).sort()).toEqual([BEDROCK_PORT_NAME, JAVA_PORT_NAME, NETHERNET_PORT_NAME].sort());
            expect(claimed[BEDROCK_PORT_NAME]).toBeGreaterThan(held.port);
            expect(new Set(Object.values(claimed)).size).toBe(3);
            // the file says what was claimed, so Geyser opens the ports it was given
            expect(geyser()).toContain(`\n  port: ${claimed[BEDROCK_PORT_NAME]}\n`);
            expect(geyser()).toContain(`\n  webrtc-port: ${claimed[NETHERNET_PORT_NAME]}\n`);
            expect(geyser()).toContain("\n  transport: both\n");
            expect(moves.map((m) => [m.label, m.from])).toContainEqual(["Game Server (Bedrock)", held.port]);

            fs.rmSync(path.join(mc.dir, "plugins", "Geyser.jar"));
            await mc.run(() => prepareServerPorts("paper", livePortDeps()));
            expect(Object.keys(await claims(mc))).toEqual([JAVA_PORT_NAME]);
        } finally {
            await held.release();
        }
    });

    test("every port name a created server gets is one papercrane accepts", async () => {
        for (let i = 0; i < 20; i++) {
            const id = createServerId();
            for (const name of [JAVA_PORT_NAME, BEDROCK_PORT_NAME, NETHERNET_PORT_NAME]) {
                const full = serverPortName(id, false, name);
                const claim = await portApi.claim(PANEL_ID, { name: full, label: "Name check", protocol: "udp", preferred: 40000 + i });
                expect(claim.name).toBe(full);
                await portApi.release(PANEL_ID, full);
            }
        }
        // the one legacy server keeps the bare names it always had
        expect(serverPortName("s-abc", true, JAVA_PORT_NAME)).toBe(JAVA_PORT_NAME);
    });
});
