// Software switches as a transaction on a real server folder: the new
// install's files replace exactly the previous install's, user data is
// never touched, a failure mid-swap restores the previous server, and a
// crash mid-swap is settled on the next service start.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
    activateStagedInstall,
    recoverStagedInstalls,
    type ActivationFs,
} from "../src/service/activation";

let root: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-activation-"));
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content = relative) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const has = (relative: string) => fs.existsSync(path.join(root, relative));
const entries = () => fs.readdirSync(root).sort();

// a Paper server mid-life: its jar, a runtime libraries/ cache it did not
// install, and the user's world, settings and plugins
function paperServer() {
    write("server.jar", "paper");
    write("libraries/com/example/cache.jar", "paper-runtime-cache");
    write("world/level.dat", "world");
    write("server.properties", "motd=hi");
    write("plugins/Essentials.jar", "plugin");
    write("eula.txt", "eula=true");
}

// the NeoForge installer's output, staged
function stageNeoForge(staging: string) {
    write(`${staging}/installer.jar`, "installer");
    write(`${staging}/server/libraries/net/neoforged/neoforge/21.1.256/unix_args.txt`, "args");
    write(`${staging}/server/libraries/net/neoforged/neoforge/21.1.256/win_args.txt`, "args");
    write(`${staging}/server/run.sh`, "#!/bin/sh");
    write(`${staging}/server/user_jvm_args.txt`, "# jvm");
}

const USER_DATA = ["world/level.dat", "server.properties", "plugins/Essentials.jar", "eula.txt"];

describe("activateStagedInstall", () => {
    test("Paper -> NeoForge: new files live, Paper's jar gone, its runtime cache recoverable, user data untouched", async () => {
        paperServer();
        stageNeoForge(".install-1-1");
        const activation = await activateStagedInstall({ root, staging: ".install-1-1", replaced: ["server.jar"] });
        expect(activation.installed).toEqual(["libraries", "run.sh", "user_jvm_args.txt"]);
        await activation.commit();

        expect(has("libraries/net/neoforged/neoforge/21.1.256/unix_args.txt")).toBe(true);
        expect(has("server.jar")).toBe(false);
        expect(has(".install-1-1")).toBe(false);
        // libraries/ was Paper's runtime cache, not Paper's install: trashed, not deleted
        const trash = entries().find((e) => e.startsWith(".trash-"))!;
        expect(read(`${trash}/libraries/com/example/cache.jar`)).toBe("paper-runtime-cache");
        for (const file of USER_DATA) expect(has(file)).toBe(true);
    });

    test("NeoForge -> NeoForge update deletes the previous install's own files outright", async () => {
        write("libraries/net/neoforged/neoforge/21.1.200/unix_args.txt", "old");
        write("run.sh", "old");
        write("world/level.dat", "world");
        stageNeoForge(".install-2-1");
        const activation = await activateStagedInstall({
            root,
            staging: ".install-2-1",
            replaced: ["libraries", "run.sh", "user_jvm_args.txt"],
        });
        await activation.commit();
        expect(has("libraries/net/neoforged/neoforge/21.1.200")).toBe(false);
        expect(read("run.sh")).toBe("#!/bin/sh");
        expect(entries().some((e) => e.startsWith(".trash-"))).toBe(false);
        expect(has("world/level.dat")).toBe(true);
    });

    test("an install that produces user data is refused before anything moves", async () => {
        paperServer();
        write(".install-3-1/server/server.properties", "motd=installer");
        write(".install-3-1/server/server.jar", "new");
        await expect(
            activateStagedInstall({ root, staging: ".install-3-1", replaced: ["server.jar"] }),
        ).rejects.toThrow("not an install file");
        expect(read("server.properties")).toBe("motd=hi");
        expect(read("server.jar")).toBe("paper");
    });

    test("a previous record claiming a world is refused, the world stays", async () => {
        paperServer();
        write(".install-4-1/server/server.jar", "new");
        await expect(
            activateStagedInstall({ root, staging: ".install-4-1", replaced: ["server.jar", "world"] }),
        ).rejects.toThrow("refusing to remove");
        expect(has("world/level.dat")).toBe(true);
    });

    test("a failure mid-swap restores the previous server exactly", async () => {
        paperServer();
        stageNeoForge(".install-5-1");
        const before = snapshot();
        let renames = 0;
        const failing: ActivationFs = {
            ...(fsp as unknown as ActivationFs),
            rename: async (from, to) => {
                // journal rename, two parks, then the first staged move fails
                if (++renames === 4) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
                await fsp.rename(from, to);
            },
        };
        await expect(
            activateStagedInstall({ root, staging: ".install-5-1", replaced: ["server.jar"], fs: failing }),
        ).rejects.toThrow("previous files were restored: disk full");
        expect(snapshot()).toEqual(before.filter(([name]) => !name.startsWith(".install-")));
    });

    test("rollback after the record write failed restores the previous server", async () => {
        paperServer();
        stageNeoForge(".install-6-1");
        const before = snapshot().filter(([name]) => !name.startsWith(".install-"));
        const activation = await activateStagedInstall({ root, staging: ".install-6-1", replaced: ["server.jar"] });
        await activation.rollback();
        expect(snapshot()).toEqual(before);
    });
});

