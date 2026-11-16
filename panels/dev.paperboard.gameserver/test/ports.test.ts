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
import { sendServerCommand, startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { readGameOptions } from "../src/games/minecraft/gameOptions";
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
    test("a taken Java port moves for that run only, though the server saves it into server.properties: Options, the stop and the next start keep the chosen one", async () => {
        const held = await holdPort();
        const original = `#Minecraft server properties\nmotd=\\u00A7aHi\nserver-port=${held.port}\nmax-players=7\n`;
        const mc = minecraftServer({ software: "paper", files: { "server.properties": original } });
        const argv = () => JSON.parse(fs.readFileSync(path.join(mc.dir, "argv.json"), "utf8")) as string[];
        const run = async (what: string) => {
            await startServerInstance(mc.server);
            await mc.server.waitFor((s) => s.serverStatus === "online", what);
            return (await claims(mc))[JAVA_PORT_NAME]!;
        };
        const stop = async () => {
            const exit = mc.nextExit();
            await stopServerInstance(mc.server);
            await exit;
        };
        try {
            const moved = await run("the server to come online");
            expect(moved).toBeGreaterThan(held.port);
            expect(moved).toBeLessThanOrEqual(held.port + 100);
            // the server opens the free port, and the page says so while it runs
            expect(argv().slice(-2)).toEqual(["--port", String(moved)]);
            expect(mc.server.state.portMoves).toEqual([{ label: "Game Server (Java)", from: held.port, to: moved, primary: true }]);
            expect(mc.server.state.serverPort).toBe(String(held.port));
            // the server saved the run's port into the file, as Paper does; Options still says the chosen one
            expect(property(mc, "server-port")).toBe(String(moved));
            expect((await readGameOptions(mc.server))["server-port"]).toBe(held.port);
            // and saves it again with its settings mid-run
            await sendServerCommand(mc.server, "whitelist off");
            await mc.server.waitFor((s) => s.serverEntries.some((e) => String(e.content).includes("Whitelist is now turned off")), "the server to save its settings");
            expect(property(mc, "server-port")).toBe(String(moved));
            await stop();
            expect(mc.server.state.portMoves).toEqual([]);
            // the user's choice is back, beside every other key, once the stop has settled the server's files
            expect((await readGameOptions(mc.server))["server-port"]).toBe(held.port);
            expect([property(mc, "server-port"), property(mc, "motd"), property(mc, "max-players"), property(mc, "white-list")]).toEqual([String(held.port), "\\u00A7aHi", "7", "false"]);

            // still taken: the next start asks for the chosen port again, and moves again
            expect(await run("the server to come online on a moved port again")).toBeGreaterThan(held.port);
            expect(mc.server.state.portMoves).toEqual([expect.objectContaining({ from: held.port, primary: true })]);
            await stop();
        } finally {
            await held.release();
        }
        // the port is free again: the next run opens the chosen one
        expect(await run("the server to come online on its own port")).toBe(held.port);
        expect(argv()).not.toContain("--port");
        expect(mc.server.state.portMoves).toEqual([]);
        await stop();
        await mc.server.lifecycle.released;
        expect(property(mc, "server-port")).toBe(String(held.port));
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
