// Does Steam have a newer build than the one installed? The app information
// below is what SteamCMD 2026 printed for Team Fortress 2 Dedicated Server and
// Palworld Dedicated Server (test/fixtures/steam), captured with
// `+login anonymous +app_info_update 1 +app_info_print <appid> +quit`,
// self-update spam and all.
import { afterAll, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as paperapi from "@mileniumhq/paperapi";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-steam-updates-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const fixture = (name: string) => path.join(import.meta.dir, "fixtures", "steam", name);
const lines = (name: string) => fs.readFileSync(fixture(name), "utf8").split("\n");

// the daemon's config, kept in memory
let settings: Record<string, unknown> = {};
// the daemon's process API, run for real as a child so SteamCMD's stand-in prints what a script prints
const exits = new Map<string, (code: number) => void>();
const output = new Map<string, (chunk: string) => void>();
mock.module("../src/service/api", () => ({
    ...paperapi,
    files: { getPath: async () => path.join(root, "server") },
    config: { get: async () => settings, set: async (next: Record<string, unknown>) => { settings = next; return true; } },
    processApi: {
        exists: async () => false,
        kill: async () => true,
        onData: (id: string, cb: (chunk: string) => void) => { output.set(id, cb); return () => output.delete(id); },
        onExit: (id: string, cb: (code: number) => void) => { exits.set(id, cb); return () => exits.delete(id); },
        start: async (run: { id: string; command: string; args: string[]; cwd: string; env?: Record<string, string> }) => {
            const child = Bun.spawn([run.command, ...run.args], { cwd: run.cwd, env: { ...process.env, ...run.env }, stdout: "pipe" });
            void (async () => {
                output.get(run.id)?.(await new Response(child.stdout).text());
                exits.get(run.id)?.(await child.exited);
            })();
            return true;
        },
    },
}));
mock.module("@mileniumhq/paperapi", () => ({
    ...paperapi,
    fileApi: { getPath: async (...parts: string[]) => path.join(root, ...parts) },
    secretsApi: { get: async () => ({ found: true, value: "rcon-secret" }), set: async () => true, delete: async () => true },
}));

const { parseLatestBuild, latestBuild } = await import("../src/games/steam/steamcmd");
const { steamUpdateStatus } = await import("../src/games/steam/installAction");
await import("../src/games/service");
const { palworldService } = await import("../src/games/palworld/service");
const { tf2Service } = await import("../src/games/tf2/service");
const { tf2 } = await import("../src/games/tf2");
const { palworld } = await import("../src/games/palworld");
const { PANEL_ID } = await import("../src/service/types");

test("the public build is the one under depots, branches, public, not a depot's manifest or another branch", () => {
    // a depot's manifests also have a "public", and other branches carry other builds
    expect(parseLatestBuild(lines("tf2-app-info.txt"), 232250)).toBe("26334371");
    expect(parseLatestBuild(lines("palworld-app-info.txt"), 2394010)).toBe("25247047");
});

test("output without the app's information, or without a public build, fails by saying so", () => {
    expect(() => parseLatestBuild(lines("tf2-app-info.txt"), 730)).toThrow("SteamCMD printed no information for app 730");
    expect(() => parseLatestBuild(['"232250"', "{", '\t"depots"', "\t{", '\t\t"branches"', "\t\t{", '\t\t\t"beta"', "\t\t\t{", '\t\t\t\t"buildid"\t\t"1"', "\t\t\t}", "\t\t}", "\t}", "}"], 232250)).toThrow("Steam lists no public build for app 232250");
    expect(() => parseLatestBuild(['"232250"', "{", '\t"depots"', "\t{", '\t\t"branches"', "\t\t{", '\t\t\t"public"', "\t\t\t{", '\t\t\t\t"buildid"\t\t"soon"', "\t\t\t}", "\t\t}", "\t}", "}"], 232250)).toThrow("Steam lists no public build for app 232250");
    // SteamCMD cut off mid-block
    expect(() => parseLatestBuild(lines("tf2-app-info.txt").slice(0, 150), 232250)).toThrow("cut short");
});

/** A SteamCMD stand-in that prints a captured app_info_print for any app and records how it was called. */
function stand(name: string, exitCode = 0) {
    const workspace = path.join(root, ".steam", PANEL_ID);
    const script = path.join(workspace, "steamcmd", "steamcmd.sh");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, `#!/bin/sh\necho "$*" >> "${root}/calls"\ncat "${fixture(name)}"\nexit ${exitCode}\n`, { mode: 0o755 });
}
const calls = () => fs.readFileSync(path.join(root, "calls"), "utf8").trim().split("\n");

