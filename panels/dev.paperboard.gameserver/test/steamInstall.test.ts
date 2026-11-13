import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { gameServer } from "./helpers/game";
import { fakeSteamcmd, STEAM_FIXTURES } from "./helpers/steamcmd";
import { readTree, tempDir, writeTree } from "./helpers/tmp";
import { installApp, installedBuild, latestBuild, parseLatestBuild } from "../src/games/steam/steamcmd";
import { steamUpdateStatus } from "../src/games/steam/installAction";
import { palworldService } from "../src/games/palworld/service";
import { PALWORLD_APP_ID } from "../src/games/palworld";
import { activateRelease, recoverRelease, unpackArchive, unpackTmodloader } from "../src/games/terraria/install";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const TF2 = 232250;
const PALWORLD_INFO = path.join(STEAM_FIXTURES, "palworld-app-info.txt");
const TF2_INFO = path.join(STEAM_FIXTURES, "tf2-app-info.txt");
const DEFAULT_INI = "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(AdminPassword=\"\",ServerPassword=\"\",RESTAPIPort=8212)\n";
const appUpdates = (runs: string[][]) => runs.filter((args) => args.includes("+app_update"));

// Steam and Terraria installs and updates are verified.
describe("Steam and Terraria installs", () => {
    test("the public build is read from depots, branches, public, and an update is offered only for an install that differs", async () => {
        const steam = fakeSteamcmd({ appInfo: { [PALWORLD_APP_ID]: PALWORLD_INFO, [TF2]: TF2_INFO } });
        expect(await latestBuild(PALWORLD_APP_ID)).toBe("25247047");
        expect(await latestBuild(TF2)).toBe("26334371");
        expect(steam.runs()).toEqual([
            ["+login", "anonymous", "+app_info_update", "1", "+app_info_print", String(PALWORLD_APP_ID), "+quit"],
            ["+login", "anonymous", "+app_info_update", "1", "+app_info_print", String(TF2), "+quit"],
        ]);

        const dir = tempDir();
        const spec = { appId: PALWORLD_APP_ID, installDir: async () => dir };
        expect(await steamUpdateStatus(spec)).toEqual({ installed: null, latest: "25247047", updateAvailable: false });
        const manifest = (build: string) => writeTree(dir, { [`steamapps/appmanifest_${PALWORLD_APP_ID}.acf`]: `"AppState"\n{\n\t"buildid"\t\t"${build}"\n}\n` });
        manifest("25247047");
        expect(await steamUpdateStatus(spec)).toEqual({ installed: "25247047", latest: "25247047", updateAvailable: false });
        manifest("24000000");
        expect(await steamUpdateStatus(spec)).toEqual({ installed: "24000000", latest: "25247047", updateAvailable: true });

        // the public branch, not another branch's build that appears first
        const lines = fs.readFileSync(TF2_INFO, "utf8").split("\n");
        expect(parseLatestBuild(lines, TF2)).toBe("26334371");
        expect(() => parseLatestBuild(lines, 440)).toThrow("SteamCMD printed no information for app 440");
    });

    test("a game on a Steam branch is installed from it, and its updates are that branch's builds", async () => {
        const GMOD = 4020;
        const info = path.join(STEAM_FIXTURES, "gmod-app-info.txt");
        const steam = fakeSteamcmd({ appInfo: { [GMOD]: info }, install: { [GMOD]: { mode: "ok", build: "26623757" } } });
        const dir = tempDir();
        expect(await installApp(GMOD, dir, { branch: "x86-64" })).toBe("26623757");
        expect(appUpdates(steam.runs())).toEqual([["+force_install_dir", dir, "+login", "anonymous", "+app_update", String(GMOD), "-beta", "x86-64", "validate", "+quit"]]);
        // the public branch has another build: an install from x86-64 is not behind it
        expect(await latestBuild(GMOD)).toBe("25375525");
        expect(await steamUpdateStatus({ appId: GMOD, branch: "x86-64", installDir: async () => dir })).toEqual({ installed: "26623757", latest: "26623757", updateAvailable: false });
        await expect(latestBuild(GMOD, { branch: "no-such-branch" })).rejects.toThrow("Steam lists no no-such-branch build for app 4020");
        for (const bad of ["x86-64 +quit", "", "a/b", "-validate x"]) {
            expect(() => installApp(GMOD, dir, { branch: bad })).toThrow("Not a Steam branch name");
            expect(() => latestBuild(GMOD, { branch: bad })).toThrow("Not a Steam branch name");
        }
    });

    test("output cut short, or a manifest without a build, throws instead of guessing", async () => {
        fakeSteamcmd({ appInfo: { [PALWORLD_APP_ID]: PALWORLD_INFO }, truncateInfo: true });
        await expect(latestBuild(PALWORLD_APP_ID)).rejects.toThrow(`Could not read the newest build of app ${PALWORLD_APP_ID}`);
        const dir = tempDir();
        writeTree(dir, { [`steamapps/appmanifest_${PALWORLD_APP_ID}.acf`]: '"AppState"\n{\n\t"appid"\t\t"2394010"\n}\n' });
        await expect(installedBuild(PALWORLD_APP_ID, dir)).rejects.toThrow(`Steam's app manifest for ${PALWORLD_APP_ID} names no build`);
    });

    test("an install counts only when SteamCMD confirms this app, and a failure carries SteamCMD's reason and last lines", async () => {
        const dir = tempDir();
        fakeSteamcmd({ install: { [TF2]: { mode: "other-app", build: "1" } } });
        await expect(installApp(TF2, dir)).rejects.toThrow(`Steam download of app ${TF2} failed: SteamCMD did not confirm the install`);
        fakeSteamcmd({ install: { [TF2]: { mode: "silent", build: "1" } } });
        await expect(installApp(TF2, dir)).rejects.toThrow("SteamCMD did not confirm the install");

        const steam = fakeSteamcmd({ install: { [TF2]: { mode: "fail", reason: "No subscription" } } });
        const failure = await installApp(TF2, dir).then(() => null, (err: Error) => err.message);
        expect(failure).toContain(`Steam download of app ${TF2} failed: No subscription (SteamCMD exited with 8)`);
        expect(failure).toContain(`ERROR! Failed to install app '${TF2}' (No subscription)`);
        expect(appUpdates(steam.runs())).toHaveLength(1);
    });

    test("a fresh SteamCMD's Missing configuration is retried once, and only once", async () => {
        const dir = tempDir();
        const steam = fakeSteamcmd({ install: { [TF2]: { mode: "missing-config-once", build: "26334371" } } });
        expect(await installApp(TF2, dir)).toBe("26334371");
        expect(appUpdates(steam.runs())).toHaveLength(2);
        expect(appUpdates(steam.runs())[0]).toEqual(["+force_install_dir", dir, "+login", "anonymous", "+app_update", String(TF2), "validate", "+quit"]);

        const always = fakeSteamcmd({ install: { [TF2]: { mode: "fail", reason: "Missing configuration" } } });
        await expect(installApp(TF2, tempDir())).rejects.toThrow("failed: Missing configuration");
        expect(appUpdates(always.runs())).toHaveLength(2);
    });

    test("a second install while one downloads joins it instead of starting another", async () => {
        const steam = fakeSteamcmd({ install: { [PALWORLD_APP_ID]: { mode: "ok", build: "25247047", files: { "DefaultPalWorldSettings.ini": DEFAULT_INI, "PalServer.sh": "#!/bin/sh\n" } } } });
        const server = gameServer("palworld", { state: palworldService.initialState() });
        await server.run(() => palworldService.initialize(server.scope.ctx, false));
        const [first, second] = server.run(() => [palworldService.installUpdate!(server.scope.ctx), palworldService.installUpdate!(server.scope.ctx)]);
        expect(second).toBe(first);
        await Promise.all([first, second]);
        expect(appUpdates(steam.runs())).toHaveLength(1);
        expect(server.scope.server.settings).toMatchObject({ configured: true, build: "25247047" });
        expect(server.scope.ctx.state.installProgress).toEqual({ stage: "completed", percent: 100 });
        // the game's own setup ran after the download: its settings file exists, with no password in it
        expect(readTree(path.join(server.dir, "saved"))["Config/LinuxServer/PalWorldSettings.ini"]).toContain('AdminPassword=""');
    });

    test("a Terraria archive with the wrong size or SHA-256 is refused before anything is written", async () => {
        const target = tempDir();
        const fake = zipSync({ "1458/Linux/TerrariaServer.bin.x86_64": strToU8("not terraria") });
        await expect(unpackArchive(fake, path.join(target, "staging"), "1.4.5.8", "linux")).rejects.toThrow("Terraria archive size/SHA-256 mismatch; nothing was installed");
        await expect(unpackTmodloader(fake, path.join(target, "staging"), "2026.08.3.0")).rejects.toThrow("tModLoader archive size/SHA-256 mismatch; nothing was installed");
        expect(fs.readdirSync(target)).toEqual([]);
    });

    test("an install swap cut short recovers the release it replaced, and never touches worlds", async () => {
        const root = tempDir();
        writeTree(root, { "worlds/World.wld": "world", "install/1458.previous/Linux/TerrariaServer.bin.x86_64": "old release" });
        const target = path.join(root, "install", "1458");
        // the old release was moved aside and the new one never arrived
        await recoverRelease(target);
        expect(readTree(root)).toEqual({ "install/": "", "install/1458/": "", "install/1458/Linux/": "", "install/1458/Linux/TerrariaServer.bin.x86_64": "old release", "worlds/": "", "worlds/World.wld": "world" });

        // the new release arrived but the old was not yet removed
        writeTree(root, { "install/1458.previous/Linux/TerrariaServer.bin.x86_64": "older release" });
        await expect(activateRelease(path.join(root, "staging"), target)).rejects.toThrow("A Terraria release swap needs recovery");
        await recoverRelease(target);
        expect(fs.existsSync(`${target}.previous`)).toBe(false);
        expect(fs.readFileSync(path.join(target, "Linux", "TerrariaServer.bin.x86_64"), "utf8")).toBe("old release");

        writeTree(root, { "staging/Linux/TerrariaServer.bin.x86_64": "new release" });
        await activateRelease(path.join(root, "staging"), target);
        expect(readTree(root)).toEqual({ "install/": "", "install/1458/": "", "install/1458/Linux/": "", "install/1458/Linux/TerrariaServer.bin.x86_64": "new release", "worlds/": "", "worlds/World.wld": "world" });
    });
});
