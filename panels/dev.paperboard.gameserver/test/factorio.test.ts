import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as dgram from "node:dgram";
import * as fs from "node:fs";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { secretsApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { pickCall } from "./helpers/serverCall";
import { gameServer, type GameServer } from "./helpers/game";
import { installFactorio, playersOnline, serverSays } from "./helpers/factorio";
import { freePort } from "./helpers/palworld";
import { tempDir } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { TRIGGER_IDS } from "../src/service/contract";
import { startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { waitUntil } from "../src/games/serviceKit";
import { toolRunner, unpackRelease } from "../src/games/factorio/install";
import { parseOnline } from "../src/games/factorio/lists";
import { parseEvolution } from "../src/games/factorio/service";
import { modListFor, publicProblem, saveName, seedValue, serverSettings, spaceAgeOn } from "../src/games/factorio/settings";
import type { FactorioRelease } from "../src/games/factorio/catalog";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

/** a UDP port the OS says is free */
async function freeUdp(): Promise<number> {
    const socket = dgram.createSocket("udp4");
    const port = await new Promise<number>((resolve) => socket.bind(0, "0.0.0.0", () => resolve(socket.address().port)));
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    return port;
}

async function factorioServer(plan?: Record<string, unknown>, settings: Record<string, unknown> = {}): Promise<GameServer> {
    const server = gameServer("factorio", { settings: { port: await freeUdp(), rconPort: await freePort(), ...settings } });
    installFactorio(server.dir, plan);
    await server.server.game.initialize(false);
    return server;
}
const call = async (server: GameServer, id: string, input: unknown = {}) => pickCall(await server.server.game.calls(), id)(server.server, input);
const data = (server: GameServer, ...file: string[]) => path.join(server.dir, "data", ...file);
const json = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const runs = (server: GameServer) => json(data(server, "fake-factorio-runs.json")) as { args: string[]; cwd: string; readData: string }[];
const consoleOf = (server: GameServer) => server.server.state.serverEntries.map((e) => String(e.content)).join("\n");
const online = async (server: GameServer) => {
    await startServerInstance(server.server);
    await server.server.waitFor((s) => s.serverStatus === "online", "Factorio to finish starting");
};
const stop = async (server: GameServer) => {
    const exit = server.nextExit();
    await stopServerInstance(server.server);
    expect(await exit).toBe(0);
};
const upload = (server: GameServer, files: Record<string, string>) => {
    const file = `upload-${randomUUID()}.zip`;
    fs.mkdirSync(path.join(server.dir, ".factorio-upload"), { recursive: true });
    fs.writeFileSync(path.join(server.dir, ".factorio-upload", file), zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))));
    return file;
};

