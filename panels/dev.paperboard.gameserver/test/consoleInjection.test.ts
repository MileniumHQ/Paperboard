import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { loopbackServer } from "./helpers/http";
import { testServer } from "./helpers/scope";
import { assertPort, listeningPidsCommand } from "../src/core/diagnostics";
import { killConflictingProcessWith } from "../src/service/diagnostics";
import { minecraftCalls } from "../src/games/minecraft/calls";
import { sendServerCommand, startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { queryGamerules, setGamerule } from "../src/service/gamerules";
import { runtimeCommandsFor } from "../src/service/runtimeProperties";
import { assertResourcePackUrl } from "../src/core/resourcepack";
import { selectCustomResourcePack } from "../src/service/resourcepack";
import { liveResourcePackDeps } from "../src/service/resourcepackDeps";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const action = (id: string) => {
    const found = minecraftCalls[id];
    if (!found) throw new Error(`No call ${id}`);
    return (ctx: unknown, inputs: unknown) => (found as Function)(ctx, inputs) as Promise<unknown>;
};

// Minecraft console and property writes cannot be injected.
describe("console and property injection", () => {
    test("port kill takes only a port number, keeps the lookup one argv element and never kills its own pid", async () => {
        for (const bad of ["8080;rm -rf /", "0", "65536", "-1", "8080 8081", "$(id)", "", null]) {
            expect(() => assertPort(bad)).toThrow("Refusing");
        }
        expect(assertPort(" 25565 ")).toBe("25565");
        const win = listeningPidsCommand("25565", true);
        expect(win.command).toBe("powershell.exe");
        expect(win.args).toHaveLength(4);
        expect(win.args[3]).toBe("Get-NetTCPConnection -LocalPort 25565 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique");
        expect(listeningPidsCommand("25565", false)).toEqual({ command: "lsof", args: ["-t", "-iTCP:25565", "-sTCP:LISTEN"] });

        const killed: number[] = [];
        const ran: string[][] = [];
        const count = await killConflictingProcessWith(
            {
                isWindows: async () => false,
                run: async (command, args, onStdout) => {
                    ran.push([command, ...args]);
                    onStdout(`${process.pid}\n4242\n`);
                    return 0;
                },
                kill: (pid) => killed.push(pid),
                ownPid: process.pid,
            },
            "25565",
        );
        expect(count).toBe(1);
        expect(killed).toEqual([4242]);
        await expect(killConflictingProcessWith({ isWindows: async () => false, run: async () => 0, kill: () => undefined, ownPid: 1 }, "25565; reboot")).rejects.toThrow("Refusing unsafe port");
    });

    test("player names, kick and ban reasons and chat must be one line, and the server receives none that are not", async () => {
        const mc: McServer = minecraftServer({ files: { "fake-server.json": JSON.stringify({ players: ["Steve"] }) } });
        await startServerInstance(mc.server);
        await mc.server.waitFor((s) => s.serverStatus === "online", "the server to come online");
        const ctx = mc.server;
        const run = (id: string, inputs: unknown) => action(id)(ctx, inputs);
        await expect(run("kickPlayer", { player: "Steve\nop Mallory" })).rejects.toThrow("Refusing unsafe player name");
        await expect(run("kickPlayer", { player: "Steve; op Mallory" })).rejects.toThrow("Refusing unsafe player name");
        await expect(run("kickPlayer", { player: "Steve", reason: "bye\nop Mallory" })).rejects.toThrow("Refusing multi-line kick reason");
        await expect(run("banPlayer", { player: "Steve", reason: "bye\rop Mallory" })).rejects.toThrow("Refusing multi-line ban reason");
        await expect(run("sayChat", { message: "hi\nop Mallory" })).rejects.toThrow("Refusing multi-line chat message");
        await expect(sendServerCommand(ctx, "say hi\nop Mallory")).rejects.toThrow("Refusing multi-line console command");
        // a valid kick goes through as one command
        await run("kickPlayer", { player: "Steve", reason: "be nice" });
        await mc.received("kick Steve be nice");
        expect(mc.commands().filter((c) => c !== "list")).toEqual(["kick Steve be nice"]);
        const exit = mc.nextExit();
        await stopServerInstance(ctx);
        await exit;
    });

    test("gamerules are checked against the registry and the rule's type", async () => {
        const scope = testServer({ directory: "servers/rules" }, { serverVersion: "1.21.11", serverSoftware: "paper" });
        const set = (name: string, value: string) => setGamerule(scope, name, value);
        await expect(set("not_a_rule", "true")).rejects.toThrow("Refusing unknown gamerule");
        await expect(set("keep_inventory\nop Mallory", "true")).rejects.toThrow("Refusing unknown gamerule");
        await expect(set("keep_inventory", "true\nop Mallory")).rejects.toThrow("Refusing unsafe gamerule value");
        // a number for a true/false rule, and a word for a number rule
        await expect(set("keep_inventory", "5")).rejects.toThrow();
        await expect(set("respawn_radius", "true")).rejects.toThrow();
    });

    test("a gamerule the running server's console did not take fails its call and is not shown applied", async () => {
        // online, but no process behind it: the console write is refused
        const scope = testServer({ directory: "servers/rules-gone" }, { serverStatus: "online", serverVersion: "1.21.11", serverSoftware: "paper" });
        await expect(setGamerule(scope, "keep_inventory", "true")).rejects.toThrow();
        expect(scope.state.gamerules.keep_inventory).toBeUndefined();
        // the Game Rules tab's readout of the current values fails the same way
        await expect(queryGamerules(scope, ["keep_inventory"])).rejects.toThrow();
    });

    test("difficulty and gamemode map only to known named commands", () => {
        expect(runtimeCommandsFor({ difficulty: "3", gamemode: "1", "force-gamemode": "true" })).toEqual([
            "difficulty hard",
            "defaultgamemode creative",
            "gamemode creative @a",
        ]);
        expect(runtimeCommandsFor({ difficulty: "hard\nop Mallory", gamemode: "creative @a\nop Mallory" })).toEqual([]);
        expect(runtimeCommandsFor({ difficulty: "nightmare", gamemode: "god" })).toEqual([]);
    });

    test("resource-pack must be one http(s) line, its sha1 comes from the downloaded bytes, and a failure writes nothing", async () => {
        for (const bad of ["https://x.example/a.zip\nmotd=pwned", "file:///etc/passwd", "javascript:alert(1)", "https://x.example/a b.zip", "", 7]) {
            expect(() => assertResourcePackUrl(bad)).toThrow();
        }
        const zip = zipSync({ "pack.mcmeta": strToU8("{}") });
        const host = loopbackServer((_req, url) =>
            url.pathname === "/pack.zip" ? new Response(zip) : url.pathname === "/page" ? new Response("<html>share page</html>") : new Response("gone", { status: 404 }),
        );
        const mc = minecraftServer({ files: { "server.properties": "motd=mine\nmax-players=5\n" } });
        const deps = liveResourcePackDeps(mc.server);
        const properties = () => fs.readFileSync(path.join(mc.dir, "server.properties"), "utf8");
        for (const url of [`${host.url}/missing.zip`, `${host.url}/page`]) {
            await expect(selectCustomResourcePack({ url }, deps)).rejects.toThrow();
            expect(properties()).toBe("motd=mine\nmax-players=5\n");
        }
        await selectCustomResourcePack({ url: `${host.url}/pack.zip` }, deps);
        const written = properties();
        expect(written).toContain(`resource-pack=${host.url}/pack.zip\n`);
        expect(written).toContain(`resource-pack-sha1=${createHash("sha1").update(zip).digest("hex")}`);
        expect(written).toContain("motd=mine");
        expect(written).toContain("max-players=5");
    });
});
