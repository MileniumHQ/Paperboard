import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { secretsApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { gameServer, type GameServer } from "./helpers/game";
import { freePort } from "./helpers/palworld";
import { allowLoopbackSocket, installRust } from "./helpers/rust";
import { PANEL_ID } from "../src/servers";
import { CALLS } from "../src/service/contract";
import { sendServerCommand, startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { argValue, rconPasswordRule, rustService } from "../src/games/rust/service";
import { parseBanList, parseBansCfg, steamId } from "../src/games/rust/roster";
import { parseInfo, parsePlayers, RustRcon, RustRconSilent, RustRconUnreachable } from "../src/games/rust/webrcon";
import { PNG } from "pngjs";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

async function rustServer(plan?: Record<string, unknown>): Promise<GameServer & { rconPort: number }> {
    const rconPort = await freePort();
    allowLoopbackSocket(rconPort);
    const server = gameServer("rust", {
        settings: { port: await freePort(), queryPort: await freePort(), rconPort, appPort: await freePort(), worldsize: 1000, seed: 12345 },
        state: rustService.initialState(),
    });
    installRust(server.dir, plan);
    await server.run(() => rustService.initialize(server.scope.ctx, false));
    return Object.assign(server, { rconPort });
}
const call = async (server: GameServer, id: string, input: unknown = {}) => server.run(async () => (await rustService.calls())[id]!(server.scope.ctx, input));
const vault = async (server: GameServer) => (await secretsApi.get(`${server.scope.server.id}-rust-rcon-password`, PANEL_ID)).value ?? "";
const consoleOf = (server: GameServer) => server.scope.ctx.state.serverEntries.map((e) => String(e.content)).join("\n");
const online = async (server: GameServer) => {
    await server.run(() => startServerInstance(server.scope.ctx));
    await server.scope.waitFor((s) => s.serverStatus === "online", "Rust to finish starting");
};
const stop = async (server: GameServer) => {
    const exit = server.nextExit();
    await server.run(() => stopServerInstance(server.scope.ctx));
    expect(await exit).toBe(0);
};
const BANNED = "76561198000000001";

// Rust, against a stand-in that answers as the real server was measured to (build 26498655).
describe("Rust", () => {
    test("the RCON password lives in the vault, reaches the server only on its command line, and is hidden where the server prints that; save, bans and live options go over the remote console", async () => {
        const server = await rustServer();
        await call(server, CALLS.writeGameOptions, { patch: { hostname: "My Rust", maxplayers: 20 } });
        await online(server);
        const password = await vault(server);
        expect(password.length).toBeGreaterThanOrEqual(20);
        const started = JSON.parse(fs.readFileSync(path.join(server.dir, "install", "started-with.json"), "utf8")).args as string[];
        const given = (name: string) => started[started.indexOf(`+${name}`) + 1];
        expect([given("rcon.password"), given("rcon.ip"), given("rcon.web"), given("server.hostname"), given("server.maxplayers"), given("server.worldsize"), given("server.seed"), given("server.gamemode"), given("server.pve")])
            .toEqual([password, "127.0.0.1", "1", "My Rust", "20", "1000", "12345", "vanilla", "false"]);
        // an empty description has no argument to be
        expect(started).not.toContain("+server.description");
        // the server prints its command line; the console shows it without the password
        await server.scope.waitFor((s) => s.serverEntries.some((e) => String(e.content).startsWith("Command Line:")), "Rust's command line in the console");
        expect(consoleOf(server)).toContain('"+rcon.password" "[redacted]"');
        expect(consoleOf(server)).not.toContain(password);
        expect(JSON.stringify(server.scope.server.settings)).not.toContain(password);
        expect(server.scope.ctx.state.maxPlayers).toBe(20);
        expect(server.scope.ctx.state.serverVersion).toBe("2636.290.1");
        // the map and saves are the server folder's, linked into the install
        expect(fs.lstatSync(path.join(server.dir, "install", "server")).isSymbolicLink()).toBe(true);

        const save = path.join(server.dir, "server", "paperboard", "proceduralmap.1000.12345.290.sav");
        expect(fs.existsSync(save)).toBe(false);
        await call(server, CALLS.saveWorld);
        expect(fs.readFileSync(save, "utf8")).toStartWith("save 1 ");

        await call(server, "rust-ban", { steamId: BANNED });
        expect((await call(server, "rust-players") as { bans: unknown[] }).bans).toEqual([{ steamId: BANNED, name: BANNED, reason: "Banned by the server admin" }]);
        expect(fs.readFileSync(path.join(server.dir, "server", "paperboard", "cfg", "bans.cfg"), "utf8")).toBe(`banid ${BANNED} "${BANNED}" "Banned by the server admin" -1\n`);
        await expect(call(server, "rust-kick", { steamId: BANNED })).rejects.toThrow("That player is not online");
        for (const bad of ["STEAM_0:1:1", "[U:1:1]", `${BANNED}" "x`, "765611980000000019", ""]) await expect(call(server, "rust-ban", { steamId: bad })).rejects.toThrow("Steam id");

        await call(server, CALLS.writeGameOptions, { patch: { maxplayers: 12 } });
        expect((await call(server, "rust-metrics") as { MaxPlayers: number }).MaxPlayers).toBe(12);

        // the console: an answer is shown, a command Rust doesn't know fails out loud, and Stop's own commands are refused
        await server.run(() => sendServerCommand(server.scope.ctx, "status"));
        await server.scope.waitFor((s) => s.serverEntries.some((e) => String(e.content) === "hostname: My Rust"), "the status answer in the console");
        await expect(server.run(() => sendServerCommand(server.scope.ctx, "quit"))).rejects.toThrow("use Options, Stop and Restart");
        await expect(server.run(() => sendServerCommand(server.scope.ctx, "rcon.password stolen"))).rejects.toThrow("Paperboard manages the RCON password");
        await expect(server.run(() => sendServerCommand(server.scope.ctx, "status\nquit"))).rejects.toThrow();
        await expect(server.run(() => rustService.assertFileAccess!(server.scope.ctx, "server/paperboard/cfg/users.cfg", true))).rejects.toThrow("Stop Rust before editing its files");
        await expect(server.run(() => rustService.assertFileAccess!(server.scope.ctx, "install/RustDedicated", true))).rejects.toThrow("Installed Rust files are managed by Updates");

        await stop(server);
        // stopped: the ban list is read from the file the server keeps, and changing it waits for the server
        expect((await call(server, "rust-players") as { bans: { steamId: string }[] }).bans.map((b) => b.steamId)).toEqual([BANNED]);
        await expect(call(server, "rust-unban", { steamId: BANNED })).rejects.toThrow("Start the server to ban or unban players");
    });

    test("the running server draws its map once, the world alone is kept beside the map's files, and a wipe takes it too", async () => {
        const server = await rustServer();
        expect(await call(server, "rust-map-picture")).toBeNull();
        await expect(call(server, "rust-map-draw")).rejects.toThrow("Start Rust to draw its map");
        await online(server);
        const drawn = await call(server, "rust-map-draw") as string;
        expect(drawn.startsWith("data:image/png;base64,")).toBe(true);
        // the ocean border is cut off: the picture starts at the world's corner, and is the world's width at the picture's scale
        const png = PNG.sync.read(Buffer.from(drawn.slice("data:image/png;base64,".length), "base64"));
        expect([png.width, png.height]).toEqual([1024, 1024]);
        const pixel = (x: number, y: number) => [...png.data.subarray((y * 1024 + x) * 4, (y * 1024 + x) * 4 + 3)];
        expect([pixel(0, 0), pixel(1, 0), pixel(1023, 1023)]).toEqual([[255, 0, 0], [60, 140, 60], [60, 140, 60]]);
        // the render itself doesn't stay in the game's folder
        expect(fs.readdirSync(path.join(server.dir, "install")).filter((name) => name.startsWith("map_"))).toEqual([]);
        const identity = path.join(server.dir, "server", "paperboard");
        expect(fs.existsSync(path.join(identity, "proceduralmap.1000.12345.png"))).toBe(true);
        expect(await call(server, "rust-map-picture")).toBe(drawn);
        await stop(server);

        await call(server, "rust-wipe", { blueprints: false });
        expect(await call(server, "rust-map-picture")).toBeNull();
        const trash = fs.readdirSync(server.dir).filter((name) => name.startsWith(".trash-"));
        expect(fs.readdirSync(path.join(server.dir, trash[0]!, "server", "paperboard"))).toContain("proceduralmap.1000.12345.png");
    });

    test("a wipe moves the map and what was on it to the trash, keeps blueprints unless asked, gives a new seed, and never runs on a running server", async () => {
        const server = await rustServer();
        await online(server);
        await call(server, CALLS.saveWorld);
        await expect(call(server, "rust-wipe", { blueprints: false })).rejects.toThrow("Stop Rust");
        await stop(server);
        const identity = path.join(server.dir, "server", "paperboard");
        for (const name of ["proceduralmap.1000.12345.290.map", "player.states.290.db", "player.states.290.db-wal", "player.deaths.19.db", "sv.files.290.db", "player.blueprints.19.db", "player.blueprints.19.db-wal", "player.identities.19.db", "player.tokens.db"]) fs.writeFileSync(path.join(identity, name), name);
        expect(await call(server, "rust-map")).toEqual({ size: 1000, seed: 12345, made: true, blueprints: true });
        await expect(call(server, "rust-wipe", {})).rejects.toThrow("Choose whether blueprints are wiped too");

        const wiped = await call(server, "rust-wipe", { blueprints: false }) as { seed: number; made: boolean; blueprints: boolean };
        expect(wiped).toMatchObject({ size: 1000, made: false, blueprints: true });
        expect(wiped.seed).not.toBe(12345);
        expect(server.scope.server.settings.seed).toBe(wiped.seed);
        const left = () => fs.readdirSync(identity).filter((name) => name !== "cfg").sort();
        // who the players are, their blueprints and the ban list stay
        expect(left()).toEqual(["player.blueprints.19.db", "player.blueprints.19.db-wal", "player.identities.19.db", "player.tokens.db"]);
        expect(fs.existsSync(path.join(identity, "cfg", "bans.cfg"))).toBe(true);
        const trash = fs.readdirSync(server.dir).filter((name) => name.startsWith(".trash-"));
        expect(trash.length).toBe(1);
        expect(fs.readdirSync(path.join(server.dir, trash[0]!, "server", "paperboard")).sort()).toEqual(["player.deaths.19.db", "player.states.290.db", "player.states.290.db-wal", "proceduralmap.1000.12345.290.map", "proceduralmap.1000.12345.290.sav", "sv.files.290.db"]);
        // nothing was deleted: the old map is whole in the trash
        expect(fs.readFileSync(path.join(server.dir, trash[0]!, "server", "paperboard", "proceduralmap.1000.12345.290.map"), "utf8")).toBe("proceduralmap.1000.12345.290.map");

        await Bun.sleep(5);
        expect(await call(server, "rust-wipe", { blueprints: true })).toMatchObject({ made: false, blueprints: false });
        expect(left()).toEqual(["player.identities.19.db", "player.tokens.db"]);
        // the next start is on the new seed
        await online(server);
        const started = JSON.parse(fs.readFileSync(path.join(server.dir, "install", "started-with.json"), "utf8")).args as string[];
        expect(started[started.indexOf("+server.seed") + 1]).toBe(String(server.scope.server.settings.seed));
        await stop(server);
    });

    test("a save Rust answers without writing its file is refused", async () => {
        const server = await rustServer({ noSave: true });
        await online(server);
        const original = Date.now;
        try {
            // the wait for the file is a minute; the clock is run forward once the answer is in
            const saving = call(server, CALLS.saveWorld);
            await Bun.sleep(300);
            Date.now = () => original() + 120_000;
            await expect(saving).rejects.toThrow("Timed out waiting for Rust to write its save");
        } finally { Date.now = original; }
        await stop(server);
    });

    test("the remote console never names its address in an error, tells an unknown command from a lost connection, and fails what is waiting when the server goes", async () => {
        const server = await rustServer();
        await online(server);
        const password = await vault(server);

        const wrong = new RustRcon(server.rconPort, "not-the-password", 2_000);
        const refused = await wrong.exec("status").then(() => null, (err: Error) => err);
        expect(refused).toBeInstanceOf(RustRconUnreachable);
        expect(refused!.message).not.toMatch(/not-the-password|ws:\/\//);

        const rcon = new RustRcon(server.rconPort, password, 500);
        const chats: string[] = [];
        rcon.onChat = (chat) => chats.push(`${chat.Username}: ${chat.Message}`);
        // a log frame comes before every answer; it is not the answer
        expect(parseInfo(await rcon.exec("serverinfo")).Hostname).toBe("Rust Server");
        expect(await rcon.exec("server.save", { until: (m) => m.startsWith("Saving complete") })).toBe("Invalidate Network Cache took 0.00 seconds\nSaved 984 ents, cache(0.01), write(0.01), disk(0.00), navmesh(0.01).\nSaving complete");
        expect(await rcon.exec("say hello")).toBe("");
        expect(chats).toEqual(["SERVER: hello"]);
        const silent = await rcon.exec("nosuchcommand").then(() => null, (err: Error) => err);
        expect(silent).toBeInstanceOf(RustRconSilent);
        expect(silent!.message).toBe('Rust gave no answer to "nosuchcommand"');
        expect(() => rcon.exec("status\nquit")).toThrow("A command must be a single line");

        // a command still waiting when the server quits fails; it is not left hanging
        const waiting = rcon.exec("nosuchcommand", { timeoutMs: 30_000 }).then(() => null, (err: Error) => err);
        await stop(server);
        expect((await waiting)!.message).toBe("Rust closed its remote console");
        rcon.close();
    });

    test("values a command line or the remote console's address can't hold are refused before anything is saved", async () => {
        expect([argValue("My Server", "Server name"), argValue(true, "PvE"), argValue(3000, "Map size")]).toEqual(["My Server", "true", "3000"]);
        for (const bad of ['A "quoted" name', "+server.seed 1", "-batchmode", " +rcon.password x", "two\nlines", "nul\0"]) expect(() => argValue(bad, "Server name")).toThrow();
        expect(rconPasswordRule("abcDEF12_-")).toBe("abcDEF12_-");
        expect(rconPasswordRule("")).toBe("");
        for (const bad of ["short", "has space 1", "slash/inpath1", "x".repeat(65), "quote\"1234", 12345678]) expect(() => rconPasswordRule(bad)).toThrow("8 to 64");

        const server = await rustServer();
        const before = JSON.stringify(server.scope.server.settings);
        for (const patch of [{ hostname: 'x" +rcon.password "y' }, { description: "-nographics" }, { rconPassword: "short" }, { gamemode: "creative" }, { worldsize: 1250 }, { seed: -1 }, { maxplayers: 0 }]) {
            await expect(call(server, CALLS.writeGameOptions, { patch })).rejects.toThrow();
        }
        expect(JSON.stringify(server.scope.server.settings)).toBe(before);
        expect(await vault(server)).toBe("");

        expect(steamId(BANNED)).toBe(BANNED);
        expect(parseBanList(`1 ${BANNED} "Te st" "smoke" -1\n2 76561198000000002 "" "a \\"b\\"" 1794531869\nnot a ban\n`)).toEqual([{ steamId: BANNED, name: "Te st", reason: "smoke" }, { steamId: "76561198000000002", name: "", reason: 'a \\"b\\"' }]);
        expect(parseBansCfg(`banid ${BANNED} "Te st" "Banned by the server admin" -1\n\n`)).toEqual([{ steamId: BANNED, name: "Te st", reason: "Banned by the server admin" }]);
        expect(parsePlayers('[{"SteamID":"76561198000000001","OwnerSteamID":"0","DisplayName":"Ann","Ping":32,"Address":"1.2.3.4:5","ConnectedSeconds":120,"Health":100.0}]')).toEqual([{ steamId: BANNED, name: "Ann", ping: 32, connected: 120, health: 100 }]);
        expect(() => parsePlayers('[{"DisplayName":"Ann"}]')).toThrow("without a Steam id or a name");
        expect(() => parsePlayers("Unknown command")).toThrow("not JSON");
        expect(() => parseInfo('{"Hostname":"x"}')).toThrow("has no MaxPlayers");
    });
});
