// World manager service path (bun test): the real service/worlds.ts, core
// planning, directory listing and trash-remove run against a temporary
// server folder on disk (files, `ls`, and the trash rename are real; the
// daemon's config store is in memory).
// Deleting a world must remove it from the next listing — including the
// ACTIVE world, which used to linger as a "not generated" card until the
// user switched away — and an unreadable panel config must fail loudly
// instead of being listed as empty or overwritten.
import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gameserver-worlds-"));
let savedConfig: Record<string, unknown> | null = null;
let configReadError: Error | null = null;
const configSets: Record<string, unknown>[] = [];

const inRoot = (path: string) => nodePath.join(root, ...path.split("/"));
const exists = (path: string) => fs.existsSync(inRoot(path));
const readText = (path: string) => fs.readFileSync(inRoot(path), "utf8");

const fileApiFake = {
    read: async (path: string) => (exists(path) ? readText(path) : null),
    write: async (path: string, content: string) => {
        fs.mkdirSync(nodePath.dirname(inRoot(path)), { recursive: true });
        fs.writeFileSync(inRoot(path), content);
        return inRoot(path);
    },
    exists: async (path: string) => exists(path),
    getPath: async (path: string) => inRoot(path),
};

mock.module("@paperboard-dev/paperapi", () => ({
    config: {
        get: async () => {
            if (configReadError) throw configReadError;
            return savedConfig;
        },
        set: async (value: Record<string, unknown>) => {
            configSets.push(value);
            savedConfig = value;
            return true;
        },
    },
    files: fileApiFake,
    fileApi: fileApiFake,
    system: { getInfo: async () => ({ os: "linux" }) },
    processApi: {
        // lib/filesystem lists the server root with `ls -1 <dir>`
        run: async (opts: { args: string[]; onStdout?: (chunk: string) => void }) => {
            opts.onStdout?.(fs.readdirSync(opts.args[1]).join("\n") + "\n");
            return { exitCode: 0 };
        },
    },
}));

const { listWorlds, deleteActiveWorldDirs, setActiveWorld } = await import(
    "../src/service/worlds"
);

const offlineCtx = { state: { serverStatus: "offline" } } as any;

function seedWorld(name: string, dims: { nether?: boolean; end?: boolean } = {}) {
    const levelDat = (dir: string) => {
        fs.mkdirSync(inRoot(dir), { recursive: true });
        fs.writeFileSync(inRoot(`${dir}/level.dat`), "level");
    };
    levelDat(name);
    if (dims.nether) levelDat(`${name}_nether`);
    if (dims.end) levelDat(`${name}_the_end`);
}

function setLevelName(name: string) {
    fs.writeFileSync(inRoot("server.properties"), `level-name=${name}\n`);
}

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    for (const entry of fs.readdirSync(root)) {
        fs.rmSync(nodePath.join(root, entry), { recursive: true, force: true });
    }
    savedConfig = null;
    configReadError = null;
    configSets.length = 0;
});

describe("world deletion reaches the next listing", () => {
    it("drops a deleted inactive world", async () => {
        seedWorld("survival");
        seedWorld("creative");
        setLevelName("survival");
        await deleteActiveWorldDirs(offlineCtx, "creative");
        expect((await listWorlds()).map((w) => w.name)).toEqual(["survival"]);
    });

    it("drops the deleted ACTIVE world instead of listing a placeholder", async () => {
        seedWorld("survival", { nether: true, end: true });
        seedWorld("creative");
        setLevelName("survival");
        await deleteActiveWorldDirs(offlineCtx, "survival");
        const names = (await listWorlds()).map((w) => w.name);
        expect(names).toEqual(["creative"]);
        expect(exists("survival_nether/level.dat")).toBe(false);
        // trashed, not destroyed: the bytes are recoverable from .trash-*
        const trash = fs.readdirSync(root).find((e) => e.startsWith(".trash-"));
        expect(trash).toBeDefined();
        expect(exists(`${trash}/survival_nether/level.dat`)).toBe(true);
    });

    it("drops a created-but-never-started world", async () => {
        seedWorld("survival");
        setLevelName("survival");
        await setActiveWorld(offlineCtx, "fresh");
        expect((await listWorlds()).map((w) => [w.name, w.active, w.generated])).toEqual([
            ["fresh", true, false],
            ["survival", false, true],
        ]);
        await deleteActiveWorldDirs(offlineCtx, "fresh");
        expect((await listWorlds()).map((w) => w.name)).toEqual(["survival"]);
    });
});

describe("recreating the configured world", () => {
    it("is a create, so the seed lands and the world is listed", async () => {
        setLevelName("world");
        const res = await setActiveWorld(offlineCtx, "world", "12345");
        expect(res).toEqual({ activated: "world", created: true });
        expect(readText("server.properties")).toContain("level-seed=12345");
        expect((await listWorlds()).map((w) => [w.name, w.active, w.generated])).toEqual([
            ["world", true, false],
        ]);
    });

    it("stays a noop when the active world exists on disk", async () => {
        seedWorld("world");
        setLevelName("world");
        expect(await setActiveWorld(offlineCtx, "world")).toEqual({
            activated: "world",
            created: false,
        });
    });

    it("refuses an existing name when the caller asked to create only", async () => {
        seedWorld("world");
        setLevelName("survival");
        await expect(
            setActiveWorld(offlineCtx, "world", undefined, true),
        ).rejects.toThrow(/already exists/);
        // the refusal happens before server.properties is rewritten
        expect(readText("server.properties")).toContain(
            "level-name=survival",
        );
    });
});

describe("unreadable panel config", () => {
    it("fails the listing instead of hiding created worlds", async () => {
        seedWorld("survival");
        configReadError = new Error("config read failed");
        await expect(listWorlds()).rejects.toThrow(/config read failed/);
    });

    it("refuses to overwrite it when recording a created world", async () => {
        seedWorld("survival");
        setLevelName("survival");
        configReadError = new Error("config read failed");
        await expect(setActiveWorld(offlineCtx, "fresh")).rejects.toThrow(/config read failed/);
        expect(configSets).toEqual([]);
    });

    it("preserves sibling config keys when it is readable", async () => {
        savedConfig = { software: "paper", version: "1.21.4" };
        seedWorld("survival");
        setLevelName("survival");
        await setActiveWorld(offlineCtx, "fresh");
        expect(savedConfig).toEqual({
            software: "paper",
            version: "1.21.4",
            pendingWorlds: ["fresh"],
        });
    });
});
