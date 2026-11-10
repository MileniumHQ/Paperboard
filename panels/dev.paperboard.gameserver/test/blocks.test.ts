// Game Server's blocks (Actions API v2), read the way the Blocks panel
// reads them: through the real daemon, from the installed service.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { actionsApi, blocksApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { installFakeJava } from "./helpers/fakeJava";
import { installPanel, restartService, servicesState } from "./helpers/installedPanel";
import { freePort } from "./helpers/palworld";
import { placeStandIn } from "./helpers/standIn";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";
import { gamerulesFor } from "../src/core/gamerules";
import { entrypoint, releaseFor } from "../src/games/terraria/catalog";

const SERVERS = "servers-0123456789ab";
const dataDir = process.env.PAPERBOARD_DIR!;
const folder = (id: string) => path.join(dataDir, "files", PANEL_ID, SERVERS, id);
const serverDir = folder("s-a");
const terraria = releaseFor("1.4.5.8");
const read = <T>(value: string, inputs?: Record<string, unknown>, project = "s-a") => blocksApi.read<T>(PANEL_ID, value, inputs, { project });
const run = <T>(command: string, inputs?: Record<string, unknown>, project = "s-a") => blocksApi.run<T>(PANEL_ID, command, inputs, { project, timeoutMs: null });

/** resolves with what the next firing of `event` in `project` carried */
function nextEvent(event: string, project: string, timeoutMs = 10_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            off();
            reject(new Error(`${event} did not fire in ${project}`));
        }, timeoutMs);
        const off = blocksApi.onEvent(PANEL_ID, event, (payload) => {
            clearTimeout(timer);
            off();
            resolve(payload);
        }, project);
    });
}
// subscriptions reach the daemon on their own; a test lets them land before what fires them
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

const SHARED = {
    commands: ["back-up", "restart-server", "run-command", "save-world", "say", "start-server", "stop-server"],
    values: ["backups", "log", "log-files", "online-players", "player-count", "server-status"],
    events: ["server-crashed", "server-started", "server-stopped"],
};
const PLAYER_EVENTS = ["chat-message", "player-joined", "player-left"];
const entriesOf = (project: string, blocks: { commands: string[]; values: string[]; events: string[] }) =>
    (["commands", "values", "events"] as const).flatMap((kind) => blocks[kind].map((id) => `${project}/${kind.slice(0, -1)}.${id}`));

