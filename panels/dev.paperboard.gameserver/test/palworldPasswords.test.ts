// PalWorldSettings.ini holds the admin and join passwords while Palworld
// runs, because it reads them there as it starts. Once its process is gone
// (stopped, crashed, killed, restarted or never started) they must not be
// left in a file Files shows and backups copy.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as paperapi from "@mileniumhq/paperapi";
import { portApiStub } from "./portApiStub";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-palworld-passwords-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

// the vault, in memory
const vault = new Map<string, string>();
Object.assign(paperapi.secretsApi, {
    get: async (key: string) => ({ found: vault.has(key), value: vault.get(key) }),
    set: async (key: string, value: string) => { vault.set(key, value); },
    delete: async (key: string) => { vault.delete(key); },
});

// the daemon's process table: a started server stays until the test ends it
const processes: { id: string; command: string }[] = [];
let failStart: string | null = null;
let settings: Record<string, unknown> = {};
mock.module("../src/service/api", () => ({
    ...paperapi,
    portApi: portApiStub(),
    config: { get: async () => settings, set: async (value: Record<string, unknown>) => { settings = value; return true; } },
    files: { getPath: async () => root },
    system: { getInfo: async () => ({ os: process.platform }), getLocalIP: async () => "127.0.0.1" },
    processApi: {
        start: async (opts: { id: string; command: string }) => {
            if (failStart) throw new Error(failStart);
            processes.push({ id: opts.id, command: opts.command });
            return true;
        },
        kill: () => {},
        exists: async () => processes.length > 0,
        write: () => {},
        onData: () => () => {},
        onExit: () => () => {},
    },
}));

await import("../src/games/service");
const { startServerInstance, restartServerInstance, handleProcessExit } = await import("../src/service/lifecycle");
const { inServer } = await import("../src/service/scope");
const { palworldPlatform } = await import("../src/games/palworld/service");
const scope = { server: { id: "s-pw", game: "palworld", directory: "" }, locals: new Map() } as any;

const TEMPLATE = 'OptionSettings=(ServerName="Default Palworld Server",AdminPassword="",ServerPassword="",RESTAPIEnabled=False,ExpRate=1.000000)\n';
const iniPath = path.join(root, "saved", "Config", palworldPlatform(process.platform).configDir, "PalWorldSettings.ini");
const ini = () => fs.readFileSync(iniPath, "utf8");
const password = (key: string) => new RegExp(`${key}="([^"]*)"`).exec(ini())?.[1];

function makeCtx(serverStatus: string) {
    let state: any = { serverStatus, serverEntries: [], chatMessages: [], onlinePlayers: [], seenPlayers: [], gameSettings: {}, serverSoftware: "palworld", serverVersion: "", serverPort: "8211", activeIssue: null };
    return {
        get state() { return state; },
        setState: (patch: any) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; },
        emitTrigger: () => {},
    } as any;
}

// a Palworld that has been installed through SteamCMD: a build, a program and a settings template
const install = path.join(root, "install");
fs.mkdirSync(path.join(install, "steamapps"), { recursive: true });
fs.writeFileSync(path.join(install, "steamapps", "appmanifest_2394010.acf"), '"AppState"\n{\n\t"buildid"\t\t"1234"\n}\n');
fs.writeFileSync(path.join(install, "PalServer.sh"), "#!/bin/sh\n", { mode: 0o755 });
fs.writeFileSync(path.join(install, "DefaultPalWorldSettings.ini"), TEMPLATE);

beforeEach(() => {
    processes.length = 0;
    failStart = null;
    settings = {};
    vault.clear();
    fs.rmSync(path.join(root, "saved"), { recursive: true, force: true });
    fs.rmSync(path.join(install, "Pal"), { recursive: true, force: true });
});

test("a server that stops leaves no passwords in its settings file", () => inServer(scope, async () => {
    const ctx = makeCtx("offline");
    await startServerInstance(ctx);
    expect(processes).toHaveLength(1);
    // while it runs the file holds what Palworld reads at its start
    expect(password("AdminPassword")).toBeTruthy();
    expect(password("ServerPassword")).toBe("");
    expect(ctx.state.serverStatus).toBe("starting");

    // the process exits: a normal stop, a crash and a kill all arrive here
    handleProcessExit(ctx);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ctx.state.serverStatus).toBe("offline");
    expect(password("AdminPassword")).toBe("");
    expect(password("ServerPassword")).toBe("");
    // the other settings are as they were
    expect(ini()).toContain('ServerName="Default Palworld Server"');
    expect(ini()).toContain("RESTAPIEnabled=True");
    // and the passwords are still the user's, in the vault
    expect(vault.get("s-pw-palworld-admin-password")).toBeTruthy();
}));

test("a join password is on disk only while the server runs", () => inServer(scope, async () => {
    const ctx = makeCtx("offline");
    vault.set("s-pw-palworld-join-password", "hunter2-join");
    await startServerInstance(ctx);
    expect(password("ServerPassword")).toBe("hunter2-join");
    handleProcessExit(ctx);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ini()).not.toContain("hunter2-join");
    expect(ini()).not.toContain(vault.get("s-pw-palworld-admin-password")!);
}));

test("a launch that fails after the settings were written takes the passwords back", () => inServer(scope, async () => {
    const ctx = makeCtx("offline");
    failStart = "The process could not be started";
    await expect(startServerInstance(ctx)).rejects.toThrow("The process could not be started");
    expect(ctx.state.serverStatus).toBe("offline");
    expect(ctx.state.serverEntries.some((e: any) => String(e.content).includes("The process could not be started"))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(password("AdminPassword")).toBe("");
}));

test("a restart takes the passwords back, then writes them again for the new start", () => inServer(scope, async () => {
    // Palworld's REST API, which the stop asks to shut the server down
    const rest = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    try {
        settings = { restPort: rest.port };
        const ctx = makeCtx("offline");
        await startServerInstance(ctx);
        ctx.setState({ serverStatus: "online" });
        await restartServerInstance(ctx);
        expect(ctx.state.serverStatus).toBe("restarting");
        processes.length = 0;
        handleProcessExit(ctx);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(processes, "the restart started the server again").toHaveLength(1);
        expect(password("AdminPassword"), "and the new start has its passwords").toBeTruthy();
        handleProcessExit(ctx);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(password("AdminPassword")).toBe("");
    } finally { rest.stop(true); }
}));

test("an unreadable settings file is shown in the console, not dropped", () => inServer(scope, async () => {
    const ctx = makeCtx("offline");
    await startServerInstance(ctx);
    fs.writeFileSync(iniPath, "OptionSettings=(Broken");
    handleProcessExit(ctx);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ctx.state.serverEntries.some((e: any) => e.type === "error" && String(e.content).includes("Could not clean up after the server stopped"))).toBe(true);
}));
