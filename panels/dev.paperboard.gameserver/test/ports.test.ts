// The server's ports through Paperboard's real port registry, on real files
// and real sockets: a port another program holds is moved in the file the
// server reads, or refused when the user's setting says so, and the Bedrock
// port is claimed only while Geyser is installed.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { parseProperties } from "../src/core/properties";
import { claimBedrockPort, prepareServerPorts, type PortDeps } from "../src/service/ports";
import { readCrossplay } from "../src/service/crossplay";
import { writeSchemaSetting } from "../src/service/loaderSettings";
import { CROSSPLAY, crossplaySetting, BEDROCK_PORT_SETTING_ID } from "../src/software/crossplay";
import { PANEL_ID } from "../src/service/types";

const FIXTURES = path.join(import.meta.dir, "fixtures", "crossplay");
const dirs: string[] = [];
const servers: net.Server[] = [];
const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-ports-home-"));
let PortRegistry: typeof import("../../../apps/paperboard/papercrane/ports").PortRegistry;

beforeAll(async () => {
    // the daemon's logger picks its folder on import: never the real ~/.paperboard
    process.env.PAPERBOARD_DIR = home;
    ({ PortRegistry } = await import("../../../apps/paperboard/papercrane/ports"));
});

afterEach(async () => {
    for (const server of servers.splice(0)) await new Promise((r) => server.close(r));
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

function tempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
}

/** another program holding a TCP port */
async function occupy(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen({ port: 0, host: "0.0.0.0" }, resolve));
    servers.push(server);
    return (server.address() as net.AddressInfo).port;
}

function setup(policy: "refuse" | "next-free", options: { geyser?: boolean; javaPort?: number } = {}) {
    const root = tempDir("pb-ports-server-");
    if (options.geyser) {
        fs.cpSync(path.join(FIXTURES, "paper"), root, { recursive: true });
        const zipped = zipSync({ "plugin.yml": strToU8("name: Geyser-Spigot\nversion: 2.12.1\nmain: x.Y\n") });
        fs.writeFileSync(path.join(root, "plugins", "Geyser-Spigot.jar"), zipped);
    }
    if (options.javaPort) fs.writeFileSync(path.join(root, "server.properties"), `motd=Hi\nserver-port=${options.javaPort}\n`);
    const registry = new PortRegistry(tempDir("pb-ports-data-"));
    const deps: PortDeps = {
        serverDir: async () => root,
        ports: {
            claim: (request) => registry.claim(PANEL_ID, request),
            prepare: (name) => registry.prepare(PANEL_ID, name),
            release: (name) => registry.release(PANEL_ID, name),
        },
    };
    return { root, registry, deps, ready: registry.setPolicy(policy) };
}

const javaPortIn = (root: string) => parseProperties(fs.readFileSync(path.join(root, "server.properties"), "utf8"))["server-port"];

describe("starting the server", () => {
    test("a Java port another program holds is moved, and the move is written into server.properties", async () => {
        const busy = await occupy();
        const { root, registry, deps, ready } = setup("next-free", { javaPort: busy });
        await ready;
        const moves = await prepareServerPorts("paper", deps);
        const moved = registry.list(PANEL_ID)[0]!.port;
        expect(moved).toBeGreaterThan(busy);
        expect(moves).toEqual([{ label: "Game Server (Java)", from: busy, to: moved }]);
        expect(javaPortIn(root)).toBe(String(moved));
        expect(fs.readFileSync(path.join(root, "server.properties"), "utf8")).toContain("motd=Hi");
    });

    test("with refuse, the start fails naming why, and server.properties is untouched", async () => {
        const busy = await occupy();
        const { root, deps, ready } = setup("refuse", { javaPort: busy });
        await ready;
        await expect(prepareServerPorts("paper", deps)).rejects.toThrow(
            `Game Server (Java) can't use port ${busy}: another program on this computer is using it.`,
        );
        expect(javaPortIn(root)).toBe(String(busy));
    });

    test("the Bedrock port is claimed for TCP and UDP while Geyser is installed, and moved into Geyser's config", async () => {
        const busy = await occupy();
        const { root, registry, deps, ready } = setup("next-free", { geyser: true });
        await ready;
        await writeSchemaSetting(CROSSPLAY.paper!.schema, crossplaySetting(BEDROCK_PORT_SETTING_ID)!, String(busy), { serverDir: async () => root });

        await prepareServerPorts("paper", deps);
        const bedrock = registry.list(PANEL_ID).find((claim) => claim.name === "bedrock")!;
        expect(bedrock.protocol).toBe("tcp+udp");
        expect(bedrock.port).toBeGreaterThan(busy);
        const shown = (await readCrossplay("paper", { serverDir: async () => root })).groups
            .flatMap((group) => group.settings)
            .find((setting) => setting.id === BEDROCK_PORT_SETTING_ID)!.value;
        expect(shown).toBe(String(bedrock.port));
    });

    test("without Geyser the Bedrock port is given back", async () => {
        const { root, registry, deps, ready } = setup("next-free", { geyser: true });
        await ready;
        await claimBedrockPort("paper", false, deps);
        expect(registry.list(PANEL_ID).map((claim) => claim.name)).toEqual(["bedrock"]);
        fs.rmSync(path.join(root, "plugins", "Geyser-Spigot.jar"));
        await claimBedrockPort("paper", false, deps);
        expect(registry.list(PANEL_ID)).toEqual([]);
    });
});
