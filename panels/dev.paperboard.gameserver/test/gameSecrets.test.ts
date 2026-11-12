import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { secretsApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { gameServer, type GameServer } from "./helpers/game";
import { freePort, installPalworld } from "./helpers/palworld";
import { placeStandIn } from "./helpers/standIn";
import { PANEL_ID } from "../src/servers";
import { CALLS } from "../src/service/contract";
import { processApi } from "../src/service/api";
import { sendServerCommand, startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { gameServiceFor } from "../src/games/service";
import { releaseFor, entrypoint } from "../src/games/terraria/catalog";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const call = async (server: GameServer, id: string, input: unknown) => {
    const def = (await gameServiceFor(server.scope.server.game).calls())[id];
    if (!def) throw new Error(`${server.scope.server.game} has no call ${id}`);
    return server.run(() => def(server.scope.ctx, input));
};
const vault = async (server: GameServer, name: string) => (await secretsApi.get(`${server.scope.server.id}-${server.scope.server.game}-${name}`, PANEL_ID)).value ?? "";
/** every file in the server folder that holds `text` */
function filesHolding(root: string, text: string): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile() && fs.readFileSync(file).includes(text)) found.push(path.relative(root, file));
        }
    };
    walk(root);
    return found;
}

async function terrariaServer(): Promise<GameServer> {
    const release = releaseFor("1.4.5.8");
    const server = gameServer("terraria", {
        settings: { configured: true, version: release.version, port: await freePort() },
        files: { [`install/${release.directory}/manifest.json`]: JSON.stringify({ software: "vanilla", version: release.version, sha256: release.sha256, os: process.platform, arch: process.arch }) },
        state: gameServiceFor("terraria").initialState(),
    });
    placeStandIn("fakeTerraria", path.join(server.dir, "install", release.directory, entrypoint(process.platform)));
    await server.run(() => gameServiceFor("terraria").initialize(server.scope.ctx, false));
    return server;
}

