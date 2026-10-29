// Uploaded add-ons against a real temp server folder and real zips built
// here: the page stages the picked files, the service checks each one and
// adds them all or none, names every file it refuses, never overwrites,
// remembers what was uploaded, and always clears the staging folder.
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { UPLOAD_RECORDS_KEY, addonStageDir, archiveProblem } from "../src/core/addonUpload";
import { discardUpload, uploadDatapacks, uploadPlugins, type UploadDeps } from "../src/service/addonUploads";
import { listDatapacks, removeDatapack, type DatapackDeps } from "../src/service/datapacks";

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const STAGE = "0a1b2c3d-1111-4222-8333-444455556666";

function harness() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-uploads-"));
    dirs.push(root);
    let config: Record<string, unknown> = {};
    const deps: UploadDeps & DatapackDeps = {
        serverDir: async () => root,
        levelName: async () => "world",
        readConfig: async () => config,
        writeConfig: async (patch) => {
            config = { ...config, ...patch };
        },
        fetchJson: async () => {
            throw new Error("no network in an upload");
        },
        download: async () => {
            throw new Error("no network in an upload");
        },
        trash: async (paths) => {
            for (const p of paths) fs.rmSync(path.join(root, ...p.split("/")), { recursive: true, force: true });
        },
    };
    const stage = (name: string, data: string | Uint8Array) => {
        const file = path.join(root, ...addonStageDir(STAGE).split("/"), name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
    };
    const has = (rel: string) => fs.existsSync(path.join(root, rel));
    const stageGone = () => !has(addonStageDir(STAGE));
    return { root, deps, stage, has, stageGone, config: () => config };
}

