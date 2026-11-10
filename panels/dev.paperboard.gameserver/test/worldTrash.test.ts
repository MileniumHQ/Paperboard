import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as nodeFs from "node:fs/promises";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer } from "./helpers/minecraft";
import { testScope } from "./helpers/scope";
import { readTree, tempDir, writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { trashRemovePathsWith, type TrashFs } from "../src/service/trash";
import { deleteActiveWorldDirs, listWorlds, setActiveWorld } from "../src/service/worlds";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const trashed = (root: string) =>
    Object.keys(readTree(root))
        .filter((f) => f.startsWith(".trash-") && !f.endsWith("/"))
        .map((f) => f.replace(/^\.trash-[^/]+\//, ""))
        .sort();

// World deletion goes to trash and never forks a world.
describe("world deletion", () => {
    test("removal renames into one .trash folder keeping relative paths, and skips what is missing", async () => {
        const root = tempDir();
        writeTree(root, { "plugins/a.jar": "a", "mods/a.jar": "mod a", "world/level.dat": "w" });
        await trashRemovePathsWith({ getServerDir: async () => root }, ["plugins/a.jar", "mods/a.jar", "world_nether", "world"]);
        expect(trashed(root)).toEqual(["mods/a.jar", "plugins/a.jar", "world/level.dat"]);
        expect(fs.existsSync(path.join(root, "world"))).toBe(false);
    });

    test("an in-use file stops the removal and what was already moved stays in the trash", async () => {
        const root = tempDir();
        writeTree(root, { "world/level.dat": "w", "world_nether/level.dat": "n", "world_the_end/level.dat": "e" });
        // what Windows answers for a file a running server holds open
        const busy: TrashFs = {
            mkdir: (p, o) => nodeFs.mkdir(p, o),
            lstat: (p) => nodeFs.lstat(p),
            rename: async (from, to) => {
                if (from.endsWith("world_nether")) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
                await nodeFs.rename(from, to);
            },
        };
        await expect(trashRemovePathsWith({ getServerDir: async () => root, fs: busy }, ["world", "world_nether", "world_the_end"])).rejects.toThrow(
            /"world_nether" is in use or not writable; stop the server and try again\. Already removed items are kept in "\.trash-\d+"/,
        );
        expect(trashed(root)).toEqual(["world/level.dat"]);
        expect(fs.readFileSync(path.join(root, "world_nether", "level.dat"), "utf8")).toBe("n");
        expect(fs.readFileSync(path.join(root, "world_the_end", "level.dat"), "utf8")).toBe("e");
    });

    test("deleting the active world moves it and its Paper dimensions to the trash; a running server refuses", async () => {
        const mc = minecraftServer({
            software: "paper",
            files: { "world/level.dat": "w", "world/region/r.0.0.mca": "r", "world_nether/level.dat": "n", "world_the_end/level.dat": "e", "other/level.dat": "o" },
        });
        const listed = await mc.run(() => listWorlds());
        // Paper's dimension folders list under their world, not as worlds
        expect(listed.map((w) => [w.name, w.hasNether, w.hasEnd])).toEqual([
            ["world", true, true],
            ["other", false, false],
        ]);
        const running = testScope({ directory: mc.scope.server.directory }, { serverStatus: "online" });
        await expect(deleteActiveWorldDirs(running.ctx, "world")).rejects.toThrow("Stop the server before managing worlds");
        await mc.run(() => deleteActiveWorldDirs(mc.scope.ctx, "world"));
        expect(trashed(mc.dir)).toEqual(["world/level.dat", "world/region/r.0.0.mca", "world_nether/level.dat", "world_the_end/level.dat"]);
        expect(fs.readFileSync(path.join(mc.dir, "other", "level.dat"), "utf8")).toBe("o");
    });

    test("a created world that never started is forgotten when deleted", async () => {
        const mc = minecraftServer({ files: { "server.properties": "level-name=world\n", "world/level.dat": "w" } });
        expect(await mc.run(() => setActiveWorld(mc.scope.ctx, "fresh", "12345"))).toEqual({ activated: "fresh", created: true });
        expect((await mc.run(() => listWorlds())).map((w) => [w.name, w.generated])).toEqual([
            ["fresh", false],
            ["world", true],
        ]);
        await mc.run(() => deleteActiveWorldDirs(mc.scope.ctx, "fresh"));
        expect((await mc.run(() => listWorlds())).map((w) => w.name)).toEqual(["world"]);
    });

    test("a name matching an existing folder in another case switches to it instead of forking a new world", async () => {
        const mc = minecraftServer({ files: { "server.properties": "level-name=other\n", "Survival/level.dat": "s", "other/level.dat": "o" } });
        expect(await mc.run(() => setActiveWorld(mc.scope.ctx, "survival"))).toEqual({ activated: "Survival", created: false });
        expect(fs.readFileSync(path.join(mc.dir, "server.properties"), "utf8")).toContain("level-name=Survival");
        await expect(mc.run(() => setActiveWorld(mc.scope.ctx, "OTHER", "42"))).rejects.toThrow("\"other\" already exists — a seed only applies to a new world");
        await expect(mc.run(() => setActiveWorld(mc.scope.ctx, "OTHER", undefined, true))).rejects.toThrow('A world named "other" already exists');
    });

    test("an unreadable panel config is never overwritten when a created world is recorded", async () => {
        const file = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "{\"software\": \"paper\",");
        const ctx = testScope({ directory: "" }).ctx;
        await expect(setActiveWorld(ctx, "brandnew")).rejects.toThrow("JSON Parse error");
        expect(fs.readFileSync(file, "utf8")).toBe("{\"software\": \"paper\",");
        fs.rmSync(file);
    });
});