// Game server secrets and inputs can't leak or break out.
describe("game server secrets and inputs", () => {
    test("Terraria's join password lives in the vault, is hidden in the console and chat, and is in its config only while it runs", async () => {
        const server = await terrariaServer();
        const secret = "tera-Secret-7";
        await call(server, CALLS.writeGameOptions, { patch: { password: secret } });
        expect(await vault(server, "join-password")).toBe(secret);
        expect(JSON.stringify(server.scope.server.settings)).not.toContain(secret);
        expect(filesHolding(server.dir, secret)).toEqual([]);

        await server.run(() => startServerInstance(server.scope.ctx));
        await server.scope.waitFor((s) => s.serverStatus === "online", "Terraria to listen");
        expect(JSON.parse(fs.readFileSync(path.join(server.dir, "install", "1458", "Linux", "started-with.json"), "utf8")).password).toBe(secret);
        await server.scope.waitFor((s) => s.serverEntries.some((e) => e.content.includes("Loaded config")), "Terraria's config line");
        // a player says it in chat
        await server.run(() => processApi.write("terraria-server", `relay <Bob> join with ${secret} everyone\n`));
        await server.scope.waitFor((s) => s.chatMessages.some((m) => (m.content ?? m.text ?? "").includes("join with")), "Bob's chat line");
        const shown = JSON.stringify([server.scope.ctx.state.serverEntries, server.scope.ctx.state.chatMessages]);
        expect(shown).toContain("password=[redacted]");
        expect(shown).toContain("join with [redacted] everyone");
        expect(shown).not.toContain(secret);
        // the running config can't be opened, and the console can't set or reveal it
        const service = gameServiceFor("terraria");
        await expect(server.run(() => service.assertFileAccess!(server.scope.ctx, "serverconfig.txt", false))).rejects.toThrow("contains vault credentials while running");
        await expect(server.run(() => sendServerCommand(server.scope.ctx, "password hunter2"))).rejects.toThrow("Use Options for the password");

        const exit = server.nextExit();
        await server.run(() => stopServerInstance(server.scope.ctx));
        expect(await exit).toBe(0);
        // stopped, the folder (which backups copy) holds no password; the stand-in's own record of its start aside
        expect(filesHolding(server.dir, secret).filter((f) => !f.endsWith("started-with.json"))).toEqual([]);
    });

    test("TF2's RCON and join passwords live in the vault and never in settings or its config files; unsafe hostnames, maps, plugins and commands are refused", async () => {
        const server = gameServer("team-fortress-2", {
            files: { "install/tf/maps/ctf_2fort.bsp": "bsp", "install/tf/cfg/server.cfg": "// the game's own\n" },
            state: gameServiceFor("team-fortress-2").initialState(),
        });
        const service = gameServiceFor("team-fortress-2");
        await server.run(() => service.initialize(server.scope.ctx, false));
        await call(server, CALLS.writeGameOptions, { patch: { rconPassword: "rcon-Secret-1", password: "join-Secret-1", hostname: "My Server" } });
        expect([await vault(server, "rcon-password"), await vault(server, "join-password")]).toEqual(["rcon-Secret-1", "join-Secret-1"]);
        // writing the rotation writes the game's config files from the settings
        await call(server, "team-fortress-2-map-cycle-set", { maps: ["ctf_2fort"] });
        expect(fs.existsSync(path.join(server.dir, "install", "tf", "cfg", "paperboard_mapcycle.txt"))).toBe(true);
        expect(JSON.stringify(server.scope.server.settings)).not.toMatch(/rcon-Secret-1|join-Secret-1/);
        expect([...filesHolding(server.dir, "rcon-Secret-1"), ...filesHolding(server.dir, "join-Secret-1")]).toEqual([]);

        const settingsBefore = JSON.stringify(server.scope.server.settings);
        for (const hostname of ['x"; rcon_password y', "a;quit", "two\nlines"]) {
            await expect(call(server, CALLS.writeGameOptions, { patch: { hostname } })).rejects.toThrow();
        }
        await expect(call(server, "team-fortress-2-map-cycle-set", { maps: ["../../cfg/server"] })).rejects.toThrow("Choose a map by its name");
        await expect(call(server, "team-fortress-2-plugin-remove", { file: "../../../server.cfg" })).rejects.toThrow();
        await expect(call(server, "team-fortress-2-ban", { steamId: "[U:1:1]; quit" })).rejects.toThrow("Steam id");
        await expect(server.run(() => sendServerCommand(server.scope.ctx, "rcon_password stolen"))).rejects.toThrow("Paperboard manages the RCON password");
        await expect(server.run(() => service.assertFileAccess!(server.scope.ctx, "install/tf/cfg/paperboard_secrets.cfg", false))).rejects.toThrow("holds Team Fortress 2's passwords");
        expect(JSON.stringify(server.scope.server.settings)).toBe(settingsBefore);
        expect(fs.readFileSync(path.join(server.dir, "install", "tf", "cfg", "server.cfg"), "utf8")).not.toContain("rcon_password y");
    });

    test("Palworld refuses unsafe user ids and writes into its managed install", async () => {
        const server = gameServer("palworld", { settings: { port: await freePort(), restPort: await freePort() }, state: gameServiceFor("palworld").initialState() });
        installPalworld(server.dir);
        const service = gameServiceFor("palworld");
        await server.run(() => service.initialize(server.scope.ctx, false));
        for (const userId of ["steam_1;rm -rf", "../players", "", "x".repeat(65)]) {
            await expect(call(server, "palworld-kick", { userId })).rejects.toThrow("Choose a player by their Palworld user id");
            await expect(call(server, "palworld-ban", { userId })).rejects.toThrow("Choose a player by their Palworld user id");
        }
        const binary = fs.readFileSync(path.join(server.dir, "install", "PalServer.sh"));
        await expect(server.run(() => service.assertFileAccess!(server.scope.ctx, "install/PalServer.sh", true))).rejects.toThrow("Installed Palworld files are managed by Updates");
        expect(fs.readFileSync(path.join(server.dir, "install", "PalServer.sh"))).toEqual(binary);
    });
});