const zip = (entries: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
const plugin = () => zip({ "plugin.yml": "name: Demo\nmain: demo.Main", "demo/Main.class": "x" });
const fabricMod = () => zip({ "fabric.mod.json": "{}", "demo/Main.class": "x" });

describe("jars", () => {
    test("several plugin jars are added together and remembered as uploaded", async () => {
        const h = harness();
        h.stage("Alpha.jar", plugin());
        h.stage("Beta.jar", zip({ "paper-plugin.yml": "name: Beta" }));
        const outcome = await uploadPlugins(STAGE, "paper", h.deps);
        expect(outcome.added).toEqual(["Alpha.jar", "Beta.jar"]);
        expect(h.has("plugins/Alpha.jar") && h.has("plugins/Beta.jar")).toBe(true);
        expect(Object.keys(h.config()[UPLOAD_RECORDS_KEY] as object).sort()).toEqual(["plugins/Alpha.jar", "plugins/Beta.jar"]);
        expect(h.stageGone()).toBe(true);
    });

    test("one refused jar stops the whole upload and each refusal names its file", async () => {
        const h = harness();
        h.stage("Good.jar", plugin());
        h.stage("NotAPlugin.jar", zip({ "readme.txt": "hi" }));
        h.stage("Text.jar", "this is not a zip");
        const err = await uploadPlugins(STAGE, "paper", h.deps).catch((e) => e as Error);
        expect(err.message).toContain("NotAPlugin.jar is not a plugin: it has no plugin.yml or paper-plugin.yml at its top.");
        expect(err.message).toContain("Text.jar is not a zip file");
        expect(err.message).toContain("Nothing was added.");
        expect(h.has("plugins/Good.jar")).toBe(false);
        expect(h.config()[UPLOAD_RECORDS_KEY]).toBeUndefined();
        expect(h.stageGone()).toBe(true);
    });

    test("a mod loader wants a mod manifest, a plugin server a plugin descriptor", async () => {
        const h = harness();
        h.stage("Sodium.jar", fabricMod());
        h.stage("Neo.jar", zip({ "META-INF/neoforge.mods.toml": "x" }));
        h.stage("Forge.jar", zip({ "META-INF/mods.toml": "x" }));
        expect((await uploadPlugins(STAGE, "fabric", h.deps)).added).toEqual(["Forge.jar", "Neo.jar", "Sodium.jar"]);
        expect(h.has("mods/Sodium.jar")).toBe(true);

        h.stage("Plugin.jar", plugin());
        await expect(uploadPlugins(STAGE, "neoforge", h.deps)).rejects.toThrow(
            "Plugin.jar is not a mod: it has no fabric.mod.json, META-INF/mods.toml or META-INF/neoforge.mods.toml at its top.",
        );
        h.stage("Mod.jar", fabricMod());
        await expect(uploadPlugins(STAGE, "paper", h.deps)).rejects.toThrow("Mod.jar is not a plugin");
    });

    test("software without plugins refuses before touching the stage", async () => {
        const h = harness();
        h.stage("A.jar", plugin());
        expect(() => uploadPlugins(STAGE, "vanilla", h.deps)).toThrow("have no plugins or mods");
    });

    test("an existing jar is never overwritten", async () => {
        const h = harness();
        fs.mkdirSync(path.join(h.root, "plugins"));
        fs.writeFileSync(path.join(h.root, "plugins/Alpha.jar"), "mine");
        h.stage("Alpha.jar", plugin());
        h.stage("Beta.jar", plugin());
        await expect(uploadPlugins(STAGE, "paper", h.deps)).rejects.toThrow("Alpha.jar is already in plugins/. Remove it first if you want to replace it.");
        expect(fs.readFileSync(path.join(h.root, "plugins/Alpha.jar"), "utf8")).toBe("mine");
        expect(h.has("plugins/Beta.jar")).toBe(false);
    });

    test("a zip that would unpack outside its folder is refused", async () => {
        const h = harness();
        h.stage("Evil.jar", zip({ "plugin.yml": "name: x", "../../escape.txt": "x" }));
        await expect(uploadPlugins(STAGE, "paper", h.deps)).rejects.toThrow('Evil.jar holds a path that leaves its folder ("../../escape.txt")');
        expect(h.has("plugins/Evil.jar")).toBe(false);
    });

    test("names that are not a jar name and folders are refused", async () => {
        const h = harness();
        h.stage("bad name!.jar", plugin());
        h.stage("folder/inner.jar", plugin());
        h.stage("notes.txt", "x");
        const err = await uploadPlugins(STAGE, "paper", h.deps).catch((e) => e as Error);
        expect(err.message).toContain("bad name!.jar cannot be used as a jar name");
        expect(err.message).toContain("folder is a folder; upload .jar files.");
        expect(err.message).toContain("notes.txt cannot be used as a jar name");
    });

    test("an upload that never arrived, or a stage id that is not ours, fails loudly", async () => {
        const h = harness();
        await expect(uploadPlugins(STAGE, "paper", h.deps)).rejects.toThrow("Nothing was uploaded");
        await expect(uploadPlugins("../../etc", "paper", h.deps)).rejects.toThrow("not an upload Paperboard started");
    });

    test("discarding removes the staged files and is safe to repeat", async () => {
        const h = harness();
        h.stage("A.jar", plugin());
        await discardUpload(STAGE, h.deps);
        await discardUpload(STAGE, h.deps);
        expect(h.stageGone()).toBe(true);
    });
});

describe("datapacks", () => {
    const pack = () => zip({ "pack.mcmeta": '{"pack":{"pack_format":48,"description":"x"}}', "data/x/function/a.mcfunction": "say hi" });

    test("zips and folders go to the active world and are listed as uploaded until removed", async () => {
        const h = harness();
        h.stage("Cool.zip", pack());
        h.stage("Mine/pack.mcmeta", "{}");
        h.stage("Mine/data/a/b.json", "{}");
        const outcome = await uploadDatapacks(STAGE, h.deps);
        expect(outcome.added).toEqual(["Cool.zip", "Mine"]);
        expect(h.has("world/datapacks/Cool.zip") && h.has("world/datapacks/Mine/data/a/b.json")).toBe(true);
        expect(h.stageGone()).toBe(true);

        const listing = await listDatapacks(h.deps);
        expect(listing.packs.map((p) => [p.name, p.kind, p.uploaded, p.record])).toEqual([
            ["Cool.zip", "zip", true, undefined],
            ["Mine", "folder", true, undefined],
        ]);

        await removeDatapack("Cool.zip", h.deps);
        expect(h.has("world/datapacks/Cool.zip")).toBe(false);
        expect(Object.keys(h.config()[UPLOAD_RECORDS_KEY] as object)).toEqual(["world/datapacks/Mine"]);
    });

    test("a pack without pack.mcmeta at its top is refused, with a hint when it is one folder down", async () => {
        const h = harness();
        h.stage("Wrapped.zip", zip({ "Wrapped/pack.mcmeta": "{}", "Wrapped/data/a.json": "{}" }));
        fs.mkdirSync(path.join(h.root, ...addonStageDir(STAGE).split("/"), "NoMeta"));
        fs.writeFileSync(path.join(h.root, ...addonStageDir(STAGE).split("/"), "NoMeta/x.json"), "{}");
        h.stage("readme.txt", "x");
        const err = await uploadDatapacks(STAGE, h.deps).catch((e) => e as Error);
        expect(err.message).toContain('Wrapped.zip is not a datapack: it has no pack.mcmeta at its top. pack.mcmeta is inside "Wrapped/"; zip the folder\'s contents, not the folder.');
        expect(err.message).toContain("NoMeta is not a datapack: it has no pack.mcmeta at its top.");
        expect(err.message).toContain("readme.txt is not a datapack: upload a .zip or a folder.");
        expect(fs.existsSync(path.join(h.root, "world/datapacks"))).toBe(false);
    });

    test("a folder holding a link is refused", async () => {
        const h = harness();
        h.stage("Linked/pack.mcmeta", "{}");
        fs.symlinkSync("/etc/hostname", path.join(h.root, ...addonStageDir(STAGE).split("/"), "Linked/alias.txt"));
        await expect(uploadDatapacks(STAGE, h.deps)).rejects.toThrow("Linked holds alias.txt, which is not a regular file.");
    });

    test("a pack already in the world is not replaced", async () => {
        const h = harness();
        fs.mkdirSync(path.join(h.root, "world/datapacks"), { recursive: true });
        fs.writeFileSync(path.join(h.root, "world/datapacks/Cool.zip"), "mine");
        h.stage("Cool.zip", pack());
        await expect(uploadDatapacks(STAGE, h.deps)).rejects.toThrow("Cool.zip is already in world/datapacks/");
        expect(fs.readFileSync(path.join(h.root, "world/datapacks/Cool.zip"), "utf8")).toBe("mine");
    });
});

describe("archive rules", () => {
    test("entry names that leave their folder, in any spelling, are unsafe", () => {
        for (const bad of ["../x", "a/../../x", "/abs", "C:/x", "a\\b", "a\0b"]) {
            expect(archiveProblem(["plugin.yml", bad], "plugin", "p.jar")).toContain("leaves its folder");
        }
        expect(archiveProblem(["plugin.yml", "a/b..c/d.class"], "plugin", "p.jar")).toBeNull();
    });
});
