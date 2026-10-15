// World upload and download (bun test): real zips written and read on a
// temporary server folder. A downloaded world uploads back byte for byte,
// a running server's saving is paused around the copy of its world, and a
// zip that reaches outside its world is refused before anything is written.
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { zipSync, strToU8 } from "fflate";

const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gameserver-transfer-"));
const inRoot = (path: string) => nodePath.join(root, ...path.split("/"));
const written: string[] = [];
let running = true;
let confirmations: Record<string, string> = {};

const filesFake = {
        getPath: async (path: string) => inRoot(path),
        read: async (path: string) => (fs.existsSync(inRoot(path)) ? fs.readFileSync(inRoot(path), "utf8") : null),
        write: async (path: string, content: string) => fs.writeFileSync(inRoot(path), content),
        exists: async (path: string) => fs.existsSync(inRoot(path)),
        delete: async (path: string) => { fs.rmSync(inRoot(path), { force: true }); return true; },
};

mock.module("@mileniumhq/paperapi", () => ({
    files: filesFake,
    fileApi: filesFake,
    config: { get: async () => null, set: async () => true },
    system: { getInfo: async () => ({ os: "linux" }) },
    processApi: {
        exists: async () => running,
        // the fake server answers each command the way Minecraft does
        write: async (_id: string, text: string) => {
            const command = text.trim();
            written.push(command);
            const reply = confirmations[command];
            if (reply) queueMicrotask(() => saving.observeSavingLine(reply));
        },
    },
}));

const saving = await import("../src/service/saving");
const transfer = await import("../src/service/worldTransfer");
const { planWorldImport, worldNameFromFile } = await import("../src/core/worldArchive");

const offline = { state: { serverStatus: "offline" } } as any;
const online = { state: { serverStatus: "online" } } as any;
const region = new Uint8Array(200_000).map((_, i) => (i * 31) % 251);

function seed(name: string) {
    fs.mkdirSync(inRoot(`${name}/region`), { recursive: true });
    fs.writeFileSync(inRoot(`${name}/level.dat`), "level");
    fs.writeFileSync(inRoot(`${name}/region/r.0.0.mca`), region);
    fs.writeFileSync(inRoot(`${name}/session.lock`), "locked");
    fs.mkdirSync(inRoot(`${name}_nether/DIM-1`), { recursive: true });
    fs.writeFileSync(inRoot(`${name}_nether/level.dat`), "nether");
}

beforeEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root);
    fs.writeFileSync(inRoot("server.properties"), "level-name=world\n");
    written.length = 0;
    running = true;
    confirmations = {
        "save-off": "[12:00:00 INFO]: Automatic saving is now disabled",
        "save-all flush": "[12:00:01 INFO]: Saved the game",
    };
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("world download and upload", () => {
    it("a downloaded world uploads back as a new world, byte for byte", async () => {
        seed("world");
        const { file, bytes } = await transfer.exportWorld(offline, "world");
        expect(bytes).toBe(fs.statSync(inRoot(`.paperboard-transfer/${file}`)).size);
        expect(written).toEqual([]);

        const added = await transfer.importWorld(file, "copy");
        expect(added.folders).toEqual(["copy", "copy_nether"]);
        expect(new Uint8Array(fs.readFileSync(inRoot("copy/region/r.0.0.mca")))).toEqual(region);
        expect(fs.readFileSync(inRoot("copy_nether/level.dat"), "utf8")).toBe("nether");
        expect(fs.existsSync(inRoot("copy/session.lock"))).toBe(false);
        // the upload is gone, and so is the staging folder
        expect(fs.readdirSync(inRoot(".paperboard-transfer"))).toEqual([]);
        // the original is untouched
        expect(fs.readFileSync(inRoot("world/level.dat"), "utf8")).toBe("level");
    });

    it("pauses saving around the copy of the world a running server plays", async () => {
        seed("world");
        await transfer.exportWorld(online, "world");
        expect(written).toEqual(["save-off", "save-all flush", "save-on"]);
        expect(fs.existsSync(inRoot(".paperboard-saving-paused"))).toBe(false);
    });

    it("turns saving back on and keeps no zip when the copy fails", async () => {
        seed("world");
        fs.chmodSync(inRoot("world/region/r.0.0.mca"), 0o000);
        try {
            await expect(transfer.exportWorld(online, "world")).rejects.toThrow();
        } finally {
            fs.chmodSync(inRoot("world/region/r.0.0.mca"), 0o644);
        }
        expect(written).toEqual(["save-off", "save-all flush", "save-on"]);
        expect(fs.readdirSync(inRoot(".paperboard-transfer"))).toEqual([]);
        expect(fs.existsSync(inRoot(".paperboard-saving-paused"))).toBe(false);
    });

    it("a service that died mid-copy turns saving back on when it starts", async () => {
        fs.writeFileSync(inRoot(".paperboard-saving-paused"), "then");
        expect(await saving.recoverPausedSaving()).toBe(true);
        expect(written).toEqual(["save-on"]);
        expect(fs.existsSync(inRoot(".paperboard-saving-paused"))).toBe(false);
        expect(await saving.recoverPausedSaving()).toBe(false);
    });

    it("refuses a zip that reaches outside its world, writing nothing", async () => {
        fs.mkdirSync(inRoot(".paperboard-transfer"));
        fs.writeFileSync(inRoot(".paperboard-transfer/evil.zip"), zipSync({
            "world/level.dat": strToU8("level"),
            "world/../../escaped.txt": strToU8("out"),
        }));
        await expect(transfer.importWorld("evil.zip", "evil")).rejects.toThrow("unsafe file path");
        expect(fs.existsSync(inRoot("evil"))).toBe(false);
        expect(fs.existsSync(nodePath.join(root, "..", "escaped.txt"))).toBe(false);
        expect(fs.readdirSync(inRoot(".paperboard-transfer"))).toEqual([]);
    });

    it("never replaces a world that already has the name", async () => {
        seed("world");
        const { file } = await transfer.exportWorld(offline, "world");
        await expect(transfer.importWorld(file, "WORLD")).rejects.toThrow("already exists");
        expect(fs.readFileSync(inRoot("world/level.dat"), "utf8")).toBe("level");
    });

    it("refuses transfer file names that are not plain zip names", async () => {
        await expect(transfer.importWorld("../server.properties", "x")).rejects.toThrow("not a world transfer file");
        await expect(transfer.discardWorldTransfer("../../etc.zip")).rejects.toThrow("not a world transfer file");
    });
});

describe("where an uploaded world's files go", () => {
    it("takes a world at the zip's top, in a folder, or beside its nether and end", () => {
        expect([...planWorldImport(["level.dat", "region/r.mca"], "a").targets.values()]).toEqual(["a/level.dat", "a/region/r.mca"]);
        const nested = planWorldImport(["saves/My World/level.dat", "saves/My World/DIM-1/r.mca", "readme.txt"], "a");
        expect([...nested.targets.values()]).toEqual(["a/level.dat", "a/DIM-1/r.mca"]);
        const split = planWorldImport(["w/level.dat", "w_nether/level.dat", "w_the_end/DIM1/x"], "b");
        expect(split.folders).toEqual(["b", "b_nether", "b_the_end"]);
    });

    it("refuses what is not one world", () => {
        expect(() => planWorldImport(["readme.txt"], "a")).toThrow("no level.dat");
        expect(() => planWorldImport(["a/level.dat", "b/level.dat"], "a")).toThrow("more than one world");
        expect(() => planWorldImport(["level.dat"], "../x")).toThrow("not a usable world name");
    });

    it("names an upload after its file, never after a taken world", () => {
        expect(worldNameFromFile("My World (2).zip", [])).toBe("My_World_2");
        expect(worldNameFromFile("world.zip", ["world"])).toBe("world_2");
        expect(worldNameFromFile("w.zip", ["w_nether"])).toBe("w_2");
    });
});
