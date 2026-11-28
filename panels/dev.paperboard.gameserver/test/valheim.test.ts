import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as dgram from "node:dgram";
import * as fs from "node:fs";
import * as path from "node:path";
import { portApi, secretsApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { pickCall } from "./helpers/serverCall";
import { gameServer, type GameServer } from "./helpers/game";
import { installValheim, serverSays } from "./helpers/valheim";
import { PANEL_ID } from "../src/servers";
import { TRIGGER_IDS } from "../src/service/contract";
import { startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { waitUntil } from "../src/games/serviceKit";
import { ValheimLog } from "../src/games/valheim/log";
import { launchArgs, passwordProblem, valheimService, worldName } from "../src/games/valheim/service";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

/** a UDP port pair the OS says is free: the port and the next */
async function freePair(): Promise<number> {
    for (;;) {
        const socket = dgram.createSocket("udp4");
        const port = await new Promise<number>((resolve) => socket.bind(0, "0.0.0.0", () => resolve(socket.address().port)));
        const next = dgram.createSocket("udp4");
        const free = port < 65535 && (await new Promise<boolean>((resolve) => {
            next.once("error", () => resolve(false));
            next.bind(port + 1, "0.0.0.0", () => resolve(true));
        }));
        await new Promise<void>((resolve) => socket.close(() => resolve()));
        if (free) {
            await new Promise<void>((resolve) => next.close(() => resolve()));
            return port;
        }
    }
}

async function valheimServer(plan?: Record<string, unknown>, settings: Record<string, unknown> = {}): Promise<GameServer> {
    const server = gameServer("valheim", { settings: { port: await freePair(), ...settings } });
    installValheim(server.dir, plan);
    await server.server.game.initialize(false);
    return server;
}
const call = async (server: GameServer, id: string, input: unknown = {}) => pickCall(await server.server.game.calls(), id)(server.server, input);
const started = (server: GameServer) => JSON.parse(fs.readFileSync(path.join(server.dir, "install", "started-with.json"), "utf8")) as { args: string[]; env: Record<string, string> };
const consoleOf = (server: GameServer) => server.server.state.serverEntries.map((e) => String(e.content)).join("\n");
const list = (server: GameServer, file: string) => fs.readFileSync(path.join(server.dir, "save", file), "utf8");
const online = async (server: GameServer) => {
    await startServerInstance(server.server);
    await server.server.waitFor((s) => s.serverStatus === "online", "Valheim to finish starting");
};
const stop = async (server: GameServer) => {
    const exit = server.nextExit();
    await stopServerInstance(server.server);
    expect(await exit).toBe(0);
};
const STEAM_ID = "76561198000000001";

describe("Valheim", () => {
    test("options are the server's arguments at each start, the join password is in the vault and never on the console, and crossplay's join code is read from the log", async () => {
        const server = await valheimServer();
        await call(server, "writeGameOptions", { patch: { name: "Midgard", world: "Yggdrasil", password: "trollsmash", public: true, crossplay: true, preset: "hard", raids: "none", portals: "veryhard", nomap: true, passivemobs: true, saveinterval: 10 } });
        expect(JSON.stringify(server.server.settings)).not.toContain("trollsmash");
        expect((await secretsApi.get(`${server.server.id}-valheim-join-password`, PANEL_ID)).value).toBe("trollsmash");

        await online(server);
        const { args, env } = started(server);
        const given = (name: string) => args[args.indexOf(name) + 1];
        expect([given("-name"), given("-world"), given("-port"), given("-public"), given("-password"), given("-saveinterval"), given("-savedir")])
            .toEqual(["Midgard", "Yggdrasil", String(server.server.settings.port), "1", "trollsmash", "600", path.join(server.dir, "save")]);
        // the preset clears the world's modifiers, then each one set here goes on top of it
        expect(args.slice(args.indexOf("-preset"))).toEqual(["-preset", "hard", "-password", "trollsmash", "-crossplay", "-modifier", "raids", "none", "-modifier", "portals", "veryhard", "-setkey", "passivemobs", "-setkey", "nomap"]);
        expect(env).toEqual({ LD_LIBRARY_PATH: path.join(server.dir, "install", "linux64"), SteamAppId: "892970", HOME: path.join(server.dir, "profile") });
        expect(consoleOf(server)).not.toContain("trollsmash");
        expect(server.server.state.maxPlayers).toBe(10);
        await server.server.waitFor((s) => s.serverVersion === "1.0.31", "the version from the log");
        // the relay registers the session a moment after the server is up
        const session = () => call(server, "valheimSession") as Promise<{ address: string | null } | null>;
        await waitUntil(async () => ((await session())?.address ?? null) !== null, 5_000, "the join code in the log");
        expect(await session()).toEqual({ world: "Yggdrasil", listed: true, crossplay: true, joinCode: "150661", address: `203.0.113.7:${server.server.settings.port}` } as never);

        // the server reads no console; Save is refused with the reason
        await expect(call(server, "saveWorld")).rejects.toThrow("saves its world on its own");
        await expect(server.server.game.assertFileAccess!("save/worlds_local/Yggdrasil/_main.1.db2", true)).rejects.toThrow("Stop Valheim before editing its files");
        await server.server.game.assertFileAccess!("save/bannedlist.txt", true);
        await expect(server.server.game.assertFileAccess!("install/valheim_server.x86_64", true)).rejects.toThrow("Installed Valheim files are managed by Updates");
        await stop(server);
        // its stop saved the world it made
        expect(fs.readdirSync(path.join(server.dir, "save", "worlds_local", "Yggdrasil"))).toContain("_main.1.db2");
        // the session is the run's, and the run is over
        expect(await call(server, "valheimSession")).toBeNull();
    });

    test("a run ends with its players and its session; while it runs, the session is what it was started with, after a restart of Paperboard too", async () => {
        const server = await valheimServer();
        await call(server, "writeGameOptions", { patch: { world: "Yggdrasil", crossplay: true } });
        await online(server);
        serverSays(server.dir, `Got connection SteamID ${STEAM_ID}`, "Got character ZDOID from Ragnar : 12345:1");
        await server.server.waitFor((s) => s.onlinePlayers.includes("Ragnar"), "Ragnar to join");
        await waitUntil(async () => !!((await call(server, "valheimSession")) as { joinCode: string | null }).joinCode, 5_000, "the join code in the log");

        // options are for the next start: the running server keeps its world and crossplay
        await call(server, "writeGameOptions", { patch: { world: "Asgard", crossplay: false } });
        const run = { world: "Yggdrasil", listed: false, crossplay: true };
        expect(await call(server, "valheimSession")).toMatchObject(run);
        // Paperboard restarted with the server running: it reads what the start recorded
        await server.server.game.initialize(true);
        expect(await call(server, "valheimSession")).toMatchObject(run);
        expect(((await call(server, "valheimPlayers")) as { online: unknown[] }).online).toEqual([{ name: "Ragnar", id: `Steam_${STEAM_ID}` }]);

        // Ragnar is still on as it stops, and its log never says he left; the Players tab reads again as it goes offline
        const read = server.server.waitFor((s) => s.serverStatus === "offline", "the stop").then(() => call(server, "valheimPlayers") as Promise<{ online: unknown[] }>);
        await stop(server);
        expect((await read).online).toEqual([]);
        expect(await call(server, "valheimSession")).toBeNull();
        await server.server.lifecycle.released;
        expect(fs.existsSync(path.join(server.dir, ".valheim-run.json"))).toBe(false);
    });

    test("a restart of Paperboard reads only this run's console: an earlier run's players and join code stay with it, also once the launch line is trimmed away", async () => {
        const server = await valheimServer();
        await call(server, "writeGameOptions", { patch: { world: "Yggdrasil", crossplay: true } });
        await online(server);
        serverSays(server.dir, `Got connection SteamID ${STEAM_ID}`, "Got character ZDOID from Ragnar : 12345:1");
        await server.server.waitFor((s) => s.onlinePlayers.includes("Ragnar"), "Ragnar to join");
        await waitUntil(async () => !!((await call(server, "valheimSession")) as { joinCode: string | null }).joinCode, 5_000, "the join code in the log");
        // Ragnar is on as it stops, and Valheim logs no leave for him
        await stop(server);
        // the run's last lines, still held back as it exits, go above what the exit says
        const lines = server.server.state.serverEntries.map((e) => String(e.content));
        expect(lines.findIndex((l) => l.endsWith("Net scene destroyed"))).toBe(lines.indexOf("[Server] Process stopped.") - 1);
        await server.server.lifecycle.released;

        fs.rmSync(path.join(server.dir, "install", "fake-valheim-lines.txt"));
        await call(server, "writeGameOptions", { patch: { crossplay: false } });
        await online(server);
        serverSays(server.dir, "Got connection SteamID 76561198000000002", "Got character ZDOID from Bjorn : 23456:1");
        // the console publishes its lines a moment after they are read
        await server.server.waitFor((s) => s.serverEntries.some((e) => String(e.content).endsWith("from Bjorn : 23456:1")), "Bjorn's join in the console");
        // the console still holds the first run's lines, above this one's
        expect(consoleOf(server)).toContain("join code 150661");
        expect(consoleOf(server)).toContain("from Ragnar");

        // Paperboard restarted with the server running: a new service reads what the console kept
        const reattach = async () => {
            const game = valheimService(server.server);
            await game.initialize(true);
            const ask = async (id: string) => pickCall(await game.calls(), id)(server.server, {});
            return { session: await ask("valheimSession"), online: ((await ask("valheimPlayers")) as { online: unknown[] }).online };
        };
        const bjorn = [{ name: "Bjorn", id: "Steam_76561198000000002" }];
        const run = { world: "Yggdrasil", listed: false, crossplay: false, joinCode: null, address: null };
        expect(await reattach()).toEqual({ session: run, online: bjorn } as never);
        // a run long enough that the history trimmed its launch line away keeps only its own lines
        const launch = server.server.state.serverEntries.findLastIndex((e) => String(e.content).startsWith("Starting Valheim"));
        server.server.setState({ serverEntries: server.server.state.serverEntries.slice(launch + 1) });
        expect(await reattach()).toEqual({ session: run, online: bjorn } as never);
        await stop(server);
    });

    test("the server's port and the next are claimed as one: a taken second port moves both, and the run uses the moved pair", async () => {
        const server = await valheimServer();
        const chosen = Number(server.server.settings.port);
        // another program on the port after the chosen one, which Valheim also opens
        const holder = dgram.createSocket("udp4");
        await new Promise<void>((resolve) => holder.bind(chosen + 1, "0.0.0.0", () => resolve()));
        try {
            await online(server);
            const moved = Number(started(server).args[started(server).args.indexOf("-port") + 1]);
            expect(moved).toBeGreaterThan(chosen + 1);
            expect(server.server.state.portMoves).toEqual([{ label: "Valheim", from: chosen, to: moved, primary: true, count: 2 }]);
            const claim = (await portApi.list(PANEL_ID)).find((c) => c.name === `${server.server.id}-valheim`);
            expect([claim?.port, claim?.count]).toEqual([moved, 2]);
            // Options and the next start keep the chosen port
            expect((await call(server, "readGameOptions") as { port: number }).port).toBe(chosen);
            await stop(server);
            expect(server.server.state.portMoves).toEqual([]);
        } finally {
            await new Promise<void>((resolve) => holder.close(() => resolve()));
        }
        // the pair is free again: the next run opens the chosen one
        await online(server);
        expect(started(server).args[started(server).args.indexOf("-port") + 1]).toBe(String(chosen));
        await stop(server);
    });

    test("a world it has is up once the server is connected; one it makes, once its locations are generated; a password it refuses fails the start before and after launch", async () => {
        const server = await valheimServer();
        const generated = path.join(server.dir, "install", "generated");
        await online(server);
        // the new world came online only after its locations were generated
        expect(fs.existsSync(generated)).toBe(true);
        await stop(server);
        // the world it has now needs no generating
        fs.rmSync(generated);
        await online(server);
        expect(fs.existsSync(generated)).toBe(false);
        await stop(server);

        // checked before the start: a public server needs a password, and one too short is refused
        await expect(call(server, "writeGameOptions", { patch: { public: true } })).rejects.toThrow("A public Valheim server needs a join password");
        await expect(call(server, "writeGameOptions", { patch: { password: "abc" } })).rejects.toThrow("at least 5 characters");
        await expect(call(server, "writeGameOptions", { patch: { world: "Dedicated", password: "dica" } })).rejects.toThrow();
        expect(passwordProblem("Dedi", "Dedicated", false)).toContain("at least 5");
        expect(passwordProblem("dicat", "Dedicated", false)).toBe("The join password can't be part of the world's name");
        expect(passwordProblem("", "Dedicated", false)).toBeNull();
        for (const bad of ["", " lead", "a/b", "..", "x".repeat(41), "new\nline"]) expect(() => worldName(bad)).toThrow("World must be");
        // a password set around Options is refused before the launch
        const refusing = await valheimServer({ refusePassword: true }, { public: true });
        await secretsApi.set(`${refusing.server.id}-valheim-join-password`, "abc", PANEL_ID);
        await expect(startServerInstance(refusing.server)).rejects.toThrow("at least 5 characters");
        // the server also checks it against the world's seed, which Paperboard can't know: its own refusal ends the start, and says why
        await secretsApi.set(`${refusing.server.id}-valheim-join-password`, "abcde", PANEL_ID);
        await startServerInstance(refusing.server);
        await refusing.server.waitFor((s) => s.serverStatus === "offline", "the refused start to end");
        await refusing.server.waitFor((s) => s.serverEntries.some((e) => e.type === "error" && String(e.content).endsWith("Error bad password:Password can't be in the world's name or seed")), "the server's refusal in the console, as an error");
    });

    test("players come from the log: a character is matched to its connection, a death is no leave, and crossplay's lost connections leave until they resume", () => {
        const log = new ValheimLog();
        const at = (line: string) => log.read(`11/27/2026 02:26:47: ${line}`);
        expect(at(`Got connection SteamID ${STEAM_ID}`)).toEqual([]);
        expect(at("Got connection SteamID 76561198000000002")).toEqual([]);
        expect(at("Got character ZDOID from Ragnar : 12345:1")).toEqual([{ kind: "joined", player: { name: "Ragnar", id: `Steam_${STEAM_ID}` } }]);
        expect(at("Got character ZDOID from Lagertha : 999:1")).toEqual([{ kind: "joined", player: { name: "Lagertha", id: "Steam_76561198000000002" } }]);
        // death, then respawn: still on
        expect(at("Got character ZDOID from Ragnar : 0:0")).toEqual([]);
        expect(at("Got character ZDOID from Ragnar : 12345:2")).toEqual([]);
        expect(at(`Closing socket ${STEAM_ID}`)).toEqual([{ kind: "left", player: { name: "Ragnar", id: `Steam_${STEAM_ID}` } }]);
        expect(log.online().map((p) => p.name)).toEqual(["Lagertha"]);
        // crossplay: the socket is PlayFab's, the id the player's platform
        at("PlayFab socket with remote ID 64E76AA90B114895 received local Platform ID Xbox_2535411234567890");
        expect(at("Got character ZDOID from Bjorn : 77:1")).toEqual([{ kind: "joined", player: { name: "Bjorn", id: "Xbox_2535411234567890" } }]);
        expect(at("Keep socket for 64E76AA90B114895, try to reconnect before timeout")).toEqual([{ kind: "left", player: { name: "Bjorn", id: "Xbox_2535411234567890" } }]);
        expect(at("Resume TX on 64E76AA90B114895")).toEqual([{ kind: "joined", player: { name: "Bjorn", id: "Xbox_2535411234567890" } }]);
        // a character with no connection waiting is not guessed at
        expect(at("Got character ZDOID from Stranger : 5:1")).toEqual([]);
        expect(at("Session \"Midgard\" registered with join code 888213")).toEqual([{ kind: "join-code", code: "888213", address: null }]);
        expect(at("Loading: Done. Total seconds sinze ZNet start: 16.99705, Genloc duration: 13574.565 ms")).toEqual([{ kind: "generated" }]);
        expect(at("World save (5/5) done. Total time [28ms]")).toEqual([{ kind: "saved" }]);
    });

    test("joins and leaves reach the console, chat and Blocks; bans, admins and permits are the server's own list files, kept with their comments while it runs", async () => {
        const server = await valheimServer();
        const fired: [string, unknown][] = [];
        const trigger = server.server.trigger.bind(server.server);
        server.server.trigger = (id, output) => { fired.push([id, output]); trigger(id, output); };
        await online(server);
        serverSays(server.dir, `Got connection SteamID ${STEAM_ID}`, "Got character ZDOID from Ragnar : 12345:1");
        await server.server.waitFor((s) => s.onlinePlayers.includes("Ragnar"), "Ragnar to join");
        expect(fired).toContainEqual([TRIGGER_IDS.playerJoined, "Ragnar"]);
        expect(server.server.state.chatMessages.at(-1)?.text).toBe("Ragnar joined the game");

        await call(server, "valheimList", { list: "admin", id: `Steam_${STEAM_ID}`, name: null, on: true });
        await call(server, "valheimList", { list: "permitted", id: `Steam_${STEAM_ID}`, name: null, on: true });
        // a ban of a player Paperboard only knows by name is by name, which the server matches too
        await call(server, "valheimList", { list: "banned", id: null, name: "Griefer", on: true });
        await call(server, "valheimList", { list: "banned", id: `Steam_${STEAM_ID}`, name: null, on: true });
        expect(list(server, "adminlist.txt")).toBe(`// List admin players ID  ONE per line\nSteam_${STEAM_ID}\n`);
        expect(list(server, "bannedlist.txt")).toBe(`// List banned players ID  ONE per line\nGriefer\nSteam_${STEAM_ID}\n`);
        const roster = await call(server, "valheimPlayers") as { seen: { name: string }[]; online: unknown[]; admin: string[]; banned: string[]; permitted: string[] };
        expect([roster.online, roster.admin, roster.banned, roster.permitted, roster.seen.map((p) => p.name)])
            .toEqual([[{ name: "Ragnar", id: `Steam_${STEAM_ID}` }], [`Steam_${STEAM_ID}`], ["Griefer", `Steam_${STEAM_ID}`], [`Steam_${STEAM_ID}`], ["Ragnar"]]);

        // the server kicks a banned player itself; its socket closes
        serverSays(server.dir, `Closing socket ${STEAM_ID}`);
        await server.server.waitFor((s) => !s.onlinePlayers.includes("Ragnar"), "Ragnar to leave");
        expect(fired).toContainEqual([TRIGGER_IDS.playerLeft, "Ragnar"]);

        // an unban takes every entry that is them, a bare Steam id too, and leaves comments and the rest
        fs.appendFileSync(path.join(server.dir, "save", "bannedlist.txt"), `// added by hand\n${STEAM_ID}\n`);
        await call(server, "valheimList", { list: "banned", id: `Steam_${STEAM_ID}`, name: null, on: false });
        expect(list(server, "bannedlist.txt")).toBe("// List banned players ID  ONE per line\nGriefer\n// added by hand\n");

        // Blocks: no kick (the server can't do one), the list blocks by the names players are known by
        const blocks = await server.server.game.blocks!();
        const ids = (blocks.commands ?? []).map((c) => c.id);
        expect(ids).toEqual(expect.arrayContaining(["ban-player", "unban-player", "make-admin", "remove-admin", "permit-player", "unpermit-player"]));
        expect(ids).not.toContain("kick-player");
        const run = (id: string, inputs: unknown) => (blocks.commands ?? []).find((c) => c.id === id)!.run(inputs as never, undefined as never);
        const read = (id: string) => (blocks.values ?? []).find((v) => v.id === id)!.read(undefined as never, undefined as never);
        await run("remove-admin", { player: "Ragnar" });
        expect(await read("admins")).toEqual([]);
        expect(await read("permitted-players")).toEqual(["Ragnar"]);
        await run("ban-player", { player: "Ragnar" });
        expect(await read("banned-players")).toEqual(["Griefer", "Ragnar"]);
        await expect(run("make-admin", { player: "Griefer" })).rejects.toThrow("platform id");
        await expect(call(server, "valheimList", { list: "banned", id: "Steam_1\nSteam_2", name: null, on: true })).rejects.toThrow("platform id");
        // an id is a platform id: a name given as one would be an entry the server never matches
        await expect(call(server, "valheimList", { list: "admin", id: "bob", name: null, on: true })).rejects.toThrow("platform id");
        expect(list(server, "adminlist.txt")).not.toContain("bob");
        await stop(server);
    });

    test("a backup stops the server, which saves as it quits, and starts it again; a stop that saved nothing refuses the copy", async () => {
        const server = await valheimServer();
        await online(server);
        const exit = server.nextExit();
        await server.server.game.backup.before();
        expect(await exit).toBe(0);
        expect(server.server.state.serverStatus).toBe("offline");
        await server.server.game.backup.after();
        await server.server.waitFor((s) => s.serverStatus === "online", "Valheim to start again");
        await stop(server);

        const unsaved = await valheimServer({ noSaveOnExit: true });
        await online(unsaved);
        await expect(unsaved.server.game.backup.before()).rejects.toThrow("exited without confirming its shutdown save");
        // the marker the stop left starts it again once the backup gives up
        await unsaved.server.game.backup.after();
        await unsaved.server.waitFor((s) => s.serverStatus === "online", "Valheim to start again");
        await stop(unsaved);
    });

    test("arguments are built only from values the server's parser takes whole", () => {
        const base = { name: "Midgard", world: "Dedicated", public: false, crossplay: false, preset: "normal", saveinterval: 30, backups: 4, backupshort: 120, backuplong: 720 };
        expect(launchArgs(base, { port: 2456, saveDir: "/s", password: "" })).toEqual(["-nographics", "-batchmode", "-name", "Midgard", "-port", "2456", "-world", "Dedicated", "-savedir", "/s", "-public", "0", "-saveinterval", "1800", "-backups", "4", "-backupshort", "7200", "-backuplong", "43200", "-preset", "normal"]);
        expect(() => launchArgs({ ...base, name: 'say "hi"' }, { port: 2456, saveDir: "/s", password: "" })).toThrow("Server name");
        expect(() => launchArgs({ ...base, world: "../x" }, { port: 2456, saveDir: "/s", password: "" })).toThrow("World must be");
    });
});
