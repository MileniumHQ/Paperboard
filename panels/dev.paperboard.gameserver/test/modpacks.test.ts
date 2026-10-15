// The Modpacks tab's install against a real temp server folder and real
// .mrpack archives built here. Modrinth answers are recorded shapes; the
// daemon's download is replaced by a writer that serves known bytes and
// checks sha1 the way the daemon does. sha512 is the service's own check
// and runs for real.
import { afterEach, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { installModpack, removeModpack, type ModpackDeps } from "../src/service/modpacks";
import { activatePack, newPackStagingName, packFilesPath, recoverStagedPacks } from "../src/service/packActivation";
import { isKeptPath, parsePackIndex, safePackPath, MODPACK_RECORD_KEY, MODPACK_STAGING_KEY } from "../src/core/modpack";
import { INSTALL_RECORDS_KEY } from "../src/core/plugins";
import type { ServerSoftwareType } from "../src/software/catalog";

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const sha = (algo: string, data: Uint8Array) => crypto.createHash(algo).update(data).digest("hex");

interface PackFile {
    path: string;
    bytes: Uint8Array;
    env?: string;
    url?: string;
    sha512?: string;
}

function index(files: PackFile[], deps: Record<string, string> = { minecraft: "1.21.1", "fabric-loader": "0.16.5" }) {
    return {
        formatVersion: 1,
        game: "minecraft",
        versionId: "1.0.0",
        name: "Test Pack",
        dependencies: deps,
        files: files.map((f) => ({
            path: f.path,
            hashes: { sha1: sha("sha1", f.bytes), sha512: f.sha512 ?? sha("sha512", f.bytes) },
            downloads: [f.url ?? `https://cdn.modrinth.com/data/x/${encodeURIComponent(f.path)}`],
            fileSize: f.bytes.byteLength,
            ...(f.env ? { env: { client: "required", server: f.env } } : {}),
        })),
    };
}

function mrpack(idx: unknown, entries: Record<string, string | Uint8Array> = {}): Uint8Array {
    const zip: Record<string, Uint8Array> = { "modrinth.index.json": strToU8(JSON.stringify(idx)) };
    for (const [name, data] of Object.entries(entries)) zip[name] = typeof data === "string" ? strToU8(data) : data;
    return zipSync(zip);
}

function harness(opts: { installed?: { version: string; build: string | null }; installFails?: boolean } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-modpacks-"));
    dirs.push(root);
    let config: Record<string, unknown> = {};
    const served = new Map<string, Uint8Array>();
    const versions = new Map<string, unknown>();
    const softwareInstalls: [string, string, string][] = [];
    const progress: unknown[] = [];
    let installed = { software: "fabric" as ServerSoftwareType, version: "1.21.1", build: "0.16.5" as string | null, ...opts.installed };

    const publishPack = (versionId: string, archive: Uint8Array) => {
        const url = `https://cdn.modrinth.com/data/pack/versions/${versionId}/pack.mrpack`;
        served.set(url, archive);
        versions.set(versionId, {
            id: versionId,
            project_id: "packproj",
            version_number: `v${versionId}`,
            loaders: ["fabric"],
            game_versions: ["1.21.1"],
            files: [
                {
                    url,
                    filename: "pack.mrpack",
                    primary: true,
                    size: archive.byteLength,
                    hashes: { sha1: sha("sha1", archive), sha512: sha("sha512", archive) },
                },
            ],
        });
    };
    const serve = (files: PackFile[]) => {
        for (const f of files) served.set(f.url ?? `https://cdn.modrinth.com/data/x/${encodeURIComponent(f.path)}`, f.bytes);
    };

    const deps: ModpackDeps = {
        serverDir: async () => root,
        levelName: async () => "world",
        fetchJson: async <T,>(url: string) => {
            const version = /\/version\/([^/?]+)$/.exec(url)?.[1];
            if (version) return versions.get(version) as T;
            return { id: "packproj", slug: "test-pack", title: "Test Pack", project_type: "modpack" } as T;
        },
        download: async ({ url, targetPath, sha1 }) => {
            const bytes = served.get(url);
            if (!bytes) throw new Error(`404 ${url}`);
            if (sha("sha1", bytes) !== sha1) throw new Error("sha1 mismatch");
            const target = path.join(root, ...targetPath.split("/"));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, bytes);
        },
        sha512: async (abs) => sha("sha512", fs.readFileSync(abs)),
        readConfig: async () => config,
        writeConfig: async (patch) => {
            config = { ...config, ...patch };
        },
        installed: async () => installed,
        installSoftware: async (software, version, build) => {
            softwareInstalls.push([software, version, build]);
            if (opts.installFails) throw new Error("installer exploded");
            installed = { software, version, build };
            return {};
        },
        publish: (p) => progress.push(p),
    };
    const write = (rel: string, data = "x") => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), data);
    };
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
    const has = (rel: string) => fs.existsSync(path.join(root, rel));
    const trashed = (rel: string) =>
        fs.readdirSync(root).some((e) => e.startsWith(".trash-") && fs.existsSync(path.join(root, e, rel)));
    const leftovers = () => fs.readdirSync(root).filter((e) => e.startsWith(".modpack-"));
    return { root, deps, publishPack, serve, softwareInstalls, progress, config: () => config, write, read, has, trashed, leftovers };
}

