import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { mrpack, packCdn, packDeps, packFile, packIndex, sha1, sha512 } from "./helpers/modpack";
import { loopbackServer } from "./helpers/http";
import { readTree, writeTree } from "./helpers/tmp";
import { installModpack, installUploadedModpack, removeModpack, type ModpackDeps } from "./../src/service/modpacks";
import { MODRINTH_API } from "../src/core/modrinth";

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
        const settings = mc.scope.server.settings;
        expect((settings.modpack as { files: string[]; uploaded: boolean }).files).toEqual(["config/a.toml", "config/shared.toml", "mods/sodium.jar"]);
        expect((settings.modpack as { uploaded: boolean }).uploaded).toBe(true);
        expect(settings.modpackStaging).toMatch(/^\.modpack-/);
        expect(fs.readdirSync(mc.dir).filter((e) => e.startsWith(".modpack-"))).toEqual([]);
    });

    test("a Modrinth pack is fetched by its version record and checked against both hashes", async () => {
        const mc = neoServer();
        const cdn = packCdn();
        const pack = Buffer.from(mrpack(packIndex([packFile(cdn, "mods/sodium.jar", "sodium")])));
        const modrinth = loopbackServer((_req, url) => {
            if (url.pathname === "/v2/version/VERSION1")
                return Response.json({
                    id: "VERSION1",
                    project_id: "PROJECT1",
                    version_number: "1.0.0",
                    name: "1.0.0",
                    loaders: ["neoforge"],
                    game_versions: ["1.21.1"],
                    files: [{ url: "https://cdn.modrinth.com/data/pack.mrpack", filename: "pack.mrpack", primary: true, size: pack.length, hashes: { sha1: sha1(pack), sha512: sha512(pack) } }],
                });
            if (url.pathname === "/v2/project/PROJECT1") return Response.json({ id: "PROJECT1", slug: "test-pack", title: "Test Pack", project_type: "modpack" });
            return new Response("not found", { status: 404 });
        });
        // the archive's exact bytes, beside the pack's files
        const files = loopbackServer((req, url) => (url.pathname === "/data/pack.mrpack" ? new Response(pack) : fetch(`${cdn.url}${url.pathname}`)));
        const deps = packDeps(mc, files, {
            fetchJson: async <T>(url: string) => (await (await fetch(url.replace(MODRINTH_API, `${modrinth.url}/v2`))).json()) as T,
        });
        await installModpack({ projectId: "PROJECT1", versionId: "VERSION1" }, "neoforge", deps);
        expect(live(mc)["mods/sodium.jar"]).toBe("sodium");
        expect(mc.scope.server.settings.modpack).toMatchObject({ projectId: "PROJECT1", versionId: "VERSION1", slug: "test-pack" });
    });

    test("the loader is reinstalled only when the pack's build differs, in the same write as the pack record", async () => {
        for (const installedBuild of ["21.1.256", "21.1.200"]) {
            const mc = neoServer();
            const cdn = packCdn();
            const switches: unknown[][] = [];
            const writes: Record<string, unknown>[] = [];
            const deps = packDeps(mc, cdn, {
                installed: async () => ({ software: "neoforge", version: "1.21.1", build: installedBuild }),
                installSoftware: async (...args) => {
                    switches.push(args);
                    return {};
                },
                writeConfig: async (patch) => {
                    writes.push(patch);
                },
            });
            const outcome = await upload(mc, mrpack(packIndex([packFile(cdn, "mods/a.jar", "a")])), deps);
            if (installedBuild === "21.1.256") {
                expect(outcome.switchedServer).toBe(false);
                expect(switches).toEqual([]);
                expect(Object.keys(writes[0]!)).toContain("modpack");
            } else {
                expect(outcome.switchedServer).toBe(true);
                expect(writes).toEqual([]);
                expect(switches[0]!.slice(0, 3)).toEqual(["neoforge", "1.21.1", "21.1.256"]);
                expect(Object.keys(switches[0]![3] as object)).toEqual(expect.arrayContaining(["modpack", "modpackStaging"]));
            }
        }
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
        expect(mc.scope.server.settings.modpack).toBeNull();
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
            expect(mc.scope.server.settings.modpack).toBeUndefined();
            expect(fs.readdirSync(mc.dir).filter((e) => e.startsWith(".modpack-"))).toEqual([]);
        }
    });
});