test("latestBuild asks SteamCMD for the app's information anonymously and reads the build", async () => {
    stand("tf2-app-info.txt");
    expect(await latestBuild(232250, { workspace: path.join(root, ".steam", PANEL_ID) })).toBe("26334371");
    expect(calls().at(-1)).toBe("+login anonymous +app_info_update 1 +app_info_print 232250 +quit");
});

test("a SteamCMD that fails, or prints another app, is an error that quotes its output", async () => {
    stand("tf2-app-info.txt", 5);
    await expect(latestBuild(232250, { workspace: path.join(root, ".steam", PANEL_ID) })).rejects.toThrow("Could not read the newest build of app 232250: SteamCMD exited with 5");
    stand("palworld-app-info.txt");
    await expect(latestBuild(232250, { workspace: path.join(root, ".steam", PANEL_ID) })).rejects.toThrow("SteamCMD printed no information for app 232250");
});

function install(appId: number, build: string) {
    const dir = path.join(root, "server", "install", "steamapps");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `appmanifest_${appId}.acf`), `"AppState"\n{\n\t"buildid"\t\t"${build}"\n}\n`);
}

test("an install behind Steam's public build has an update; one on it, or none, does not", async () => {
    const spec = { appId: 232250, installDir: async () => path.join(root, "server", "install") };
    const steam = { workspace: path.join(root, ".steam", PANEL_ID) };
    stand("tf2-app-info.txt");
    expect(await steamUpdateStatus(spec, steam)).toEqual({ installed: null, latest: "26334371", updateAvailable: false });
    install(232250, "26000000");
    expect(await steamUpdateStatus(spec, steam)).toEqual({ installed: "26000000", latest: "26334371", updateAvailable: true });
    install(232250, "26334371");
    expect(await steamUpdateStatus(spec, steam)).toEqual({ installed: "26334371", latest: "26334371", updateAvailable: false });
});

test("TF2 and Palworld each list and serve their newest-build action, and name it for other service code", async () => {
    for (const [game, service, id] of [[tf2, tf2Service, `${tf2.id}-latest`], [palworld, palworldService, "palworld-latest"]] as const) {
        expect(game.describe().actions).toContain(id);
        expect((await service.actions()).map((a) => a.id)).toContain(id);
        expect(service.updateStatus).toBeFunction();
    }
    // the action runs the real SteamCMD path end to end: no workspace override, the panel's own
    stand("tf2-app-info.txt");
    install(232250, "26000000");
    const action = (await tf2Service.actions()).find((a) => a.id === `${tf2.id}-latest`)!;
    expect(await action.run({} as any, {})).toEqual({ installed: "26000000", latest: "26334371", updateAvailable: true });
    expect(await tf2Service.updateStatus!({} as any)).toEqual({ installed: "26000000", latest: "26334371", updateAvailable: true });
});

test("a TF2 download leaves setup open for how the server plays, which then finishes it", async () => {
    // a SteamCMD that downloads: it writes the app manifest where it was told to and says so as SteamCMD does
    const workspace = path.join(root, ".steam", PANEL_ID);
    const script = path.join(workspace, "steamcmd", "steamcmd.sh");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, `#!/bin/sh
dir="$2"; app="$6"
mkdir -p "$dir/steamapps" "$dir/tf/maps" "$dir/tf/cfg"
printf '"AppState"\n{\n\t"buildid"\t\t"26334371"\n}\n' > "$dir/steamapps/appmanifest_$app.acf"
: > "$dir/tf/maps/ctf_2fort.bsp"
echo "Success! App '$app' fully installed."
`, { mode: 0o755 });
    fs.rmSync(path.join(root, "server"), { recursive: true, force: true });
    settings = {};
    const { inServer } = await import("../src/service/scope");
    const state: Record<string, unknown> = { serverStatus: "offline" };
    const ctx = { state, setState: (patch: any) => Object.assign(state, typeof patch === "function" ? patch(state) : patch), emitTrigger: () => {} } as any;
    const scope = { server: { id: "s-steam-setup", game: tf2.id, directory: "" }, locals: new Map() } as any;
    const run = (id: string, input: Record<string, unknown> = {}) => inServer(scope, async () => (await tf2Service.actions()).find((a) => a.id === id)!.run(ctx, input));

    await inServer(scope, () => tf2Service.initialize!(ctx, false));
    await run(`${tf2.id}-install`);
    expect(settings).toMatchObject({ build: "26334371" });
    expect(settings.configured).toBeUndefined();
    await run(`${tf2.id}-play`, { mode: null, map: "ctf_2fort" });
    expect(settings).toMatchObject({ configured: true, map: "ctf_2fort" });
});