let daemon: TestDaemon;
beforeAll(async () => {
    installPanel(dataDir);
    fs.mkdirSync(path.join(dataDir, "configs"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "configs", `${PANEL_ID}.json`), JSON.stringify({
        version: 2,
        serversDirectory: SERVERS,
        servers: [
            { id: "s-a", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-a`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } },
            { id: "s-t", name: "Island", game: "terraria", directory: `${SERVERS}/s-t`, createdAt: 1, settings: { configured: true, version: terraria.version, port: await freePort() } },
        ],
    }));
    writeTree(serverDir, {
        "server.jar": "jar",
        "eula.txt": "eula=true\n",
        "fake-server.json": JSON.stringify({ players: ["alice", "bob"], maxPlayers: 10 }),
    });
    writeTree(folder("s-t"), {
        [`install/${terraria.directory}/manifest.json`]: JSON.stringify({ software: "vanilla", version: terraria.version, sha256: terraria.sha256, os: process.platform, arch: process.arch }),
    });
    placeStandIn("fakeTerraria", path.join(folder("s-t"), "install", terraria.directory, entrypoint(process.platform)));
    installFakeJava(javaPackageFor("1.21.1")!, dataDir);
    daemon = await startTestDaemon();
    await restartService();
});
afterAll(async () => {
    for (const server of ["s-a", "s-t"]) await actionsApi.call(PANEL_ID, `${server}/stop-server`, {}, { timeoutMs: null });
    await daemon?.stop();
});

describe("each server is a Blocks project with its game's blocks", () => {
    test("Minecraft's and Terraria's projects list the shared blocks, each game's own, and the panel's types", async () => {
        expect((await blocksApi.projects(PANEL_ID)).map((p) => [p.id, p.name]).sort()).toEqual([["s-a", "Survival"], ["s-t", "Island"]]);
        const all = await blocksApi.list(PANEL_ID);
        const of = (prefix: string) => all.map((b) => b.entry).filter((e) => e.startsWith(prefix)).sort();
        expect(of("type.")).toEqual(["backup", "log-file", "player", "player-statistics", "plugin", "world"].map((t) => `type.${t}`));
        expect(of("s-a/")).toEqual(entriesOf("s-a", {
            commands: [...SHARED.commands, "ban-player", "create-world", "delete-player-data", "delete-plugin", "delete-world", "deop-player", "install-software", "kick-player", "kill-player", "op-player", "pardon-player", "reset-world", "set-game-rule", "switch-world", "uninstall-plugins", "unwhitelist-player", "whitelist-player"],
            values: [...SHARED.values, "active-world", "banned-players", "game-rule", "operators", "player-by-uuid", "player-statistics", "plugins", "statistics-of", "whitelisted-players", "worlds"],
            events: [...SHARED.events, ...PLAYER_EVENTS],
        }).sort());
        expect(of("s-t/")).toEqual(entriesOf("s-t", { ...SHARED, events: [...SHARED.events, ...PLAYER_EVENTS] }).sort());

        const schema = (entry: string) => all.find((b) => b.entry === entry)!.schema as any;
        expect(schema("s-a/command.kick-player")).toMatchObject({ text: "Kick {player} because {reason}", inputs: { player: { type: `${PANEL_ID}:player` } } });
        expect(schema("s-a/command.back-up")).toMatchObject({ output: `${PANEL_ID}:backup` });
        expect(schema("s-t/event.chat-message")).toMatchObject({ values: { player: { type: `${PANEL_ID}:player` }, message: { type: "text" } }, filters: { player: "player", message: "message" } });
        // the rule dropdown follows the installed version, which the service reads after the first registration
        expect(schema("s-a/command.set-game-rule").inputs.rule.choices.map((c: { value: string }) => c.value)).toEqual(gamerulesFor("1.21.1").map((r) => r.name));
    });

    test("the world blocks make, switch and list worlds while the server is stopped, and refuse a world that isn't there", async () => {
        expect(await read("server-status")).toBe("offline");
        expect(await run("create-world", { world: "Second", seed: "42" })).toBeNull();
        expect(await read("active-world")).toBe("Second");
        expect(await read("worlds")).toEqual([{ name: "Second", active: true, generated: false, nether: false, end: false }]);
        expect(await run("switch-world", { world: "Second" })).toBeNull();
        await expect(run("switch-world", { world: "Elsewhere" })).rejects.toThrow('This server has no world named "Elsewhere"');
        await expect(run("restart-server")).rejects.toThrow("The server is not online, so it can't restart");
        expect(await read("active-world")).toBe("Second");
    });

    test("the values read the players online, and a kick announces the change before a fresh read shows it", async () => {
        const state = servicesState();
        const changed = new Set<string>();
        const off = ["player-count", "online-players", "server-status"].map((value) => blocksApi.onChange(PANEL_ID, value, () => changed.add(value), "s-a"));
        try {
            await settle();
            expect(await run("start-server")).toBeNull();
            await state.waitFor("s-a", (s) => s.serverStatus === "online" && s.onlinePlayers.length === 2, "s-a online with its players");
            expect(await read("server-status")).toBe("online");
            expect(await read("player-count")).toBe(2);
            expect(await read("online-players")).toEqual(["alice", "bob"]);
            expect(changed.has("server-status")).toBe(true);

            changed.clear();
            expect(await run("kick-player", { player: "alice", reason: "testing" })).toBeNull();
            await state.waitFor("s-a", (s) => s.onlinePlayers.length === 1, "alice to leave");
            const deadline = Date.now() + 10_000;
            while (!changed.has("player-count") || !changed.has("online-players")) {
                if (Date.now() > deadline) throw new Error(`only ${[...changed].join(", ") || "nothing"} announced a change`);
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            expect(await read("online-players")).toEqual(["bob"]);
            expect(await read("player-count")).toBe(1);
        } finally {
            for (const unsubscribe of off) unsubscribe();
        }
    });

    test("chat and console commands reach the server as one line each, and the world can't switch while it runs", async () => {
        await run("say", { message: "hello there" });
        await run("run-command", { command: "ban carol cheating" });
        await expect(run("say", { message: "two\nlines" })).rejects.toThrow("Refusing multi-line chat message");
        await expect(run("create-world", { world: "Third" })).rejects.toThrow("Stop the server before managing worlds");
        const deadline = Date.now() + 10_000;
        const log = () => (fs.existsSync(path.join(serverDir, "commands.log")) ? fs.readFileSync(path.join(serverDir, "commands.log"), "utf8") : "");
        while (!log().includes("ban carol cheating")) {
            if (Date.now() > deadline) throw new Error(`the commands did not reach the server:\n${log()}`);
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(log()).toContain("say hello there\n");
        expect(log()).not.toContain("two");
    });

    test("a kick naming no player, or one that isn't a player name, is refused before the server sees it", async () => {
        await expect(blocksApi.run(PANEL_ID, "kick-player", {}, { project: "s-a" })).rejects.toThrow('Kick Player: "Player" is required');
        await expect(blocksApi.run(PANEL_ID, "kick-player", { player: 7 }, { project: "s-a" })).rejects.toThrow('"Player": expected text');
        await expect(blocksApi.run(PANEL_ID, "kick-player", { player: "bob; stop" }, { project: "s-a" })).rejects.toThrow();
        expect(await read("online-players")).toEqual(["bob"]);
    });

    test("Terraria's joins and chat fire as Blocks events with the player and what they said", async () => {
        const state = servicesState();
        const started = nextEvent("server-started", "s-t");
        await settle();
        expect(await run("start-server", {}, "s-t")).toBeNull();
        expect(await started).toEqual({});
        await state.waitFor("s-t", (s) => s.serverStatus === "online", "Terraria online");

        const joined = nextEvent("player-joined", "s-t");
        const chatted = nextEvent("chat-message", "s-t");
        await settle();
        // the stand-in prints what it is told to relay, as the game would
        await run("run-command", { command: "relay Bob has joined." }, "s-t");
        await run("run-command", { command: "relay <Bob> hello there" }, "s-t");
        expect(await joined).toEqual({ player: "Bob" });
        expect(await chatted).toEqual({ player: "Bob", message: "hello there" });

        const stopped = nextEvent("server-stopped", "s-t");
        await settle();
        await run("stop-server", {}, "s-t");
        expect(await stopped).toEqual({});
        expect(await read("server-status", undefined, "s-t")).toBe("offline");
    });
});
