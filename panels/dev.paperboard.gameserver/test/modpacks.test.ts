import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { mrpack, packCdn, packDeps, packFile, packIndex } from "./helpers/modpack";
import { readTree, writeTree } from "./helpers/tmp";
import { installUploadedModpack, removeModpack, type ModpackDeps } from "../src/service/modpacks";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const USER = { "world/level.dat": "level", "server.properties": "motd=mine\n", "libraries/neo.jar": "neoforge" };

function neoServer(files: Record<string, string> = {}): McServer {
    return minecraftServer({ software: "neoforge", files: { ...USER, ...files } });
}

function upload(mc: McServer, archive: Uint8Array, deps: ModpackDeps) {
    fs.writeFileSync(path.join(mc.dir, "upload.mrpack"), archive);
    return installUploadedModpack("upload.mrpack", "neoforge", deps);
}

const live = (mc: McServer) =>
    Object.fromEntries(Object.entries(readTree(mc.dir)).filter(([f]) => !f.startsWith(".trash-") && !f.endsWith("/") && f !== "upload.mrpack"));
const trashed = (mc: McServer) =>
    Object.keys(readTree(mc.dir))
        .filter((f) => f.startsWith(".trash-") && !f.endsWith("/"))
        .map((f) => f.replace(/^\.trash-[^/]+\//, ""))
        .sort();

// Modpack install, update and removal are transactional.
describe("modpack transactions", () => {
    test("an uploaded pack places downloads, then overrides over them, trashes the mods it replaces, and records pack and staging together", async () => {
        const mc = neoServer({ "mods/old.jar": "user's old mod" });
        const cdn = packCdn();
        const index = packIndex([packFile(cdn, "mods/sodium.jar", "sodium"), packFile(cdn, "config/shared.toml", "from download")]);
        const deps = packDeps(mc, cdn);
        const outcome = await upload(mc, mrpack(index, { overrides: { "config/shared.toml": "from overrides", "config/a.toml": "a" }, serverOverrides: { "config/a.toml": "server a" } }), deps);
        expect(outcome).toMatchObject({ title: "Test Pack", mcVersion: "1.21.1", loaderVersion: "21.1.256", switchedServer: false });
        const tree = live(mc);
        expect(tree["mods/sodium.jar"]).toBe("sodium");
        expect(tree["config/shared.toml"]).toBe("from overrides");
        expect(tree["config/a.toml"]).toBe("server a");
        expect(tree["mods/old.jar"]).toBeUndefined();
        expect(trashed(mc)).toEqual(["mods/old.jar"]);
        const settings = mc.server.settings;
        expect((settings.modpack as { files: string[]; uploaded: boolean }).files).toEqual(["config/a.toml", "config/shared.toml", "mods/sodium.jar"]);
        expect((settings.modpack as { uploaded: boolean }).uploaded).toBe(true);
        expect(settings.modpackStaging).toMatch(/^\.modpack-/);
        expect(fs.readdirSync(mc.dir).filter((e) => e.startsWith(".modpack-"))).toEqual([]);
    });

    test("an update removes what the old version placed and keeps the user's files; removal trashes only the pack's files", async () => {
        const mc = neoServer();
        const cdn = packCdn();
        const deps = packDeps(mc, cdn);
        await upload(mc, mrpack(packIndex([packFile(cdn, "mods/a.jar", "a1"), packFile(cdn, "mods/b.jar", "b1")]), { overrides: { "config/pack.toml": "v1" } }), deps);
        writeTree(mc.dir, { "config/user.toml": "mine" });

        await upload(mc, mrpack(packIndex([packFile(cdn, "mods/a.jar", "a2"), packFile(cdn, "mods/c.jar", "c2")])), deps);
        let tree = live(mc);
        expect(tree["mods/a.jar"]).toBe("a2");
        expect(tree["mods/c.jar"]).toBe("c2");
        expect(tree["mods/b.jar"]).toBeUndefined();
        expect(tree["config/pack.toml"]).toBeUndefined();
        expect(tree["config/user.toml"]).toBe("mine");
        expect(trashed(mc)).toEqual(expect.arrayContaining(["config/pack.toml", "mods/a.jar", "mods/b.jar"]));

        expect(await removeModpack(deps)).toEqual({ removed: 2 });
        tree = live(mc);
        expect(tree["mods/a.jar"]).toBeUndefined();
        expect(tree["mods/c.jar"]).toBeUndefined();
        expect(tree["config/user.toml"]).toBe("mine");
        for (const [file, content] of Object.entries(USER)) expect(tree[file]).toBe(content);
        expect(mc.server.settings.modpack).toBeNull();
    });

    test("a failed loader switch or a refused config write puts every old file back and records nothing", async () => {
        const failures: Partial<ModpackDeps>[] = [
            {
                installed: async () => ({ software: "neoforge", version: "1.21.1", build: "21.1.200" }),
                installSoftware: async () => {
                    throw new Error("The NeoForge installer failed (exit code 1)");
                },
            },
            {
                writeConfig: async () => {
                    throw new Error("config store refused the write");
                },
            },
        ];
        for (const failure of failures) {
            const mc = neoServer({ "mods/old.jar": "old", "config/pack.toml": "user's edit" });
            const cdn = packCdn();
            const before = live(mc);
            await expect(
                upload(mc, mrpack(packIndex([packFile(cdn, "mods/new.jar", "new")]), { overrides: { "config/pack.toml": "pack" } }), packDeps(mc, cdn, failure)),
            ).rejects.toThrow("The previous mods were put back");
            expect(live(mc)).toEqual(before);
            expect(trashed(mc)).toEqual([]);
            expect(mc.server.settings.modpack).toBeUndefined();
            expect(fs.readdirSync(mc.dir).filter((e) => e.startsWith(".modpack-"))).toEqual([]);
        }
    });
});
