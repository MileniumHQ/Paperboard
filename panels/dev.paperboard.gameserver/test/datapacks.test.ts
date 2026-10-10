// The Datapacks tab's service against a real temp server folder: it lists
// what the world's datapacks/ folder holds, installs only a verifiable
// build for the server's exact Minecraft version, and removes through the
// trash. Modrinth answers are recorded shapes; the download is the daemon's
// job and is replaced by a writer that checks what it was asked for.
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installDatapack, listDatapacks, removeDatapack, type DatapackDeps } from "../src/service/datapacks";
import { pickDatapackBuild, DATAPACK_RECORDS_KEY } from "../src/core/datapacks";
import { parseModrinthVersion, type RawModrinthVersion } from "../src/core/modrinth";

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const SHA1 = "a".repeat(40);
const SHA512 = "b".repeat(128);

function version(id: string, game: string[], file: Partial<{ url: string; filename: string; sha512: string | null }> = {}): RawModrinthVersion {
    return {
        id,
        project_id: "terralit",
        version_number: `v-${id}`,
        loaders: ["datapack"],
        game_versions: game,
        files: [
            {
                url: file.url ?? `https://cdn.modrinth.com/data/terralit/versions/${id}/pack.zip`,
                filename: file.filename ?? `Terralith_${id}.zip`,
                primary: true,
                hashes: { sha1: SHA1, ...(file.sha512 === null ? {} : { sha512: file.sha512 ?? SHA512 }) },
            },
        ],
    };
}

function harness(opts: { levelName?: string; versions?: RawModrinthVersion[] } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-datapacks-"));
    dirs.push(root);
    let config: Record<string, unknown> = {};
    const downloads: { url: string; targetPath: string; sha1: string }[] = [];
    const trashed: string[][] = [];
    const deps: DatapackDeps = {
        serverDir: async () => root,
        levelName: async () => opts.levelName ?? "world",
        fetchJson: async <T,>(url: string) => {
            if (url.includes("/version?")) return (opts.versions ?? []) as T;
            return { id: "terralit", slug: "terralith", title: "Terralith", icon_url: "https://cdn.modrinth.com/icon.png" } as T;
        },
        download: async (d) => {
            downloads.push(d);
            const target = path.join(root, ...d.targetPath.split("/"));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, "zip");
        },
        readConfig: async () => config,
        writeConfig: async (patch) => {
            config = { ...config, ...patch };
        },
        trash: async (paths) => {
            trashed.push(paths);
            for (const p of paths) fs.rmSync(path.join(root, ...p.split("/")), { recursive: true, force: true });
        },
    };
    return { root, deps, downloads, trashed, config: () => config };
}

describe("choosing a build", () => {
    const parsed = (raw: RawModrinthVersion[]) => raw.map(parseModrinthVersion).filter((v) => v !== null);

    test("only a build for the exact Minecraft version is installed", () => {
        const versions = parsed([version("new", ["1.21.4"]), version("old", ["1.21.1"])]);
        expect(pickDatapackBuild(versions, "1.21.1").version.id).toBe("old");
        expect(() => pickDatapackBuild(versions, "1.20.1")).toThrow("no build for Minecraft 1.20.1");
        // a chosen version for another Minecraft release is refused, not swapped
        expect(() => pickDatapackBuild(versions, "1.21.1", "new")).toThrow("no build for Minecraft 1.21.1");
    });

    test("a file without both hashes or over plain http is never picked", () => {
        expect(() => pickDatapackBuild(parsed([version("a", ["1.21.1"], { sha512: null })]), "1.21.1")).toThrow();
        expect(() =>
            pickDatapackBuild(parsed([version("a", ["1.21.1"], { url: "http://cdn.modrinth.com/x.zip" })]), "1.21.1"),
        ).toThrow();
    });

    test("a file name that could leave datapacks/ is refused", () => {
        expect(() =>
            pickDatapackBuild(parsed([version("a", ["1.21.1"], { filename: "../../server.zip" })]), "1.21.1"),
        ).toThrow("Not a datapack name");
    });
});

describe("install, list, remove", () => {
    test("installs into the active world's datapacks folder and lists it with its record", async () => {
        const h = harness({ levelName: "survival", versions: [version("abc12345", ["1.21.1"])] });
        fs.mkdirSync(path.join(h.root, "survival"));
        fs.writeFileSync(path.join(h.root, "survival/level.dat"), "");
        const result = await installDatapack({ projectId: "terralit" }, "1.21.1", h.deps);
        expect(result).toEqual({ name: "Terralith_abc12345.zip", world: "survival", version: "v-abc12345" });
        expect(h.downloads).toEqual([
            {
                url: "https://cdn.modrinth.com/data/terralit/versions/abc12345/pack.zip",
                targetPath: "survival/datapacks/Terralith_abc12345.zip",
                sha1: SHA1,
            },
        ]);

        // a hand-added folder pack and a stray file sit beside it
        fs.mkdirSync(path.join(h.root, "survival/datapacks/my_pack"));
        fs.writeFileSync(path.join(h.root, "survival/datapacks/notes.txt"), "");
        const listing = await listDatapacks(h.deps);
        expect(listing.world).toBe("survival");
        expect(listing.worldExists).toBe(true);
        expect(listing.packs.map((p) => [p.name, p.kind, p.record?.title])).toEqual([
            ["my_pack", "folder", undefined],
            ["Terralith_abc12345.zip", "zip", "Terralith"],
        ]);
    });

    test("the same file twice is refused instead of overwritten", async () => {
        const h = harness({ versions: [version("abc12345", ["1.21.1"])] });
        await installDatapack({ projectId: "terralit" }, "1.21.1", h.deps);
        await expect(installDatapack({ projectId: "terralit" }, "1.21.1", h.deps)).rejects.toThrow("already in");
        expect(h.downloads).toHaveLength(1);
    });

    test("a world that does not exist yet still lists, empty", async () => {
        const h = harness();
        const listing = await listDatapacks(h.deps);
        expect(listing).toEqual({ world: "world", worldExists: false, packs: [], truncated: false });
    });

    test("installing before the first start does not make the world look created", async () => {
        const h = harness({ versions: [version("abc12345", ["1.21.1"])] });
        await installDatapack({ projectId: "terralit" }, "1.21.1", h.deps);
        expect((await listDatapacks(h.deps)).worldExists).toBe(false);
    });

    test("remove goes through the trash and drops the record", async () => {
        const h = harness({ versions: [version("abc12345", ["1.21.1"])] });
        await installDatapack({ projectId: "terralit" }, "1.21.1", h.deps);
        await removeDatapack("Terralith_abc12345.zip", h.deps);
        expect(h.trashed).toEqual([["world/datapacks/Terralith_abc12345.zip"]]);
        expect(h.config()[DATAPACK_RECORDS_KEY]).toEqual({});
        expect((await listDatapacks(h.deps)).packs).toEqual([]);
    });

    test("names and ids from the page are checked before anything is touched", async () => {
        const h = harness({ versions: [version("abc12345", ["1.21.1"])] });
        await expect(removeDatapack("../server.properties", h.deps)).rejects.toThrow("Not a datapack name");
        await expect(installDatapack({ projectId: "../../x" }, "1.21.1", h.deps)).rejects.toThrow("not a Modrinth id");
        expect(h.trashed).toEqual([]);
        expect(h.downloads).toEqual([]);
    });
});
