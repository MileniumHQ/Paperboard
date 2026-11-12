import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { secretsApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { gameServer, type GameServer } from "./helpers/game";
import { DEFAULT_PALWORLD_INI, freePort, installPalworld } from "./helpers/palworld";
import { PANEL_ID } from "../src/servers";
import { CALLS } from "../src/service/contract";
import { startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { palworldService } from "../src/games/palworld/service";
import { decode, encode, parseOptionSettings, writeOptionSettings } from "../src/games/palworld/ini";
import { redact } from "../src/games/serviceKit";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const DEFAULT_INI = DEFAULT_PALWORLD_INI;
const INI = "saved/Config/LinuxServer/PalWorldSettings.ini";

async function palworldServer(files: Record<string, string> = {}): Promise<GameServer> {
    const server = gameServer("palworld", {
        settings: { port: await freePort(), restPort: await freePort() },
        files,
        state: palworldService.initialState(),
    });
    installPalworld(server.dir, files["install/fake-palworld.json"] ? JSON.parse(files["install/fake-palworld.json"]) : undefined);
    await server.run(() => palworldService.initialize(server.scope.ctx, false));
    return server;
}

const ini = (server: GameServer) => fs.readFileSync(path.join(server.dir, ...INI.split("/")), "utf8");
const entry = (text: string, key: string) => parseOptionSettings(text).find((e) => e.key === key)?.raw;
const vault = async (server: GameServer, name: string) => (await secretsApi.get(`${server.scope.server.id}-palworld-${name}`, PANEL_ID)).value ?? "";
/** the Files tab opening the settings file; it runs after any cleanup already queued */
const settled = (server: GameServer) => server.run(() => palworldService.assertFileAccess!(server.scope.ctx, INI, false));
const action = async (id: string) => (await palworldService.calls())[id]!;

// Secrets stay out of files and the console.
describe("secrets", () => {
    test("Palworld's passwords live in the vault, are in its settings file only while it runs, and never reach the console", async () => {
        const server = await palworldServer();
        await server.run(async () => (await action(CALLS.writeGameOptions))(server.scope.ctx, { patch: { password: "join-secret-1" } }));
        expect(await vault(server, "join-password")).toBe("join-secret-1");

        await server.run(() => startServerInstance(server.scope.ctx));
        await server.scope.waitFor((s) => s.serverStatus === "online", "Palworld to answer its REST API");
        // its output reaches the console apart from its REST answers
        await server.scope.waitFor((s) => s.serverEntries.some((e) => e.content.includes("Loaded settings")), "Palworld's settings line in the console");
        const admin = await vault(server, "admin-password");
        expect(admin.length).toBeGreaterThanOrEqual(20);
        // the game read both from its settings file as it started
        expect(JSON.parse(fs.readFileSync(path.join(server.dir, "install", "started-with.json"), "utf8"))).toMatchObject({ admin, join: "join-secret-1" });
        const console = server.scope.ctx.state.serverEntries.map((e) => e.content).join("\n");
        expect(console).toContain("[LOG] Loaded settings: AdminPassword=[redacted] ServerPassword=[redacted]");
        expect(console).not.toContain(admin);
        expect(console).not.toContain("join-secret-1");
        // opening the file while it holds the passwords is refused
        await expect(settled(server)).rejects.toThrow("Stop Palworld to open PalWorldSettings.ini");

        const exit = server.nextExit();
        await server.run(() => stopServerInstance(server.scope.ctx));
        expect(await exit).toBe(0);
        await settled(server);
        const after = ini(server);
        expect([entry(after, "AdminPassword"), entry(after, "ServerPassword")]).toEqual(['""', '""']);
        expect(after).not.toContain(admin);
        // the rest of the file is as the launch left it
        expect([entry(after, "ServerDescription"), entry(after, "CrossplayPlatforms"), entry(after, "RESTAPIEnabled")]).toEqual(['"Hi, all (friends)"', "(Steam,Xbox,PS5,Mac)", "True"]);
        expect(after.split("\n").slice(0, 2)).toEqual(["[/Script/Pal.PalGameWorldSettings]", expect.stringMatching(/^OptionSettings=\(/)]);
        expect(fs.statSync(path.join(server.dir, ...INI.split("/"))).mode & 0o777).toBe(0o600);
    });

    test("a server that dies while starting leaves no password in its settings file", async () => {
        const server = await palworldServer({ "install/fake-palworld.json": JSON.stringify({ exitAfterStart: 3 }) });
        const exit = server.nextExit();
        await server.run(() => startServerInstance(server.scope.ctx));
        expect(await exit).toBe(3);
        await settled(server);
        const admin = await vault(server, "admin-password");
        expect(admin).not.toBe("");
        expect(JSON.parse(fs.readFileSync(path.join(server.dir, "install", "started-with.json"), "utf8")).admin).toBe(admin);
        expect(entry(ini(server), "AdminPassword")).toBe('""');
        expect(ini(server)).not.toContain(admin);
        expect(server.scope.ctx.state.serverEntries.map((e) => e.content).join("\n")).not.toContain(admin);
    });

    test("a service starting next to a stopped server blanks passwords an earlier one left in the file", async () => {
        const server = await palworldServer();
        await server.run(() => palworldService.loadOptions!(server.scope.ctx));
        const left = DEFAULT_INI.replace('AdminPassword=""', 'AdminPassword="leftover-admin"').replace('ServerPassword=""', 'ServerPassword="leftover-join"').replace(/^;.*\n/gm, "");
        fs.mkdirSync(path.dirname(path.join(server.dir, ...INI.split("/"))), { recursive: true });
        fs.writeFileSync(path.join(server.dir, ...INI.split("/")), left);
        await server.run(() => palworldService.initialize(server.scope.ctx, false));
        expect([entry(ini(server), "AdminPassword"), entry(ini(server), "ServerPassword"), entry(ini(server), "Difficulty")]).toEqual(['""', '""', "None"]);
    });

    test("the settings file round-trips quoted commas and tuples, and a malformed one is refused rather than guessed", () => {
        const entries = parseOptionSettings(DEFAULT_INI);
        expect(entries.find((e) => e.key === "ServerDescription")!.raw).toBe('"Hi, all (friends)"');
        expect(entries.find((e) => e.key === "CrossplayPlatforms")!.raw).toBe("(Steam,Xbox,PS5,Mac)");
        expect(writeOptionSettings(DEFAULT_INI, entries)).toBe(DEFAULT_INI);
        for (const bad of [
            '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName="unclosed,Difficulty=None)',
            "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(CrossplayPlatforms=(Steam,Xbox)",
            "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=Difficulty=None",
            "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(Difficulty)",
            "[/Script/Pal.PalGameWorldSettings]\n",
        ]) {
            expect(() => parseOptionSettings(bad)).toThrow("PalWorldSettings.ini");
        }
        expect(() => decode("1.5x", "float", "ExpRate")).toThrow("is not a number");
        expect(() => decode("Yes", "bool", "bUseAuth")).toThrow("is not True or False");
        for (const value of ['pw",AdminPassword="x', "a\\b", "a\nb"]) expect(() => encode(value, "string", "Join password")).toThrow("can't hold quotes");
    });

    test("console lines have every secret taken out, wherever it appears", () => {
        expect(redact("rcon_password hunter2; echo hunter2hunter2", ["hunter2"])).toBe("rcon_password [redacted]; echo [redacted][redacted]");
        expect(redact("nothing secret", ["", "x-y"])).toBe("nothing secret");
    });
});
