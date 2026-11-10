import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as nodeFs from "node:fs/promises";
import * as path from "node:path";
import { tempDir, readTree, writeTree } from "./helpers/tmp";
import { activateStagedInstall, type ActivationFs } from "../src/service/activation";

const USER_DATA = {
    "world/level.dat": "level",
    "world/region/r.0.0.mca": "region",
    "server.properties": "motd=mine\n",
    "plugins/Essentials.jar": "plugin",
    "eula.txt": "eula=true\n",
};

/** a server running Paper (server.jar + its libraries cache) with the user's data, and NeoForge staged */
function serverWithStagedNeoForge(staging = ".install-1-1") {
    const root = tempDir("gameserver-activate-");
    writeTree(root, {
        ...USER_DATA,
        "server.jar": "paper",
        "libraries/paper-lib.jar": "paper runtime cache",
        "cache/mojang.jar": "paper download cache",
        [`${staging}/server/libraries/net/neoforged/neoforge/21.1.256/unix_args.txt`]: "args",
        [`${staging}/server/run.sh`]: "run",
        [`${staging}/server/user_jvm_args.txt`]: "jvm",
    });
    return { root, staging };
}

/** the real filesystem, except rename fails for the paths `fail` picks */
function failingRename(fail: (from: string, to: string) => boolean, alsoFailRestore = false): ActivationFs {
    let failed = false;
    return {
        mkdir: (p, o) => nodeFs.mkdir(p, o),
        readdir: (p) => nodeFs.readdir(p),
        rm: (p, o) => nodeFs.rm(p, o),
        writeFile: (p, d) => nodeFs.writeFile(p, d),
        readFile: (p, e) => nodeFs.readFile(p, e),
        lstat: (p) => nodeFs.lstat(p),
        rename: async (from, to) => {
            if ((!failed || alsoFailRestore) && fail(from, to)) {
                failed = true;
                throw Object.assign(new Error(`EIO: rename ${path.basename(from)}`), { code: "EIO" });
            }
            await nodeFs.rename(from, to);
        },
    };
}

// Activation is a transaction that never touches user data.
describe("activating a staged install", () => {
    test("moves the new files in, deletes only the previous install's files, trashes what else it displaced, and leaves user data alone", async () => {
        const { root, staging } = serverWithStagedNeoForge();
        // a previous Paper install that also had its own libraries/ cache entry displaced by NeoForge's libraries/
        const activation = await activateStagedInstall({ root, staging, replaced: ["server.jar"] });
        expect(activation.installed).toEqual(["libraries", "run.sh", "user_jvm_args.txt"]);
        await activation.commit();
        const tree = readTree(root);
        for (const [file, content] of Object.entries(USER_DATA)) expect(tree[file]).toBe(content);
        expect(tree["server.jar"]).toBeUndefined();
        expect(tree["libraries/net/neoforged/neoforge/21.1.256/unix_args.txt"]).toBe("args");
        expect(tree["cache/mojang.jar"]).toBe("paper download cache");
        // Paper's libraries/ was not the recorded install's: kept in the trash
        const trash = Object.keys(tree).find((f) => /^\.trash-[^/]+\/$/.test(f));
        expect(trash).toBeDefined();
        expect(tree[`${trash}libraries/paper-lib.jar`]).toBe("paper runtime cache");
        expect(Object.keys(tree).some((f) => f.startsWith(staging))).toBe(false);
    });

    test("an install output or an old record that claims user data is refused before anything moves", async () => {
        for (const userEntry of ["world", "server.properties", "plugins", "eula.txt"]) {
            const { root, staging } = serverWithStagedNeoForge();
            writeTree(root, { [`${staging}/server/${userEntry}${userEntry.includes(".") ? "" : "/x"}`]: "installer output" });
            const before = readTree(root);
            await expect(activateStagedInstall({ root, staging, replaced: ["server.jar"] })).rejects.toThrow("is not an install file");
            expect(readTree(root)).toEqual(before);
        }
        for (const claimed of ["world", "server.properties", "plugins", "eula.txt", "WORLD", "../outside"]) {
            const { root, staging } = serverWithStagedNeoForge();
            const before = readTree(root);
            await expect(activateStagedInstall({ root, staging, replaced: [claimed] })).rejects.toThrow("refusing to remove it");
            expect(readTree(root)).toEqual(before);
        }
    });

    test("a rename failing mid-swap restores the server folder exactly", async () => {
        const { root, staging } = serverWithStagedNeoForge();
        const before = readTree(root);
        // the second staged entry fails to arrive, after the old files were parked
        const fsWithFailure = failingRename((from) => from.endsWith(`${path.sep}run.sh`) && from.includes(`${staging}${path.sep}server`));
        await expect(activateStagedInstall({ root, staging, replaced: ["server.jar"], fs: fsWithFailure })).rejects.toThrow(
            "Activating the install failed; the previous files were restored",
        );
        const after = readTree(root);
        // the staging folder is gone; everything else is byte for byte what it was
        const withoutStaging = (tree: Record<string, string>) =>
            Object.fromEntries(Object.entries(tree).filter(([f]) => !f.startsWith(staging)));
        expect(withoutStaging(after)).toEqual(withoutStaging(before));
        expect(fs.existsSync(path.join(root, staging))).toBe(false);
    });

    test("when the rollback also fails, the previous files stay in previous/ for recovery", async () => {
        const { root, staging } = serverWithStagedNeoForge();
        // run.sh cannot be moved in, and server.jar cannot be moved back out of previous/
        const fsWithFailures = failingRename(
            (from) =>
                (from.endsWith(`${path.sep}run.sh`) && from.includes(`${staging}${path.sep}server`)) ||
                from.endsWith(path.join(staging, "previous", "server.jar")),
            true,
        );
        await expect(activateStagedInstall({ root, staging, replaced: ["server.jar"], fs: fsWithFailures })).rejects.toThrow(
            `They are kept in ${staging}/previous`,
        );
        expect(fs.readFileSync(path.join(root, staging, "previous", "server.jar"), "utf8")).toBe("paper");
        expect(fs.existsSync(path.join(root, staging, "journal.json"))).toBe(true);
        for (const [file, content] of Object.entries(USER_DATA)) expect(fs.readFileSync(path.join(root, file), "utf8")).toBe(content);
    });
});
