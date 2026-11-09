import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { readTree, tempDir, writeTree } from "./helpers/tmp";
import { uploadDatapacks, uploadPlugins, type UploadDeps } from "../src/service/addonUploads";

const STAGE = "0f8fad5b-d9cb-469f-a165-70867728950e";
const STAGE_DIR = `.paperboard-transfer/addon-${STAGE}`;
const zip = (entries: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
const plugin = (name: string) => zip({ "plugin.yml": `name: ${name}\nmain: x.Main\n`, "x/Main.class": "class" });

/** a server folder with an upload staged; deps are the real filesystem and an in-memory config */
function staged(files: Record<string, string | Uint8Array>, existing: Record<string, string> = {}) {
    const root = tempDir("gameserver-upload-");
    writeTree(root, { "server.properties": "level-name=world\n", ...existing });
    writeTree(root, Object.fromEntries(Object.entries(files).map(([name, content]) => [`${STAGE_DIR}/${name}`, content])));
    let config: Record<string, unknown> = {};
    const deps: UploadDeps = {
        serverDir: async () => root,
        levelName: async () => "world",
        readConfig: async () => config,
        writeConfig: async (patch) => {
            config = { ...config, ...patch };
        },
    };
    return { root, deps, config: () => config, stageGone: () => !fs.existsSync(path.join(root, STAGE_DIR)) };
}

const outside = (root: string) => Object.keys(readTree(root)).filter((f) => !f.startsWith(".paperboard-transfer"));

// Uploads are contained and all-or-nothing.
describe("add-on uploads", () => {
    test("valid plugin jars are all added and recorded, and the stage is removed", async () => {
        const up = staged({ "Essentials.jar": plugin("Essentials"), "WorldEdit.jar": plugin("WorldEdit") });
        expect(await uploadPlugins(STAGE, "paper", up.deps)).toEqual({ added: ["Essentials.jar", "WorldEdit.jar"] });
        expect(fs.readFileSync(path.join(up.root, "plugins", "Essentials.jar"))).toEqual(Buffer.from(plugin("Essentials")));
        expect(Object.keys(up.config().addonUploads as object).sort()).toEqual(["plugins/Essentials.jar", "plugins/WorldEdit.jar"]);
        expect(up.stageGone()).toBe(true);
    });

    test("one bad jar refuses the whole upload, naming each refusal, and the stage is removed", async () => {
        const up = staged({
            "Good.jar": plugin("Good"),
            "Fabric.jar": zip({ "fabric.mod.json": "{}" }),
            "Slip.jar": zip({ "plugin.yml": "name: x", "../../../escape.class": "x" }),
            "notes.txt.jar": "not a zip",
        });
        const before = outside(up.root);
        const err = await uploadPlugins(STAGE, "paper", up.deps).catch((e: Error) => e);
        expect(err).toBeInstanceOf(Error);
        const message = (err as Error).message;
        expect(message).toContain("Fabric.jar is not a plugin");
        expect(message).toContain('Slip.jar holds a path that leaves its folder ("../../../escape.class")');
        expect(message).toContain("notes.txt.jar is not a zip file");
        expect(message).toEndWith("Nothing was added.");
        expect(outside(up.root)).toEqual(before);
        expect(up.stageGone()).toBe(true);
    });

    test("an existing jar is never overwritten", async () => {
        const up = staged({ "Essentials.jar": plugin("New") }, { "plugins/Essentials.jar": "the user's copy" });
        await expect(uploadPlugins(STAGE, "paper", up.deps)).rejects.toThrow("Essentials.jar is already in plugins/");
        expect(fs.readFileSync(path.join(up.root, "plugins", "Essentials.jar"), "utf8")).toBe("the user's copy");
        expect(up.stageGone()).toBe(true);
    });

    test("datapacks go into the world, an existing pack is never replaced, and a folder holding a symlink is refused", async () => {
        const up = staged({ "Terralith.zip": zip({ "pack.mcmeta": "{}", "data/x.json": "{}" }), "Folder/pack.mcmeta": "{}", "Folder/data/a.json": "{}" });
        expect((await uploadDatapacks(STAGE, up.deps)).added).toEqual(["Folder", "Terralith.zip"]);
        expect(fs.existsSync(path.join(up.root, "world", "datapacks", "Folder", "pack.mcmeta"))).toBe(true);

        const again = staged({ "Terralith.zip": zip({ "pack.mcmeta": "{\"new\":1}" }) }, { "world/datapacks/Terralith.zip": "old" });
        await expect(uploadDatapacks(STAGE, again.deps)).rejects.toThrow("Terralith.zip is already in world/datapacks/");
        expect(fs.readFileSync(path.join(again.root, "world", "datapacks", "Terralith.zip"), "utf8")).toBe("old");

        const linked = staged({ "Linked/pack.mcmeta": "{}" });
        const secret = path.join(tempDir(), "secret.txt");
        fs.writeFileSync(secret, "secret");
        fs.symlinkSync(secret, path.join(linked.root, STAGE_DIR, "Linked", "leak.txt"));
        await expect(uploadDatapacks(STAGE, linked.deps)).rejects.toThrow("Linked holds leak.txt, which is not a regular file");
        expect(fs.existsSync(path.join(linked.root, "world", "datapacks"))).toBe(false);
        expect(linked.stageGone()).toBe(true);
        expect(fs.readFileSync(secret, "utf8")).toBe("secret");
    });

    test("a stage id that is not a Paperboard upload id is refused", async () => {
        const up = staged({ "Good.jar": plugin("Good") });
        for (const stage of ["../../etc", "../addon-x", "", null, `${STAGE}/..`]) {
            await expect(uploadPlugins(stage, "paper", up.deps)).rejects.toThrow("That is not an upload Paperboard started");
        }
        expect(fs.existsSync(path.join(up.root, STAGE_DIR, "Good.jar"))).toBe(true);
    });
});