describe("Factorio", () => {
    test("a release installs only as the publisher's archive: its size and SHA-256, and one factorio folder of plain files with the server in it", async () => {
        const server = await factorioServer();
        const run = toolRunner(server.server);
        const work = tempDir("factorio-release-");
        /** a tar.xz of `tree` (made with the system's tar and xz, as the real one is unpacked), and its catalog entry */
        const archive = (name: string, build: (root: string) => void): { file: string; release: FactorioRelease } => {
            const root = path.join(work, `${name}-tree`);
            build(root);
            const file = path.join(work, `${name}.tar.xz`);
            const made = spawnSync("tar", ["-cJf", file, "-C", root, ...fs.readdirSync(root)], { encoding: "utf8" });
            if (made.status !== 0) throw new Error(`tar failed: ${made.stderr}`);
            const bytes = fs.readFileSync(file);
            return { file, release: { version: "2.1.25", url: "https://factorio.com/get-download/2.1.25/headless/linux64", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
        };
        const server_ = (root: string) => {
            fs.mkdirSync(path.join(root, "factorio", "bin", "x64"), { recursive: true });
            fs.mkdirSync(path.join(root, "factorio", "data", "base"), { recursive: true });
            // unpacking only checks the server is an executable file, so a script stands in: the compiled
            // stand-in is ~90 MB, and xz-packing it four times outran the test's time on CI
            fs.writeFileSync(path.join(root, "factorio", "bin", "x64", "factorio"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
            fs.writeFileSync(path.join(root, "factorio", "data", "base", "info.json"), "{}");
        };

        const good = archive("good", server_);
        const staging = path.join(work, "staging");
        await unpackRelease(good.file, staging, good.release, run, "factorio-tool-test");
        expect(fs.statSync(path.join(staging, "factorio", "bin", "x64", "factorio")).mode & 0o111).not.toBe(0);
        expect(fs.readdirSync(staging)).toEqual(["factorio"]);

        // a download that isn't the one the publisher lists is never unpacked
        await expect(unpackRelease(good.file, path.join(work, "other"), { ...good.release, sha256: "0".repeat(64) }, run, "factorio-tool-test")).rejects.toThrow("doesn't match the size and SHA-256");
        expect(fs.existsSync(path.join(work, "other"))).toBe(false);
        // a link, a second folder, or no server: not the release
        const linked = archive("linked", (root) => { server_(root); fs.symlinkSync("/etc/passwd", path.join(root, "factorio", "data", "passwd")); });
        await expect(unpackRelease(linked.file, path.join(work, "l"), linked.release, run, "factorio-tool-test")).rejects.toThrow("not a file: passwd");
        const extra = archive("extra", (root) => { server_(root); fs.mkdirSync(path.join(root, "other")); });
        await expect(unpackRelease(extra.file, path.join(work, "e"), extra.release, run, "factorio-tool-test")).rejects.toThrow("one factorio folder");
        const empty = archive("empty", (root) => { fs.mkdirSync(path.join(root, "factorio", "data"), { recursive: true }); fs.writeFileSync(path.join(root, "factorio", "data", "x"), ""); });
        await expect(unpackRelease(empty.file, path.join(work, "n"), empty.release, run, "factorio-tool-test")).rejects.toThrow("no server in it");
    });

    test("the first start makes a world with New World's options and matches mods to it; options are server-settings.json while it runs, its secrets from the vault and never on the console", async () => {
        const server = await factorioServer();
        await expect(call(server, "writeGameOptions", { patch: { public: true } })).rejects.toThrow("needs a factorio.com username and token");
        await call(server, "writeGameOptions", {
            patch: { name: "Nauvis Prime", password: "gearsandbelts", maxPlayers: 8, allowCommands: "false", public: true, username: "engineer", token: "tok-4f1c9e", preset: "rich-resources", seed: "123", spaceAge: false },
        });
        expect(JSON.stringify(server.server.settings)).not.toContain("gearsandbelts");
        expect(JSON.stringify(server.server.settings)).not.toContain("tok-4f1c9e");
        expect((await secretsApi.get(`${server.server.id}-factorio-join-password`, PANEL_ID)).value).toBe("gearsandbelts");
        expect((await secretsApi.get(`${server.server.id}-factorio-factorio-token`, PANEL_ID)).value).toBe("tok-4f1c9e");
        expect(server.server.state.maxPlayers).toBe(8);

        await online(server);
        // the world was made with the game's generator, then the start matched the mods to it
        expect(server.server.settings.save).toBe("World");
        expect(json(data(server, "fake-made-World.json"))).toEqual({ preset: "rich-resources", seed: "123", mods: ["base"] });
        const [made, synced, started] = runs(server);
        expect(made!.args.slice(2)).toEqual(["--create", data(server, "saves", "World.zip"), "--preset", "rich-resources", "--map-gen-seed", "123"]);
        expect(made!.readData).toBe(path.join(server.dir, "install", "factorio", "data"));
        expect(synced!.args.slice(2)).toEqual(["--sync-mods", data(server, "saves", "World.zip")]);
        expect(spaceAgeOn(fs.readFileSync(data(server, "mods", "mod-list.json"), "utf8"))).toBe(false);
        const rconPort = server.server.settings.rconPort;
        expect(started!.args.slice(started!.args.indexOf("--rcon-bind"), started!.args.indexOf("--rcon-bind") + 2)).toEqual(["--rcon-bind", `127.0.0.1:${rconPort}`]);
        expect(started!.args).not.toContain("--use-server-whitelist");
        expect(started!.cwd).toBe(data(server));
        const settings = json(data(server, "started-settings.json"));
        expect([settings.name, settings.game_password, settings.token, settings.username, settings.visibility, settings.max_players, settings.allow_commands])
            .toEqual(["Nauvis Prime", "gearsandbelts", "tok-4f1c9e", "engineer", { public: true, lan: true }, 8, false]);
        expect([server.server.state.serverVersion, server.server.settings.version]).toEqual(["2.1.25", "2.1.25"]);
        expect(await call(server, "factorioStatus")).toEqual({ world: "World", spaceAge: false, evolution: 0.1234 });

        // what the server prints, and what RCON answers, never shows the secrets
        await call(server, "runCommand", { command: "/evolution" });
        await server.server.waitFor((s) => s.serverEntries.some((e) => String(e.content).includes("Evolution factor: 0.1234")), "the command's answer");
        const rcon = (await secretsApi.get(`${server.server.id}-factorio-rcon-password`, PANEL_ID)).value!;
        expect(started!.args).toContain(rcon);
        serverSays(server.dir, `   9.000 Info echo ${rcon} gearsandbelts tok-4f1c9e`);
        await server.server.waitFor((s) => s.serverEntries.some((e) => String(e.content).includes("Info echo")), "the echoed line");
        expect(consoleOf(server)).not.toContain(rcon);
        expect(consoleOf(server)).not.toContain("gearsandbelts");
        expect(consoleOf(server)).not.toContain("tok-4f1c9e");
        // its run file is not for Files, and goes as the server stops; the copies the server
        // keeps in player-data.json are taken out as it stops, and Files can't read them till then
        await expect(server.server.game.assertFileAccess!("data/.server-settings.json", false)).rejects.toThrow("holds the join password");
        expect(fs.readFileSync(data(server, "player-data.json"), "utf8")).toContain("tok-4f1c9e");
        await expect(server.server.game.assertFileAccess!("data/player-data.json", false)).rejects.toThrow("keeps the join password and token");
        await expect(call(server, "runCommand", { command: "/quit" })).rejects.toThrow("Paperboard stops the server");
        // the server reads its options only as it starts, so they wait for a stop, in the service as on the screen
        await expect(call(server, "writeGameOptions", { patch: { whitelist: true } })).rejects.toThrow("Stop Factorio");
        expect(server.server.settings.whitelist).toBeUndefined();
        await stop(server);
        await server.server.lifecycle.released;
        expect(fs.existsSync(data(server, ".server-settings.json"))).toBe(false);
        const kept = json(data(server, "player-data.json"));
        expect([kept["service-username"], kept["service-token"], kept["last-played"]["host-settings"]["password-hash"], kept.tips]).toEqual(["engineer", "", "", { seen: [] }]);
        await server.server.game.assertFileAccess!("data/player-data.json", false);
        // a server that stopped while Paperboard was closed left both files with their secrets; setup takes them off
        fs.writeFileSync(data(server, ".server-settings.json"), JSON.stringify({ game_password: "gearsandbelts", token: "tok-4f1c9e" }));
        fs.writeFileSync(data(server, "player-data.json"), JSON.stringify({ "service-token": "tok-4f1c9e", "last-played": { "host-settings": { "password-hash": "gearsandbelts" } } }));
        await server.server.game.initialize(false);
        expect(fs.existsSync(data(server, ".server-settings.json"))).toBe(false);
        expect(fs.readFileSync(data(server, "player-data.json"), "utf8")).not.toMatch(/tok-4f1c9e|gearsandbelts/);
        await server.server.waitFor((s) => s.serverEntries.some((e) => String(e.content).endsWith("Saving progress: 100.000000%")), "the save as it quit");
        expect(await call(server, "factorioStatus")).toEqual({ world: "World", spaceAge: false, evolution: null });
    });

    test("worlds are the saves: made now with or without Space Age, switched, uploaded only as saves, and deleted to the trash", async () => {
        const server = await factorioServer();
        await call(server, "factorioWorld", { name: "Gleba Run", create: true, generation: { preset: "death-world", seed: "", spaceAge: true } });
        expect(server.server.settings.save).toBe("Gleba Run");
        expect(json(data(server, "fake-made-Gleba Run.json"))).toEqual({ preset: "death-world", seed: null, mods: ["base", "elevated-rails", "quality", "recycler", "space-age"] });
        // New World opens on what it was last set to
        expect([server.server.settings.preset, server.server.settings.spaceAge]).toEqual(["death-world", true]);
        await call(server, "factorioWorld", { name: "Plain", create: true, generation: { spaceAge: false } });
        await expect(call(server, "factorioWorld", { name: "Plain", create: true, generation: {} })).rejects.toThrow('A world named "Plain" already exists');
        await expect(call(server, "factorioWorld", { name: "_autosave1", create: true, generation: {} })).rejects.toThrow("starting with a letter or digit");
        await expect(call(server, "factorioWorld", { name: "x", create: true, generation: { seed: "-4" } })).rejects.toThrow("Seed must be a whole number");
        await expect(call(server, "factorioWorld", { name: "x", create: true, generation: { preset: "nope" } })).rejects.toThrow();
        // the server's autosaves stay out of the list
        fs.writeFileSync(data(server, "saves", "_autosave1.zip"), "autosave");
        const names = async () => (await call(server, "factorioWorlds") as { name: string; active: boolean }[]).map((w) => `${w.name}${w.active ? " *" : ""}`);
        expect(await names()).toEqual(["Gleba Run", "Plain *"]);
        await call(server, "factorioWorld", { name: "Gleba Run", create: false });
        expect(await names()).toEqual(["Gleba Run *", "Plain"]);
        await expect(call(server, "factorioWorld", { name: "Nowhere", create: false })).rejects.toThrow('There is no world named "Nowhere"');

        // the start plays the chosen world with its mods: Gleba Run is a Space Age one
        await online(server);
        expect(runs(server).at(-1)!.args).toContain(data(server, "saves", "Gleba Run.zip"));
        expect(spaceAgeOn(fs.readFileSync(data(server, "mods", "mod-list.json"), "utf8"))).toBe(true);
        await expect(call(server, "factorioWorld", { name: "Plain", create: false })).rejects.toThrow("Stop Factorio");
        await stop(server);

        // an upload is a save, or it is removed and refused; its folder names it
        const junk = upload(server, { "readme.txt": "not a save" });
        await expect(call(server, "factorioWorldInspect", { file: junk })).rejects.toThrow("isn't a Factorio save");
        expect(fs.existsSync(path.join(server.dir, ".factorio-upload", junk))).toBe(false);
        const mapless = upload(server, { "Base/control.lua": "" });
        await expect(call(server, "factorioWorldInspect", { file: mapless })).rejects.toThrow("no map in it");
        const save = upload(server, { "My Base/level.dat0": "map", "My Base/control.lua": "" });
        expect(await call(server, "factorioWorldInspect", { file: save })).toEqual({ suggestedName: "My Base" });
        await call(server, "factorioWorldImport", { file: save, name: "My Base" });
        expect(fs.existsSync(data(server, "saves", "My Base.zip"))).toBe(true);
        const again = upload(server, { "Plain/level-init.dat": "map" });
        expect(await call(server, "factorioWorldInspect", { file: again })).toEqual({ suggestedName: "Plain 2" });
        await expect(call(server, "factorioWorldImport", { file: again, name: "plain" })).rejects.toThrow('A world named "plain" already exists');
        await expect(call(server, "factorioWorldInspect", { file: "../../evil.zip" })).rejects.toThrow("Choose a save to upload");

        // deleting the world in play moves it to the trash and leaves the choice to the person
        await call(server, "factorioWorldDelete", { name: "Gleba Run" });
        expect(server.server.settings.save).toBeNull();
        const trash = fs.readdirSync(server.dir).filter((n) => n.startsWith(".trash-"));
        expect(trash.map((t) => fs.readdirSync(path.join(server.dir, t, "saves")))).toEqual([["Gleba Run.zip"]]);
        await expect(startServerInstance(server.server)).rejects.toThrow("Choose the world to play in Worlds");
    });

    test("players, chat and the lists: RCON while the server keeps them, their files while it is stopped, and Blocks for each", async () => {
        const server = await factorioServer();
        const fired: [string, unknown][] = [];
        const trigger = server.server.trigger.bind(server.server);
        server.server.trigger = (id, output) => { fired.push([id, output]); trigger(id, output); };
        await online(server);

        playersOnline(server.dir, "Alice");
        await server.server.waitFor((s) => s.onlinePlayers.includes("Alice"), "Alice to join");
        expect(fired).toContainEqual([TRIGGER_IDS.playerJoined, "Alice"]);
        serverSays(server.dir, "2026-11-27 03:08:39 [CHAT] Alice: the factory must grow");
        await server.server.waitFor((s) => s.chatMessages.some((m) => m.text === "<Alice> the factory must grow"), "Alice's chat");
        expect(fired.some(([id]) => id === TRIGGER_IDS.chatMessage)).toBe(true);
        await call(server, "sayChat", { message: "welcome" });
        await server.server.waitFor((s) => s.chatMessages.some((m) => m.text === "<Server> welcome"), "the server's chat");
        await expect(call(server, "sayChat", { message: "/promote me" })).rejects.toThrow("can't start with /");

        // while it runs, the server keeps its lists and writes them in lower case
        await call(server, "factorioList", { list: "admins", name: "Alice", on: true });
        await call(server, "factorioBan", { name: "Griefer" });
        expect(json(data(server, "server-adminlist.json"))).toEqual(["alice"]);
        expect(json(data(server, "server-banlist.json"))).toEqual([{ username: "griefer", reason: "Banned by the server admin" }]);
        // the whitelist is in its file while the server plays without one
        await call(server, "factorioList", { list: "whitelist", name: "Bob", on: true });
        expect(json(data(server, "server-whitelist.json"))).toEqual(["bob"]);
        await expect(call(server, "factorioKick", { name: "Nobody" })).rejects.toThrow("not online");
        await expect(call(server, "factorioBan", { name: "two words" })).rejects.toThrow("Factorio username");
        await expect(call(server, "factorioBan", { name: "x\n/quit" })).rejects.toThrow("Factorio username");
        expect(await call(server, "factorioPlayers")).toEqual({
            seen: [{ name: "Alice", lastSeen: expect.any(Number) }], online: ["Alice"], admins: ["alice"],
            bans: [{ name: "griefer", reason: "Banned by the server admin" }], whitelist: ["bob"], whitelistOn: false,
        });
        await call(server, "factorioKick", { name: "Alice" });

        playersOnline(server.dir);
        await server.server.waitFor((s) => !s.onlinePlayers.includes("Alice"), "Alice to leave");
        expect(fired).toContainEqual([TRIGGER_IDS.playerLeft, "Alice"]);
        await stop(server);

        // stopped: the files, keeping every other entry
        await call(server, "factorioUnban", { name: "GRIEFER" });
        await call(server, "factorioList", { list: "admins", name: "Carol", on: true });
        expect(json(data(server, "server-banlist.json"))).toEqual([]);
        expect(json(data(server, "server-adminlist.json"))).toEqual(["alice", "carol"]);

        // with the whitelist on, the server is given it and keeps it
        await call(server, "writeGameOptions", { patch: { whitelist: true } });
        await online(server);
        expect(runs(server).at(-1)!.args).toEqual(expect.arrayContaining(["--use-server-whitelist", "--server-whitelist", data(server, "server-whitelist.json")]));
        await call(server, "factorioList", { list: "whitelist", name: "Dave", on: true });
        expect(json(data(server, "server-whitelist.json"))).toEqual(["bob", "dave"]);

        // Blocks: kick, ban and unban, admins and the whitelist, each by name
        const blocks = await server.server.game.blocks!();
        const ids = (blocks.commands ?? []).map((c) => c.id);
        expect(ids).toEqual(expect.arrayContaining(["kick-player", "ban-player", "unban-player", "make-admin", "remove-admin", "whitelist-player", "unwhitelist-player"]));
        const run = (id: string, inputs: unknown) => (blocks.commands ?? []).find((c) => c.id === id)!.run(inputs as never, undefined as never);
        const read = (id: string) => (blocks.values ?? []).find((v) => v.id === id)!.read(undefined as never, undefined as never);
        await run("remove-admin", { player: "carol" });
        expect(await read("admins")).toEqual(["alice"]);
        await run("unwhitelist-player", { player: "Bob" });
        expect(await read("whitelisted-players")).toEqual(["dave"]);
        await run("ban-player", { player: "Eve" });
        expect(await read("banned-players")).toEqual(["eve"]);
        await stop(server);
    });

    test("a stop ends the run's players: the roster read as the server goes offline has nobody online", async () => {
        const server = await factorioServer();
        await online(server);
        playersOnline(server.dir, "Alice");
        await server.server.waitFor((s) => s.onlinePlayers.includes("Alice"), "Alice to join");
        // Alice is still on as the server stops; the Players tab reads again as it goes offline
        const read = server.server.waitFor((s) => s.serverStatus === "offline", "the stop").then(() => call(server, "factorioPlayers") as Promise<{ online: string[] }>);
        await stop(server);
        expect((await read).online).toEqual([]);
        expect(server.server.state.onlinePlayers).toEqual([]);
    });

    test("a start's own tools hold the server: Worlds and Files wait while it makes the map and matches its mods", async () => {
        const server = await factorioServer();
        const starting = startServerInstance(server.server);
        await waitUntil(() => server.server.game.isMutating(), 20_000, "the start to run its tools", 1);
        await expect(call(server, "factorioWorld", { name: "Elsewhere", create: true })).rejects.toThrow("Stop Factorio");
        await expect(call(server, "factorioWorldDelete", { name: "World" })).rejects.toThrow("Stop Factorio");
        await expect(server.server.game.assertFileAccess!("data/mods/mod-list.json", true)).rejects.toThrow("Stop Factorio before editing");
        await starting;
        await server.server.waitFor((s) => s.serverStatus === "online", "Factorio to finish starting");
        expect(server.server.settings.save).toBe("World");
        await stop(server);
    });

    test("a save waits for the server to write it; a backup stops the server, which saves as it quits, and a stop that saved nothing refuses the copy", async () => {
        const server = await factorioServer();
        await call(server, "writeGameOptions", { patch: { password: "conveyor9" } });
        await online(server);
        await call(server, "saveWorld");
        await server.server.waitFor((s) => s.serverEntries.some((e) => String(e.content).endsWith("Saving finished")), "the save's line");
        const exit = server.nextExit();
        await server.server.game.backup.before();
        expect(await exit).toBe(0);
        expect(server.server.state.serverStatus).toBe("offline");
        // what a backup copies has no secrets in it
        expect(fs.readFileSync(data(server, "player-data.json"), "utf8")).not.toContain("conveyor9");
        await server.server.game.backup.after();
        await server.server.waitFor((s) => s.serverStatus === "online", "Factorio to start again");
        await stop(server);

        const unsaved = await factorioServer({ noSaveOnExit: true });
        await online(unsaved);
        await expect(unsaved.server.game.backup.before()).rejects.toThrow("exited without confirming its shutdown save");
        await unsaved.server.game.backup.after();
        await unsaved.server.waitFor((s) => s.serverStatus === "online", "Factorio to start again");
        await stop(unsaved);
    });

    test("what the server says is read as it says it, and what it is given is only what it takes", () => {
        expect(parseOnline("Online players (2):\n  Alice (online)\n  bob.the-builder (online)\n")).toEqual(["Alice", "bob.the-builder"]);
        expect(parseOnline("Online players (0):\n")).toEqual([]);
        expect(() => parseOnline("Unknown command")).toThrow("something else");
        expect(parseEvolution("[planet=nauvis] Nauvis - Evolution factor: 0.0000. (Time 0%) (Pollution 0%) (Spawner kills 0%)\n")).toBe(0);
        expect(parseEvolution("[planet=gleba] Gleba - Evolution factor: 0.5000.\n[planet=nauvis] Nauvis - Evolution factor: 0.2500.\n")).toBe(0.25);
        expect([seedValue(""), seedValue("4294967295")]).toEqual([null, 4294967295]);
        expect(() => seedValue("4294967296")).toThrow("Seed must be");
        expect(() => saveName("a/b")).toThrow();
        expect(() => saveName("World.zip")).toThrow();
        // a new map's mod list: the expansion as chosen, and every other mod as it was
        const list = JSON.parse(modListFor(JSON.stringify({ mods: [{ name: "base", enabled: true }, { name: "space-age", enabled: true }, { name: "krastorio", enabled: true }, { name: "old", enabled: false }] }), false));
        expect(list.mods).toEqual([
            { name: "base", enabled: true }, { name: "elevated-rails", enabled: false }, { name: "quality", enabled: false }, { name: "recycler", enabled: false },
            { name: "space-age", enabled: false }, { name: "krastorio", enabled: true }, { name: "old", enabled: false },
        ]);
        // the token goes only to a server listed publicly, and a public one needs it
        expect(serverSettings({ allowCommands: "true", public: false, username: "engineer" }, { password: "", token: "tok" })).toMatchObject({ allow_commands: true, token: "", username: "", visibility: { public: false, lan: true } });
        expect(publicProblem({ public: true, username: "engineer" }, "")).toContain("needs a factorio.com username and token");
        expect(publicProblem({ public: true, username: "engineer" }, "tok")).toBeNull();
    });
});
