// Trash-remove against a real folder (bun test). The panel service runs on
// the computer that owns the server folder, so removal is a rename there.
// The previous implementation typed a shell command into a temporary
// terminal; on Windows the terminal could not start and every plugin
// uninstall failed with only "exited without the marker".
import { test, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { trashRemovePathsWith, type TrashFs } from "../src/service/trash";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function serverFolder(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gameserver-trash-"));
    roots.push(root);
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), content);
    }
    return root;
}

const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

test("removal keeps restorable bytes and skips a dimension that was never entered", async () => {
    const root = serverFolder({ "world/level.dat": "important world bytes" });
    await trashRemovePathsWith(
        { getServerDir: async () => root },
        ["world", "world_nether", "world_the_end"],
        ".trash-1",
    );
    expect(fs.existsSync(path.join(root, "world"))).toBe(false);
    fs.renameSync(path.join(root, ".trash-1", "world"), path.join(root, "world"));
    expect(read(root, "world/level.dat")).toBe("important world bytes");
});

test("same-named files from different folders do not overwrite each other in the trash", async () => {
    const root = serverFolder({ "plugins/Map.jar": "paper jar", "mods/Map.jar": "fabric jar" });
    await trashRemovePathsWith(
        { getServerDir: async () => root },
        ["plugins/Map.jar", "mods/Map.jar"],
        ".trash-2",
    );
    expect(read(root, ".trash-2/plugins/Map.jar")).toBe("paper jar");
    expect(read(root, ".trash-2/mods/Map.jar")).toBe("fabric jar");
    expect(fs.existsSync(path.join(root, "plugins/Map.jar"))).toBe(false);
});

test("a file in use stops the removal with the reason and keeps what was not moved", async () => {
    const root = serverFolder({ "plugins/A.jar": "a", "plugins/B.jar": "b" });
    // Windows refuses to rename a jar a running server holds open (EBUSY)
    const busyOnB: TrashFs = {
        mkdir: (p, o) => fs.promises.mkdir(p, o),
        lstat: (p) => fs.promises.lstat(p),
        rename: async (from, to) => {
            if (from.endsWith("B.jar")) throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
            await fs.promises.rename(from, to);
        },
    };
    await expect(
        trashRemovePathsWith(
            { getServerDir: async () => root, fs: busyOnB },
            ["plugins/A.jar", "plugins/B.jar"],
            ".trash-3",
        ),
    ).rejects.toThrow(
        '"plugins/B.jar" is in use or not writable; stop the server and try again. Already removed items are kept in ".trash-3" in the server folder',
    );
    expect(read(root, ".trash-3/plugins/A.jar")).toBe("a");
    expect(read(root, "plugins/B.jar")).toBe("b");
});

test("a trash folder that cannot be created refuses before anything moves", async () => {
    const root = serverFolder({ "world/level.dat": "keep me", ".trash-4": "a file, not a folder" });
    await expect(
        trashRemovePathsWith({ getServerDir: async () => root }, ["world"], ".trash-4"),
    ).rejects.toThrow(/"world" could not be moved/);
    expect(read(root, "world/level.dat")).toBe("keep me");
});
