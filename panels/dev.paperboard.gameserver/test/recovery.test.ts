import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { tempDir, readTree, writeTree } from "./helpers/tmp";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer } from "./helpers/minecraft";
import { recoverStagedInstalls } from "../src/service/activation";
import { recoverStagedPacks } from "../src/service/packActivation";
import { settleInterruptedWork } from "../src/service/recovery";
import { startServerInstance } from "../src/service/lifecycle";
import { withInstallLock } from "../src/games/minecraft/softwareInstall";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const USER = { "world/level.dat": "level", "server.properties": "motd=x\n" };
const journal = (staged: string[], displaced: string[], replaced: string[]) =>
    JSON.stringify({ version: 1, staged, displaced, replaced });
const packJournal = (staged: string[], displaced: string[], createdDirs: string[]) =>
    JSON.stringify({ version: 1, staged, displaced, createdDirs });

// Start-up recovery settles interrupted installs and pack changes.
describe("start-up recovery", () => {
    test("an install the record does not name rolls back exactly, also after a crash between parking the old files and moving the new ones in", async () => {
        // crashed after parking: the old jar is in previous/, the new one still staged
        const parked = tempDir();
        writeTree(parked, {
            ...USER,
            ".install-2-1/journal.json": journal(["server.jar"], ["server.jar"], ["server.jar"]),
            ".install-2-1/previous/server.jar": "old",
            ".install-2-1/server/server.jar": "new",
        });
        // crashed halfway through moving in: libraries/ arrived, run.sh did not
        const halfway = tempDir();
        writeTree(halfway, {
            ...USER,
            ".install-3-1/journal.json": journal(["libraries", "run.sh"], ["server.jar"], ["server.jar"]),
            ".install-3-1/previous/server.jar": "old",
            ".install-3-1/server/run.sh": "new run",
            "libraries/neo.jar": "new lib",
        });
        for (const root of [parked, halfway]) {
            const result = await recoverStagedInstalls(root, ".install-1-1");
            expect(result.rolledBack).toHaveLength(1);
            expect(readTree(root)).toEqual({ ...USER, "server.jar": "old", "world/": "" });
        }
    });

    test("an install the record names is committed, and staging that never activated is discarded", async () => {
        const root = tempDir();
        writeTree(root, {
            ...USER,
            "server.jar": "new",
            ".install-4-1/journal.json": journal(["server.jar"], ["server.jar"], ["server.jar"]),
            ".install-4-1/previous/server.jar": "old",
            ".install-5-1/installer.jar": "download that never ran",
        });
        const result = await recoverStagedInstalls(root, ".install-4-1");
        expect(result).toEqual({ committed: [".install-4-1"], rolledBack: [], discarded: [".install-5-1"] });
        expect(readTree(root)).toEqual({ ...USER, "server.jar": "new", "world/": "" });
    });

    test("an unreadable journal throws and leaves previous/ untouched", async () => {
        const root = tempDir();
        writeTree(root, {
            ...USER,
            ".install-6-1/journal.json": "{\"version\": 1, \"staged\": [\"world\"]",
            ".install-6-1/previous/server.jar": "old",
            ".install-7-1/journal.json": journal(["server.jar"], ["server.jar"], ["server.jar"]),
            ".install-7-1/previous/server.jar": "older",
        });
        const before = readTree(root);
        await expect(recoverStagedInstalls(root, null)).rejects.toThrow();
        // no staging folder was touched, in whatever order they are listed
        expect(readTree(root)).toEqual(before);
    });

    test("a pack change the record does not name rolls back, one it names commits, and a pack journal that is not this panel's throws", async () => {
        const root = tempDir();
        writeTree(root, {
            ...USER,
            "mods/sodium.jar": "pack mod",
            ".modpack-1-1/journal.json": packJournal(["mods/sodium.jar"], ["mods/old.jar"], ["mods"]),
            ".modpack-1-1/previous/mods/old.jar": "user's old mod",
        });
        expect(await recoverStagedPacks(root, null)).toEqual({ committed: [], rolledBack: [".modpack-1-1"], discarded: [] });
        expect(readTree(root)).toEqual({ ...USER, "mods/": "", "mods/old.jar": "user's old mod", "world/": "" });

        writeTree(root, {
            ".modpack-2-1/journal.json": packJournal(["mods/sodium.jar"], ["mods/old.jar"], []),
            ".modpack-2-1/previous/mods/old.jar": "replaced",
            "mods/sodium.jar": "pack mod",
        });
        fs.rmSync(path.join(root, "mods", "old.jar"));
        expect((await recoverStagedPacks(root, ".modpack-2-1")).committed).toEqual([".modpack-2-1"]);
        const tree = readTree(root);
        expect(tree["mods/sodium.jar"]).toBe("pack mod");
        // what the pack replaced is recoverable from the trash
        expect(Object.entries(tree).some(([f, c]) => /^\.trash-[^/]+\/mods\/old\.jar$/.test(f) && c === "replaced")).toBe(true);

        writeTree(root, { ".modpack-3-1/journal.json": packJournal(["../../etc/passwd"], [], []), ".modpack-3-1/previous/x": "kept" });
        await expect(recoverStagedPacks(root, null)).rejects.toThrow("Modpack journal is not in a format this panel wrote");
        expect(fs.readFileSync(path.join(root, ".modpack-3-1", "previous", "x"), "utf8")).toBe("kept");
    });

    test("a failed recovery refuses start and install until a retry succeeds", async () => {
        const mc = minecraftServer({
            files: { ".install-8-1/journal.json": "not json", ".install-8-1/previous/server.jar": "old" },
        });
        expect(await mc.run(() => settleInterruptedWork(mc.scope.ctx))).toBe(false);
        expect(mc.scope.ctx.state.recoveryBlock).toContain("An interrupted install could not be cleaned up");
        await expect(mc.run(() => startServerInstance(mc.scope.ctx))).rejects.toThrow("Retry the recovery");
        await expect(mc.run(() => withInstallLock(async () => "installed"))).rejects.toThrow("Retry the recovery");
        expect(mc.scope.ctx.state.serverStatus).toBe("offline");

        // the journal is readable again: the retry settles it and both work again
        fs.writeFileSync(path.join(mc.dir, ".install-8-1", "journal.json"), journal(["server.jar"], ["server.jar"], ["server.jar"]));
        fs.rmSync(path.join(mc.dir, "server.jar"));
        expect(await mc.run(() => settleInterruptedWork(mc.scope.ctx))).toBe(true);
        expect(mc.scope.ctx.state.recoveryBlock).toBeNull();
        expect(fs.readFileSync(path.join(mc.dir, "server.jar"), "utf8")).toBe("old");
        expect(await mc.run(() => withInstallLock(async () => "installed"))).toBe("installed");
    });
});