test("a download is published as getting ready until Steam measures it, then by how much of how much", async () => {
    // what SteamCMD printed downloading app 90 (2026-11-02): it makes room first, with its own percent, then downloads
    const workspace = path.join(root, ".steam", PANEL_ID);
    const script = path.join(workspace, "steamcmd", "steamcmd.sh");
    fs.writeFileSync(script, `#!/bin/sh
dir="$2"; app="$6"
mkdir -p "$dir/steamapps" "$dir/tf/maps" "$dir/tf/cfg"
printf '"AppState"\\n{\\n\\t"buildid"\\t\\t"26334371"\\n}\\n' > "$dir/steamapps/appmanifest_$app.acf"
printf '\\033[0m Update state (0x3) reconfiguring, progress: 0.00 (0 / 0)\\n'
printf '\\033[0m Update state (0x11) preallocating, progress: 80.31 (778988852 / 970035750)\\n'
printf '\\033[0m Update state (0x61) downloading, progress: 8.21 (79648257 / 970035750)\\n'
printf '\\033[0m Update state (0x81) verifying update, progress: 14.79 (143436135 / 970035750)\\n'
echo "Success! App '$app' fully installed."
`, { mode: 0o755 });
    fs.rmSync(path.join(root, "server"), { recursive: true, force: true });
    settings = {};
    const { inServer } = await import("../src/service/scope");
    const published: unknown[] = [];
    const state: Record<string, unknown> = { serverStatus: "offline" };
    const ctx = {
        state,
        setState: (patch: any) => {
            const next = typeof patch === "function" ? patch(state) : patch;
            if ("installProgress" in next) published.push(next.installProgress);
            Object.assign(state, next);
        },
        emitTrigger: () => {},
    } as any;
    const scope = { server: { id: "s-steam-progress", game: tf2.id, directory: "" }, locals: new Map() } as any;
    await inServer(scope, () => tf2Service.initialize!(ctx, false));
    await inServer(scope, async () => (await tf2Service.actions()).find((a) => a.id === `${tf2.id}-install`)!.run(ctx, {}));

    expect(published.slice(0, 5)).toEqual([
        { stage: "preparing", percent: 0 },
        { stage: "preparing", percent: 0, bytes: { done: 0, total: 0 } },
        { stage: "preparing", percent: 80, bytes: { done: 778988852, total: 970035750 } },
        { stage: "downloading", percent: 8, bytes: { done: 79648257, total: 970035750 } },
        { stage: "verifying", percent: 14, bytes: { done: 143436135, total: 970035750 } },
    ]);
    expect(published.at(-1)).toEqual({ stage: "completed", percent: 100 });
});

test("setup opened again during a download follows it, and after it is told the download is done", async () => {
    // a SteamCMD that takes a moment, and counts its runs
    const workspace = path.join(root, ".steam", PANEL_ID);
    const script = path.join(workspace, "steamcmd", "steamcmd.sh");
    const runs = path.join(root, "steamcmd-runs");
    fs.rmSync(runs, { force: true });
    fs.writeFileSync(script, `#!/bin/sh
dir="$2"; app="$6"
echo run >> "${runs}"
sleep 0.3
mkdir -p "$dir/steamapps" "$dir/tf/maps" "$dir/tf/cfg"
printf '"AppState"\n{\n\t"buildid"\t\t"26334371"\n}\n' > "$dir/steamapps/appmanifest_$app.acf"
echo "Success! App '$app' fully installed."
`, { mode: 0o755 });
    fs.rmSync(path.join(root, "server"), { recursive: true, force: true });
    settings = {};
    const { inServer } = await import("../src/service/scope");
    const state: Record<string, unknown> = { serverStatus: "offline" };
    const ctx = { state, setState: (patch: any) => Object.assign(state, typeof patch === "function" ? patch(state) : patch), emitTrigger: () => {} } as any;
    const scope = { server: { id: "s-steam-again", game: tf2.id, directory: "" }, locals: new Map() } as any;
    const run = (id: string) => inServer(scope, async () => (await tf2Service.actions()).find((a) => a.id === id)!.run(ctx, {}));

    await inServer(scope, () => tf2Service.initialize!(ctx, false));
    expect(await run(`${tf2.id}-info`)).toMatchObject({ downloaded: false });
    const first = run(`${tf2.id}-install`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // setup left and opened again: its install is the one already running, not a refusal
    expect(await run(`${tf2.id}-install`)).toBe(true);
    expect(await first).toBe(true);
    expect(fs.readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(1);
    expect(await run(`${tf2.id}-info`)).toMatchObject({ downloaded: true, build: "26334371" });
});
