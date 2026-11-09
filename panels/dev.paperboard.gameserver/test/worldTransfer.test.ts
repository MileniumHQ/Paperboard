import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { readTree } from "./helpers/tmp";
import { startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { exportWorld, importWorld } from "../src/service/worldTransfer";
import { recoverPausedSaving, withSavingPaused } from "../src/games/minecraft/saving";
import { WORLD_TRANSFER_DIR } from "../src/core/worldArchive";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const MARKER = ".paperboard-saving-paused";
const WORLD = {
    "server.properties": "level-name=world\n",
    "world/level.dat": "level",
    "world/region/r.0.0.mca": "region \u0000\u0001 bytes",
    "world_nether/DIM-1/region/r.0.0.mca": "nether",
    "world_the_end/DIM1/region/r.0.0.mca": "end",
};

async function online(mc: McServer): Promise<void> {
    await mc.run(() => startServerInstance(mc.scope.ctx));
    await mc.scope.waitFor((s) => s.serverStatus === "online", "the server to come online");
}

async function offline(mc: McServer): Promise<void> {
    const exit = mc.nextExit();
    await mc.run(() => stopServerInstance(mc.scope.ctx));
    expect(await exit).toBe(0);
}

/** a zip put in the transfer folder, as the page uploads it */
function upload(mc: McServer, name: string, entries: Record<string, string>): void {
    const dir = path.join(mc.dir, WORLD_TRANSFER_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))));
}

const saveCommands = (mc: McServer) => mc.commands().filter((c) => c.startsWith("save"));
const worldFolders = (mc: McServer) => fs.readdirSync(mc.dir).filter((f) => !f.startsWith(".")).sort();

