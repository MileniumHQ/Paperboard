// World manager service path (bun test): the real service/worlds.ts, core
// planning, directory listing and trash-remove run against an in-memory
// daemon (files, config, `ls`, and a pty that performs the trash move).
// Deleting a world must remove it from the next listing — including the
// ACTIVE world, which used to linger as a "not generated" card until the
// user switched away — and an unreadable panel config must fail loudly
// instead of being listed as empty or overwritten.
import { describe, it, expect, mock, beforeEach } from "bun:test";

let disk = new Set<string>();
let savedConfig: Record<string, unknown> | null = null;
let configReadError: Error | null = null;
const configSets: Record<string, unknown>[] = [];

const dataListeners = new Map<string, (chunk: string) => void>();
const exitListeners = new Map<string, (code?: number) => void>();

const fileContents = new Map<string, string>();

const topLevelDirs = () =>
    [...new Set([...disk].map((p) => p.split("/")[0]))].filter((d) => !d.startsWith(".trash-"));

const fileApiFake = {
    read: async (path: string) =>
        disk.has(path) ? (fileContents.get(path) ?? "") : null,
    write: async (path: string, content: string) => {
        disk.add(path);
        fileContents.set(path, content);
        return `/srv/mc/${path}`;
    },
    exists: async (path: string) => disk.has(path),
    getPath: async () => "/srv/mc",
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
        run: async (opts: { onStdout?: (chunk: string) => void }) => {
            opts.onStdout?.(topLevelDirs().join("\n") + "\n");
            return { exitCode: 0 };
        },
    },
    terminal: {
        create: async () => true,
        // the trash-remove pty: perform the moves the command names, then
        // print the success marker and exit like a real shell would
        write: (id: string, data: string) => {
            const moved = [...data.matchAll(/mv '([^']+)'/g)].map((m) => m[1]);
            for (const dir of moved) {
                for (const path of [...disk]) {
                    if (path === dir || path.startsWith(`${dir}/`)) disk.delete(path);
                }
            }
            queueMicrotask(() => {
                dataListeners.get(id)?.("TRASH_REMOVE_OK\r\n");
                exitListeners.get(id)?.(0);
            });
        },
        onData: (id: string, cb: (chunk: string) => void) => {
            dataListeners.set(id, cb);
            return () => dataListeners.delete(id);
        },
        onExit: (id: string, cb: (code?: number) => void) => {
            exitListeners.set(id, cb);
            return () => exitListeners.delete(id);
        },
        destroy: () => {},
    },
}));

const { listWorlds, deleteActiveWorldDirs, setActiveWorld } = await import(
    "../src/service/worlds"
);
const { cancelPendingPtyDestroys } = await import("../src/service/ptyCleanup");

const offlineCtx = { state: { serverStatus: "offline" } } as any;

function seedWorld(name: string, dims: { nether?: boolean; end?: boolean } = {}) {
    disk.add(`${name}/level.dat`);
    if (dims.nether) disk.add(`${name}_nether/level.dat`);
    if (dims.end) disk.add(`${name}_the_end/level.dat`);
}

function setLevelName(name: string) {
    disk.add("server.properties");
    fileContents.set("server.properties", `level-name=${name}\n`);
}

beforeEach(() => {
    cancelPendingPtyDestroys();
    disk = new Set();
    fileContents.clear();
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
        expect(disk.has("survival_nether/level.dat")).toBe(false);
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
        expect(fileContents.get("server.properties")).toContain("level-seed=12345");
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
        expect(fileContents.get("server.properties")).toContain(
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