const install = (h: ReturnType<typeof harness>, versionId: string, software: ServerSoftwareType = "fabric") =>
    installModpack({ projectId: "packproj", versionId }, software, h.deps);

describe("pack paths", () => {
    test("only paths every OS writes the same way inside the server folder", () => {
        for (const ok of ["mods/sodium+0.5.jar", "config/a b/[x].json5", "kubejs/server_scripts/x.js"]) {
            expect(safePackPath(ok)).toBe(ok);
        }
        for (const bad of ["../x", "mods/../../x", "/etc/passwd", "C:/x", "mods\\x.jar", "mods//x", "./x", "con.txt", "mods/aux", "mods.", "x ", "", "a\u0000b"]) {
            expect(safePackPath(bad)).toBeNull();
        }
    });

    test("the world, settings and installed software are kept, whatever the world is called", () => {
        for (const kept of ["server.properties", "world/level.dat", "survival_nether/x", "libraries/a.jar", ".install-1/x", "Ops.json"]) {
            expect(isKeptPath(kept, "survival") || isKeptPath(kept, "world")).toBe(true);
        }
        expect(isKeptPath("survival/region/r.0.0.mca", "survival")).toBe(true);
        expect(isKeptPath("config/world.toml", "world")).toBe(false);
        expect(isKeptPath("mods/a.jar", "world")).toBe(false);
    });
});

describe("pack index", () => {
    const jar = { path: "mods/a.jar", bytes: strToU8("a") };

    test("a pack for another loader is refused", () => {
        expect(() => parsePackIndex(index([jar], { minecraft: "1.21.1", neoforge: "21.1.1" }), "fabric", "world")).toThrow(
            "built for neoforge",
        );
        expect(() => parsePackIndex(index([jar], { minecraft: "1.21.1", "quilt-loader": "0.26" }), "fabric", "world")).toThrow();
        expect(() => parsePackIndex(index([jar]), "paper", "world")).toThrow("does not run modpacks");
    });

    test("client-only files are skipped, kept paths reported, and the loader version read", () => {
        const parsed = parsePackIndex(
            index([jar, { path: "mods/shaders.jar", bytes: strToU8("s"), env: "unsupported" }, { path: "server.properties", bytes: strToU8("p") }]),
            "fabric",
            "world",
        );
        expect(parsed.downloads.map((d) => d.path)).toEqual(["mods/a.jar"]);
        expect(parsed.kept).toEqual(["server.properties"]);
        expect([parsed.mcVersion, parsed.loaderVersion]).toEqual(["1.21.1", "0.16.5"]);
    });

    test("unsafe paths, other hosts and repeated paths refuse the whole pack", () => {
        expect(() => parsePackIndex(index([{ path: "../escape.jar", bytes: strToU8("x") }]), "fabric", "world")).toThrow("unsafe file path");
        expect(() =>
            parsePackIndex(index([{ ...jar, url: "https://evil.example/a.jar" }]), "fabric", "world"),
        ).toThrow("allowed host");
        expect(() =>
            parsePackIndex(index([jar, { path: "MODS/A.jar", bytes: strToU8("b") }]), "fabric", "world"),
        ).toThrow("twice");
    });
});