// World export pauses saving safely; import refuses zip slip.
describe("world transfer", () => {
    test("exporting the world being played pauses saving around the copy, and re-importing it is byte for byte", async () => {
        const mc = minecraftServer({ files: WORLD });
        await online(mc);
        const exported = await mc.run(() => exportWorld(mc.scope.ctx, "world"));
        expect(exported.file).toBe("world.zip");
        await mc.received("save-on");
        expect(saveCommands(mc)).toEqual(["save-off", "save-all flush", "save-on"]);
        expect(fs.existsSync(path.join(mc.dir, MARKER))).toBe(false);
        expect(fs.statSync(path.join(mc.dir, WORLD_TRANSFER_DIR, "world.zip")).size).toBe(exported.bytes);

        expect(await mc.run(() => importWorld("world.zip", "copy"))).toEqual({ name: "copy", folders: ["copy", "copy_nether", "copy_the_end"] });
        const tree = readTree(mc.dir);
        for (const [file, content] of Object.entries(WORLD)) {
            if (file.includes("/")) expect([file, tree[file.replace(/^world/, "copy")]]).toEqual([file, content]);
        }
        // the uploaded archive is removed once unpacked, and no staging is left
        expect(fs.readdirSync(path.join(mc.dir, WORLD_TRANSFER_DIR))).toEqual([]);
        await offline(mc);
    });

    test("the paused marker exists for the whole copy, and a failed copy still turns saving back on and leaves no file", async () => {
        const mc = minecraftServer({ files: WORLD });
        await online(mc);
        let markerDuringCopy = false;
        await mc.run(() =>
            withSavingPaused(mc.scope.ctx, async () => {
                markerDuringCopy = fs.existsSync(path.join(mc.dir, MARKER));
            }),
        );
        expect(markerDuringCopy).toBe(true);
        expect(fs.existsSync(path.join(mc.dir, MARKER))).toBe(false);

        // a region file the copy cannot read
        const locked = path.join(mc.dir, "world", "region", "r.0.0.mca");
        fs.chmodSync(locked, 0o000);
        try {
            await expect(mc.run(() => exportWorld(mc.scope.ctx, "world"))).rejects.toThrow(/EACCES|permission denied/i);
        } finally {
            fs.chmodSync(locked, 0o644);
        }
        await mc.received("save-on", 1);
        expect(saveCommands(mc)).toEqual(["save-off", "save-all flush", "save-on", "save-off", "save-all flush", "save-on"]);
        expect(fs.existsSync(path.join(mc.dir, MARKER))).toBe(false);
        expect(fs.existsSync(path.join(mc.dir, WORLD_TRANSFER_DIR, "world.zip"))).toBe(false);
        await offline(mc);
    });

    test("a pause the last service left behind is ended at start-up, and a world that is not being played is copied without pausing", async () => {
        const mc = minecraftServer({ files: { ...WORLD, "other/level.dat": "other" } });
        expect(await mc.run(() => recoverPausedSaving())).toBe(false);
        await online(mc);
        fs.writeFileSync(path.join(mc.dir, MARKER), "2026-01-01T00:00:00.000Z");
        expect(await mc.run(() => recoverPausedSaving())).toBe(true);
        await mc.received("save-on");
        expect(fs.existsSync(path.join(mc.dir, MARKER))).toBe(false);

        await mc.run(() => exportWorld(mc.scope.ctx, "other"));
        expect(saveCommands(mc)).toEqual(["save-on"]);
        await offline(mc);
    });

    test("a starting or stopping server refuses the copy, and only one transfer runs at a time", async () => {
        const mc = minecraftServer({ files: WORLD, state: { serverStatus: "starting" } });
        await expect(mc.run(() => exportWorld(mc.scope.ctx, "world"))).rejects.toThrow("Wait until the server has finished starting or stopping");
        expect(fs.existsSync(path.join(mc.dir, WORLD_TRANSFER_DIR, "world.zip"))).toBe(false);

        mc.scope.ctx.setState({ serverStatus: "offline" });
        const first = mc.run(() => exportWorld(mc.scope.ctx, "world"));
        await expect(mc.run(() => importWorld("world.zip", "second"))).rejects.toThrow("Another world upload or download is running");
        await first;
        expect(worldFolders(mc)).toEqual(["eula.txt", "server.jar", "server.properties", "world", "world_nether", "world_the_end"]);
    });

    test("an import with a path out of the world, or a bad transfer file name, writes nothing and removes the upload", async () => {
        const mc = minecraftServer({ files: WORLD });
        const before = readTree(mc.dir);
        const slips: Record<string, string>[] = [
            { "level.dat": "x", "../evil.txt": "pwned" },
            { "MyWorld/level.dat": "x", "MyWorld/../../evil.txt": "pwned" },
            { "MyWorld/level.dat": "x", "MyWorld/region/..\\..\\evil.txt": "pwned" },
            { "MyWorld/level.dat": "x", "MyWorld//evil.txt": "pwned" },
        ];
        for (const entries of slips) {
            upload(mc, "slip.zip", entries);
            await expect(mc.run(() => importWorld("slip.zip", "imported"))).rejects.toThrow("unsafe file path");
            expect(fs.existsSync(path.join(mc.dir, WORLD_TRANSFER_DIR, "slip.zip"))).toBe(false);
        }
        for (const bad of ["../world.zip", "/etc/passwd.zip", "a/b.zip", "x.txt", ".hidden.zip", "a..b.zip"]) {
            await expect(mc.run(() => importWorld(bad, "imported"))).rejects.toThrow("That is not a world transfer file");
        }
        expect(fs.existsSync(path.join(path.dirname(mc.dir), "evil.txt"))).toBe(false);
        const after = readTree(mc.dir);
        delete after[`${WORLD_TRANSFER_DIR}/`];
        expect(after).toEqual(before);
    });

    test("an import refuses a name already used in any case or dimension, and a zip with no world or several", async () => {
        const mc = minecraftServer({ files: { ...WORLD, "Taken_nether/level.dat": "n" } });
        const world = { "MyWorld/level.dat": "x", "MyWorld/region/r.0.0.mca": "r" };
        for (const name of ["WORLD", "taken"]) {
            upload(mc, "w.zip", world);
            await expect(mc.run(() => importWorld("w.zip", name))).rejects.toThrow("already exists");
        }
        upload(mc, "w.zip", { "readme.txt": "no world here", "MyWorld/region/r.0.0.mca": "r" });
        await expect(mc.run(() => importWorld("w.zip", "fresh"))).rejects.toThrow("it has no level.dat, so it is not a Minecraft world");
        upload(mc, "w.zip", { "One/level.dat": "1", "Two/level.dat": "2" });
        await expect(mc.run(() => importWorld("w.zip", "fresh"))).rejects.toThrow("it holds more than one world");
        upload(mc, "w.zip", world);
        await expect(mc.run(() => importWorld("w.zip", "bad name;rm"))).rejects.toThrow("is not a usable world name");
        expect(worldFolders(mc)).toEqual(["Taken_nether", "eula.txt", "server.jar", "server.properties", "world", "world_nether", "world_the_end"]);

        // a nested world with its own dimensions comes in under the new name
        upload(mc, "w.zip", { "saves/Mine/level.dat": "m", "saves/Mine_nether/DIM-1/x": "n", "saves/Other.txt": "skip" });
        expect(await mc.run(() => importWorld("w.zip", "Mine"))).toEqual({ name: "Mine", folders: ["Mine", "Mine_nether"] });
        expect(readTree(path.join(mc.dir, "Mine_nether"))).toEqual({ "DIM-1/": "", "DIM-1/x": "n" });
    });
});