describe("recoverStagedInstalls (service start after a crash)", () => {
    // crash after the journal and every move, before the record was written
    async function crashAfterSwap(staging: string) {
        paperServer();
        stageNeoForge(staging);
        await activateStagedInstall({ root, staging, replaced: ["server.jar"] });
        // process dies here: no commit, no rollback
    }

    test("a swap the record never named is rolled back", async () => {
        paperServer();
        const before = snapshot();
        fs.rmSync(root, { recursive: true });
        fs.mkdirSync(root);
        await crashAfterSwap(".install-7-1");
        const result = await recoverStagedInstalls(root, null);
        expect(result.rolledBack).toEqual([".install-7-1"]);
        expect(snapshot()).toEqual(before);
    });

    test("a swap the record names is committed", async () => {
        await crashAfterSwap(".install-8-1");
        const result = await recoverStagedInstalls(root, ".install-8-1");
        expect(result.committed).toEqual([".install-8-1"]);
        expect(has("server.jar")).toBe(false);
        expect(has("run.sh")).toBe(true);
        expect(has(".install-8-1")).toBe(false);
    });

    test("a crash between parking and moving in is rolled back too", async () => {
        paperServer();
        stageNeoForge(".install-9-1");
        const before = snapshot().filter(([name]) => !name.startsWith(".install-"));
        // journal + first park land, then the process dies: every later
        // filesystem call (including the in-process rollback) never happens
        let renames = 0;
        let dead = false;
        const alive = <T>(op: () => Promise<T>) => {
            if (dead) return Promise.reject(new Error("process is dead"));
            return op();
        };
        const real = fsp as unknown as ActivationFs;
        const dying: ActivationFs = {
            mkdir: (p, o) => alive(() => real.mkdir(p, o)),
            readdir: (p) => alive(() => real.readdir(p)),
            rm: (p, o) => alive(() => real.rm(p, o)),
            writeFile: (p, d) => alive(() => real.writeFile(p, d)),
            readFile: (p, e) => alive(() => real.readFile(p, e)),
            lstat: (p) => alive(() => real.lstat(p)),
            rename: (from, to) =>
                alive(async () => {
                    await real.rename(from, to);
                    if (++renames === 2) dead = true;
                }),
        };
        await activateStagedInstall({ root, staging: ".install-9-1", replaced: ["server.jar"], fs: dying }).catch(
            () => undefined,
        );
        expect(has(".install-9-1/journal.json")).toBe(true);
        expect(has(".install-9-1/previous/server.jar")).toBe(true);
        expect(has("server.jar")).toBe(false);
        await recoverStagedInstalls(root, null);
        expect(snapshot()).toEqual(before);
    });

    test("staging that never activated is discarded; an unreadable journal is left alone", async () => {
        write(".install-10-1/installer.jar", "partial download");
        write(".install-11-1/journal.json", "{not json");
        write(".install-11-1/previous/server.jar", "only copy");
        await expect(recoverStagedInstalls(root, null)).rejects.toThrow();
        expect(has(".install-11-1/previous/server.jar")).toBe(true);
        fs.rmSync(path.join(root, ".install-11-1"), { recursive: true });
        const result = await recoverStagedInstalls(root, null);
        expect(result.discarded).toEqual([".install-10-1"]);
        expect(has(".install-10-1")).toBe(false);
    });
});

// every file under root with its content, sorted
function snapshot(): [string, string][] {
    const out: [string, string][] = [];
    const walk = (relative: string) => {
        for (const name of fs.readdirSync(path.join(root, relative))) {
            const child = relative ? `${relative}/${name}` : name;
            if (fs.statSync(path.join(root, child)).isDirectory()) walk(child);
            else out.push([child, read(child)]);
        }
    };
    walk("");
    return out.sort((a, b) => a[0].localeCompare(b[0]));
}