describe("installing", () => {
    test("places the pack, replaces the old mods, keeps the user's server, and switches the loader build", async () => {
        const h = harness({ installed: { version: "1.21.1", build: "0.16.0" } });
        h.write("mods/old.jar", "old");
        h.write("config/user.cfg", "mine");
        h.write("server.properties", "motd=mine");
        h.write("world/level.dat", "world");
        const files = [{ path: "mods/a.jar", bytes: strToU8("jar-a") }, { path: "config/user.cfg", bytes: strToU8("from-download") }];
        h.serve(files);
        h.publishPack(
            "v1",
            mrpack(index(files), {
                "overrides/config/user.cfg": "from-overrides",
                "overrides/config/new.toml": "base",
                "server-overrides/config/new.toml": "server",
                "overrides/server.properties": "motd=pack",
                "overrides/world/level.dat": "pack-world",
            }),
        );

        const outcome = await install(h, "v1");

        expect(h.read("mods/a.jar")).toBe("jar-a");
        expect(h.read("config/user.cfg")).toBe("from-overrides");
        expect(h.read("config/new.toml")).toBe("server");
        expect(h.read("server.properties")).toBe("motd=mine");
        expect(h.read("world/level.dat")).toBe("world");
        expect(h.has("mods/old.jar")).toBe(false);
        expect(h.trashed("mods/old.jar")).toBe(true);
        expect(h.trashed("config/user.cfg")).toBe(true);
        expect(h.softwareInstalls).toEqual([["fabric", "1.21.1", "0.16.5"]]);
        expect(outcome).toMatchObject({ switchedServer: true, kept: ["server.properties", "world/level.dat"] });
        expect((h.config()[MODPACK_RECORD_KEY] as { files: string[] }).files).toEqual([
            "config/new.toml",
            "config/user.cfg",
            "mods/a.jar",
        ]);
        expect(h.leftovers()).toEqual([]);
    });

    test("bytes that do not match the pack's sha512 are refused and nothing moves", async () => {
        const h = harness();
        h.write("mods/old.jar", "old");
        const file = { path: "mods/a.jar", bytes: strToU8("jar-a"), sha512: "0".repeat(128) };
        h.serve([file]);
        h.publishPack("v1", mrpack(index([file])));

        await expect(install(h, "v1")).rejects.toThrow("sha512");
        expect(h.read("mods/old.jar")).toBe("old");
        expect(h.has("mods/a.jar")).toBe(false);
        expect(h.config()[MODPACK_RECORD_KEY]).toBeUndefined();
        expect(h.leftovers()).toEqual([]);
    });

    test("a failed loader switch puts every old file back and leaves no new folder", async () => {
        const h = harness({ installed: { version: "1.20.1", build: "0.15.0" }, installFails: true });
        h.write("mods/old.jar", "old");
        h.write("config/user.cfg", "mine");
        const files = [{ path: "mods/a.jar", bytes: strToU8("jar-a") }];
        h.serve(files);
        h.publishPack("v1", mrpack(index(files), { "overrides/config/user.cfg": "pack", "overrides/kubejs/x.js": "js" }));

        await expect(install(h, "v1")).rejects.toThrow("installer exploded");
        expect(h.read("mods/old.jar")).toBe("old");
        expect(h.read("config/user.cfg")).toBe("mine");
        expect(h.has("mods/a.jar")).toBe(false);
        expect(h.has("kubejs")).toBe(false);
        expect(h.config()[MODPACK_RECORD_KEY]).toBeUndefined();
        expect(h.leftovers()).toEqual([]);
    });

    test("an update removes what the old version placed and the new one does not", async () => {
        const h = harness();
        const v1 = [{ path: "mods/a.jar", bytes: strToU8("a") }];
        const v2 = [{ path: "mods/b.jar", bytes: strToU8("b") }];
        h.serve([...v1, ...v2]);
        h.publishPack("v1", mrpack(index(v1), { "overrides/config/only-v1.txt": "1", "overrides/config/both.txt": "1" }));
        h.publishPack("v2", mrpack(index(v2), { "overrides/config/both.txt": "2" }));
        await install(h, "v1");
        h.write("config/mine.txt", "user");

        await install(h, "v2");
        expect(h.has("mods/a.jar")).toBe(false);
        expect(h.has("config/only-v1.txt")).toBe(false);
        expect(h.read("config/both.txt")).toBe("2");
        expect(h.read("mods/b.jar")).toBe("b");
        expect(h.read("config/mine.txt")).toBe("user");
        // the loader build already matched: no server reinstall
        expect(h.softwareInstalls).toEqual([]);
    });

    test("mod records for replaced jars are dropped with them", async () => {
        const h = harness();
        h.write("mods/old.jar", "old");
        await h.deps.writeConfig({ [INSTALL_RECORDS_KEY]: { "old.jar": { projectId: "p", slug: "s", version: "1" } } });
        const files = [{ path: "mods/a.jar", bytes: strToU8("a") }];
        h.serve(files);
        h.publishPack("v1", mrpack(index(files)));
        await install(h, "v1");
        expect(h.config()[INSTALL_RECORDS_KEY]).toEqual({});
    });

    test("an override that inflates past its cap is stopped while inflating", async () => {
        const h = harness();
        h.publishPack("v1", mrpack(index([]), { "overrides/config/bomb.bin": new Uint8Array(65 * 1024 * 1024) }));
        await expect(install(h, "v1")).rejects.toThrow("64 MiB");
        expect(h.has("config")).toBe(false);
        expect(h.leftovers()).toEqual([]);
    });

    test("an unsafe override path refuses the pack", async () => {
        const h = harness();
        h.publishPack("v1", mrpack(index([]), { "overrides/con/x.txt": "x" }));
        await expect(install(h, "v1")).rejects.toThrow("unsafe override path");
        expect(h.leftovers()).toEqual([]);
    });
});

