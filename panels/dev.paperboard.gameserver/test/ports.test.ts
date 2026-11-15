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
    Object.fromEntries((await portApi.list(PANEL_ID)).filter((c) => c.name.startsWith(`${mc.server.id}-`)).map((c) => [c.name.slice(mc.server.id.length + 1), c.port]));
const property = (mc: McServer, key: string) => fs.readFileSync(path.join(mc.dir, "server.properties"), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];

// Port conflicts are moved or refused and written where the server reads them.
describe("ports", () => {
    test("a taken Java port moves for that run only: the launch opens the free one, server.properties and the next start keep the chosen one", async () => {
        const held = await holdPort();
        const original = `#Minecraft server properties\nmotd=\\u00A7aHi\nserver-port=${held.port}\nmax-players=7\n`;
        const mc = minecraftServer({ files: { "server.properties": original } });
        const argv = () => JSON.parse(fs.readFileSync(path.join(mc.dir, "argv.json"), "utf8")) as string[];
        try {
            await startServerInstance(mc.server);
            await mc.server.waitFor((s) => s.serverStatus === "online", "the server to come online");
            const moved = (await claims(mc))[JAVA_PORT_NAME]!;
            expect(moved).toBeGreaterThan(held.port);
            expect(moved).toBeLessThanOrEqual(held.port + 100);
            // the server opens the free port, and the page says so while it runs
            expect(argv().slice(-2)).toEqual(["--port", String(moved)]);
            expect(mc.server.state.portMoves).toEqual([{ label: "Game Server (Java)", from: held.port, to: moved, primary: true }]);
            // the user's choice is never overwritten
            expect(fs.readFileSync(path.join(mc.dir, "server.properties"), "utf8")).toBe(original);
            expect(mc.server.state.serverPort).toBe(String(held.port));
            const exit = mc.nextExit();
            await stopServerInstance(mc.server);
            await exit;
            expect(mc.server.state.portMoves).toEqual([]);
        } finally {
            await held.release();
        }
        // the port is free again: the next run opens the chosen one
        await startServerInstance(mc.server);
        await mc.server.waitFor((s) => s.serverStatus === "online", "the server to come online again");
        expect(await claims(mc)).toEqual({ [JAVA_PORT_NAME]: held.port });
        expect(argv()).not.toContain("--port");
        expect(mc.server.state.portMoves).toEqual([]);
        const exit = mc.nextExit();
        await stopServerInstance(mc.server);
        await exit;
        expect(fs.readFileSync(path.join(mc.dir, "server.properties"), "utf8")).toBe(original);
    });

    test("under refuse, a taken Java port fails the start naming the port, and nothing is launched or written", async () => {
        const held = await holdPort();
        const original = `server-port=${held.port}\nmotd=x\n`;
        const mc = minecraftServer({ files: { "server.properties": original } });
        await portSettingsApi.setPolicy("refuse");
        try {
            await expect(startServerInstance(mc.server)).rejects.toThrow(`can't use port ${held.port}`);
        } finally {
            await portSettingsApi.setPolicy("next-free");
            await held.release();
        }
        expect(mc.server.state.serverStatus).toBe("offline");
        expect(mc.server.state.serverEntries.map((e) => e.content).join("\n")).toContain(`Game Server (Java) can't use port ${held.port}`);
        expect(fs.existsSync(path.join(mc.dir, "runs.log"))).toBe(false);
        expect(fs.readFileSync(path.join(mc.dir, "server.properties"), "utf8")).toBe(original);
        expect(await claims(mc)).toEqual({});
    });

    test("with Geyser installed its Bedrock and NetherNet ports are claimed; a taken one refuses the start and its config.yml is kept; removing Geyser releases them", async () => {
        const held = await holdPort();
        const config = fs.readFileSync(GEYSER_CONFIG, "utf8");
        const mc = minecraftServer({ software: "paper", files: { "server.properties": "server-port=25590\n", "plugins/Geyser-Spigot/config.yml": config } });
        fs.writeFileSync(path.join(mc.dir, "plugins", "Geyser.jar"), zipSync({ "plugin.yml": strToU8("name: Geyser-Spigot\nversion: 1\nmain: x.M\n") }));
        const geyser = () => fs.readFileSync(path.join(mc.dir, "plugins", "Geyser-Spigot", "config.yml"), "utf8");
        try {
            const run = await prepareServerPorts("paper", livePortDeps(mc.server));
            expect(run.moves).toEqual([]);
            const settled = geyser();
            expect(Object.keys(await claims(mc)).sort()).toEqual([BEDROCK_PORT_NAME, JAVA_PORT_NAME, NETHERNET_PORT_NAME].sort());
            expect(new Set(Object.values(await claims(mc))).size).toBe(3);

            // Geyser reads its port only from its config: it can't move for one run
            fs.writeFileSync(path.join(mc.dir, "plugins", "Geyser-Spigot", "config.yml"), settled.replace("  port: 19132\n", `  port: ${held.port}\n`));
            const before = geyser();
            await expect(prepareServerPorts("paper", livePortDeps(mc.server))).rejects.toThrow(`Game Server (Bedrock) can't use port ${held.port}`);
            expect(geyser()).toBe(before);

            fs.rmSync(path.join(mc.dir, "plugins", "Geyser.jar"));
            await prepareServerPorts("paper", livePortDeps(mc.server));
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
