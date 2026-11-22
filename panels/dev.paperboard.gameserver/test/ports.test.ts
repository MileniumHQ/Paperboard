import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { PANEL_ID } from "../src/servers";
import { portApi } from "../src/service/api";
import { sendServerCommand, startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { readGameOptions } from "../src/games/minecraft/gameOptions";
import { JAVA_PORT_NAME } from "../src/core/portNames";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

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

// Port conflicts are moved for the run while preserving the user's chosen port.
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
            expect(mc.server.state.portMoves).toEqual([{ label: "Minecraft", from: held.port, to: moved, primary: true }]);
            expect(mc.server.state.serverPort).toBe(String(held.port));
            // the server saved the run's port into the file, as Paper does; Options still says the chosen one
            expect(property(mc, "server-port")).toBe(String(moved));
            expect((await readGameOptions(mc.server))["server-port"]).toBe(held.port);
            // and saves it again with its settings mid-run
            await sendServerCommand(mc.server, "whitelist on");
            await mc.server.waitFor((s) => s.serverEntries.some((e) => String(e.content).includes("Whitelist is now turned on")), "the server to save its settings");
            expect(property(mc, "server-port")).toBe(String(moved));
            await stop();
            expect(mc.server.state.portMoves).toEqual([]);
            // the user's choice is back, beside every other key, once the stop has settled the server's files
            expect((await readGameOptions(mc.server))["server-port"]).toBe(held.port);
            expect([property(mc, "server-port"), property(mc, "motd"), property(mc, "max-players"), property(mc, "white-list")]).toEqual([String(held.port), "\\u00A7aHi", "7", "true"]);

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
});
