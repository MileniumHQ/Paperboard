import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "../helpers/crane";
import { minecraftServer, type McServer } from "../helpers/minecraft";
import { mrpack, packCdn, packDeps, packFile, packIndex, sha1 } from "../helpers/modpack";
import { readTree } from "../helpers/tmp";
import { parsePackIndex, safePackPath } from "../../src/core/modpack";
import { installUploadedModpack } from "../../src/service/modpacks";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const USER = {
    "world/level.dat": "level",
    "server.properties": "motd=mine\n",
    "libraries/net/neoforged/neoforge/21.1.256/unix_args.txt": "args",
    "mods/users-own.jar": "user mod",
};

function neoServer(): McServer {
    return minecraftServer({ software: "neoforge", files: USER });
}

/** stages an uploaded .mrpack in the server folder and installs it */
function installArchive(mc: McServer, archive: Uint8Array, cdn = packCdn()) {
    fs.writeFileSync(path.join(mc.dir, "upload.mrpack"), archive);
    return installUploadedModpack("upload.mrpack", "neoforge", packDeps(mc, cdn));
}

const liveTree = (mc: McServer) => Object.fromEntries(Object.entries(readTree(mc.dir)).filter(([f]) => f !== "upload.mrpack"));

// Pack contents are validated before anything is written.
describe("modpack contents", () => {
    test("pack paths must be portable and inside the server folder", () => {
        for (const bad of ["../mods/x.jar", "mods/../../x", "/etc/x", "C:/x.jar", "C:\\x.jar", "mods\\x.jar", "con", "mods/NUL.jar", "aux.txt", "mods/a\u0000b", "mods./x.jar", "mods/x.jar ", "mods//x.jar", "./x", "", "a?b", 'a"b']) {
            expect([bad, safePackPath(bad)]).toEqual([bad, null]);
        }
        expect(safePackPath("mods/sodium-0.6.jar")).toBe("mods/sodium-0.6.jar");
        expect(safePackPath("config/sub dir/x.toml")).toBe("config/sub dir/x.toml");
    });

    test("an index for another loader, from a disallowed host, or naming a path twice in any case is refused", () => {
        const cdn = { served: {} as Record<string, string> };
        const mod = packFile(cdn, "mods/a.jar", "a");
        expect(() => parsePackIndex(packIndex([mod], { minecraft: "1.21.1", "fabric-loader": "0.16.10" }), "neoforge", "world")).toThrow("not this server's loader");
        for (const url of ["http://cdn.modrinth.com/data/a.jar", "https://evil.example/a.jar", "https://cdn.modrinth.com.evil.example/a.jar"]) {
            expect(() => parsePackIndex(packIndex([{ ...mod, downloads: [url] }]), "neoforge", "world")).toThrow("no download from an allowed host");
        }
        expect(() => parsePackIndex(packIndex([mod, { ...mod, path: "MODS/A.jar" }]), "neoforge", "world")).toThrow("twice");
    });

    test("a sha512 mismatch refuses the whole pack with nothing moved", async () => {
        const mc = neoServer();
        const cdn = packCdn();
        const good = packFile(cdn, "mods/good.jar", "good");
        const bad = packFile(cdn, "mods/bad.jar", "bad");
        bad.hashes.sha512 = "0".repeat(128);
        const before = readTree(mc.dir);
        await expect(installArchive(mc, mrpack(packIndex([good, bad]), { overrides: { "config/pack.toml": "x" } }), cdn)).rejects.toThrow(
            "mods/bad.jar does not match its sha512",
        );
        expect(liveTree(mc)).toEqual(before);
        expect(mc.scope.server.settings.modpack).toBeUndefined();
    });

    test("an override that inflates past 64 MiB refuses the pack with nothing moved", async () => {
        const mc = neoServer();
        const before = readTree(mc.dir);
        const bomb = new Uint8Array(65 * 1024 * 1024);
        await expect(installArchive(mc, mrpack(packIndex([]), { overrides: { "config/bomb.bin": bomb } }))).rejects.toThrow("over the 64 MiB override limit");
        expect(liveTree(mc)).toEqual(before);
    });

    test("an override path leaving the server folder or naming a reserved device refuses the pack with nothing moved", async () => {
        for (const entry of ["overrides/../escape.txt", "overrides/mods/../../escape.txt", "overrides/config/con.txt", "server-overrides/mods\\x.jar"]) {
            const mc = neoServer();
            const before = readTree(mc.dir);
            const archive = mrpack(packIndex([]), { raw: { [entry]: new TextEncoder().encode("x") } });
            await expect(installArchive(mc, archive)).rejects.toThrow("unsafe override path");
            expect(liveTree(mc)).toEqual(before);
            expect(fs.existsSync(path.join(mc.dir, "..", "escape.txt"))).toBe(false);
        }
    });

    test("paths over the world, server.properties or the installed software are kept as they are, not written", async () => {
        const mc = neoServer();
        const cdn = packCdn();
        const index = packIndex([packFile(cdn, "mods/sodium.jar", "sodium"), packFile(cdn, "server.properties", "motd=pack\n")]);
        const outcome = await installArchive(
            mc,
            mrpack(index, { overrides: { "world/level.dat": "pack world", "libraries/evil.jar": "x", "config/pack.toml": "pack" } }),
            cdn,
        );
        expect(outcome.kept.sort()).toEqual(["libraries/evil.jar", "server.properties", "world/level.dat"]);
        const tree = readTree(mc.dir);
        expect(tree["world/level.dat"]).toBe("level");
        expect(tree["server.properties"]).toBe("motd=mine\n");
        expect(tree["libraries/evil.jar"]).toBeUndefined();
        expect(tree["mods/sodium.jar"]).toBe("sodium");
        expect(tree["config/pack.toml"]).toBe("pack");
        expect(sha1(tree["mods/sodium.jar"]!)).toBe(sha1("sodium"));
    });
});