describe("removing and recovery", () => {
    test("remove trashes only what the pack placed and keeps the server software", async () => {
        const h = harness();
        const files = [{ path: "mods/a.jar", bytes: strToU8("a") }];
        h.serve(files);
        h.publishPack("v1", mrpack(index(files), { "overrides/config/p.txt": "p" }));
        await install(h, "v1");
        h.write("config/mine.txt", "user");

        expect(await removeModpack(h.deps)).toEqual({ removed: 2 });
        expect(h.has("mods/a.jar")).toBe(false);
        expect(h.trashed("mods/a.jar")).toBe(true);
        expect(h.read("config/mine.txt")).toBe("user");
        expect(h.config()[MODPACK_RECORD_KEY]).toBeNull();
        expect(h.softwareInstalls).toEqual([]);
        expect(h.leftovers()).toEqual([]);
    });

    test("an interrupted activation rolls back unless the record names it, then commits", async () => {
        for (const recorded of [false, true]) {
            const h = harness();
            h.write("mods/old.jar", "old");
            const staging = newPackStagingName();
            h.write(`${packFilesPath(staging)}/mods/new.jar`, "new");
            // activated, then the service dies before commit
            await activatePack({ root: h.root, staging, staged: ["mods/new.jar"], replace: ["mods/old.jar"] });

            const result = await recoverStagedPacks(h.root, recorded ? staging : null);
            expect(h.leftovers()).toEqual([]);
            if (recorded) {
                expect(result.committed).toEqual([staging]);
                expect(h.read("mods/new.jar")).toBe("new");
                expect(h.trashed("mods/old.jar")).toBe(true);
            } else {
                expect(result.rolledBack).toEqual([staging]);
                expect(h.read("mods/old.jar")).toBe("old");
                expect(h.has("mods/new.jar")).toBe(false);
            }
        }
    });

    test("a removal recorded before the crash stays removed", async () => {
        const h = harness();
        const files = [{ path: "mods/a.jar", bytes: strToU8("a") }];
        h.serve(files);
        h.publishPack("v1", mrpack(index(files)));
        await install(h, "v1");
        const staging = newPackStagingName();
        await activatePack({ root: h.root, staging, staged: [], replace: ["mods/a.jar"] });
        await h.deps.writeConfig({ [MODPACK_RECORD_KEY]: null, [MODPACK_STAGING_KEY]: staging });

        await recoverStagedPacks(h.root, h.config()[MODPACK_STAGING_KEY] as string);
        expect(h.has("mods/a.jar")).toBe(false);
        expect(h.trashed("mods/a.jar")).toBe(true);
    });
});

test("pack activation and rollback failure preserve parked originals for recovery", async () => {
    const h = harness();
    h.write("mods/old.jar", "old");
    h.publishPack("v1", mrpack(index([]), { "overrides/mods/new.jar": "new" }));
    h.deps.fs = { ...fs.promises, rename: async (from: string, to: string) => {
        if (to === path.join(h.root, "mods/new.jar") || (to === path.join(h.root, "mods/old.jar") && from.includes("previous"))) throw new Error("rename blocked");
        await fs.promises.rename(from, to);
    } };
    await expect(install(h, "v1")).rejects.toThrow();
    const staging = h.leftovers()[0]!;
    expect(h.read(`${staging}/previous/mods/old.jar`)).toBe("old");
    await recoverStagedPacks(h.root, null);
    expect(h.read("mods/old.jar")).toBe("old");
    expect(h.leftovers()).toEqual([]);
});
