// Data: what a project's flows keep by key. It is the real store over files
// in memory: writes in order, counts that never lose a run, limits (measured
// as the daemon writes the file), a restart, a backup restored, and a deleted
// project's Data going with it.
import { describe, expect, test } from "bun:test";
import { DataStore, MAX_DATA_BYTES, MAX_DATA_KEY, MAX_DATA_KEYS, projectDataPath } from "../src/lib/data";
import { BUILTIN } from "../src/lib/names";
import type { ProjectStorage } from "../src/lib/projects";
import { flows, onRun, setup, text, until, type Draft } from "./helpers/runtime";
import { memoryStorage } from "./helpers/data";

const P = "p-data";
const num = (n: number) => ({ shadow: { type: "math_number", fields: { NUM: n } } });
const then = (...steps: Draft[]): Draft => steps.reduceRight((next, step) => ({ ...step, next: { block: next } }));
const log = (value: Draft): Draft => ({ type: BUILTIN.log, inputs: { TEXT: { block: value } } });
const count = (key: string): Draft => ({ type: BUILTIN.dataChange, inputs: { KEY: text(key), BY: num(1) } });
const read = (key: string, fallback = 0): Draft => ({ type: BUILTIN.dataGet, inputs: { KEY: text(key), DEFAULT: num(fallback) } });

/** Storage whose writes wait until the test lets them land, in order. */
function slowStorage() {
    const base = memoryStorage();
    const waiting: (() => void)[] = [];
    let writes = 0;
    const storage: ProjectStorage = {
        get: base.get,
        set: (value, path) =>
            new Promise<void>((done) => {
                writes++;
                waiting.push(() => void base.set(value, path).then(done));
            }),
    };
    return { storage, files: base.files, writes: () => writes, land: () => waiting.splice(0).forEach((go) => go()) };
}

describe("a project's Data", () => {
    test("runs counting at the same time never lose a count, and the file holds the last one", async () => {
        const slow = slowStorage();
        const data = new DataStore(slow.storage);
        let counted = null as number[] | null;
        void Promise.all(Array.from({ length: 200 }, () => data.change(P, "runs", 1))).then((all) => (counted = all));
        // a change made while a write waits rides on it
        while (!counted) {
            await new Promise((resolve) => setImmediate(resolve));
            slow.land();
        }
        expect(counted).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
        expect(slow.writes()).toBe(1);
        expect(slow.files.get(projectDataPath(P))).toEqual({ version: 1, values: { runs: 200 } });
        // and one made while a write is landing gets a write of its own after it
        const first = data.change(P, "runs", 1);
        await new Promise((resolve) => setImmediate(resolve));
        const second = data.change(P, "runs", 1);
        while (slow.writes() < 3) {
            await new Promise((resolve) => setImmediate(resolve));
            slow.land();
        }
        slow.land();
        expect(await Promise.all([first, second])).toEqual([201, 202]);
        expect(slow.files.get(projectDataPath(P))).toEqual({ version: 1, values: { runs: 202 } });
    });

    test("keeps what it is given as JSON, reads back a copy, and forgets a key", async () => {
        const storage = memoryStorage();
        const data = new DataStore(storage);
        const players = ["alice", "bob"];
        await data.set(P, "players", players);
        players.push("carol");
        expect(await data.get(P, "players")).toEqual(["alice", "bob"]);
        await data.set(P, "10 seen", true);
        await data.set(P, "2 seen", false);
        expect(await data.keys(P)).toEqual(["2 seen", "10 seen", "players"]);
        expect(await data.delete(P, "players")).toBe(true);
        expect(await data.delete(P, "players")).toBe(false);
        expect(await data.has(P, "players")).toBe(false);
        // a project with no Data left writes none
        await data.delete(P, "10 seen");
        await data.delete(P, "2 seen");
        expect(storage.files.get(projectDataPath(P))).toBeNull();
    });

    test("refuses a key or a value past the limits, and changes nothing", async () => {
        const data = new DataStore(memoryStorage());
        await data.set(P, "kept", 1);
        await expect(data.set(P, "x".repeat(MAX_DATA_KEY + 1), 1)).rejects.toThrow(`at most ${MAX_DATA_KEY} characters`);
        await expect(data.set(P, "big", "x".repeat(600 * 1024))).rejects.toThrow("at most 512 KB");
        await expect(data.change(P, "name", 1).then(() => data.set(P, "name", "alice")).then(() => data.change(P, "name", 1))).rejects.toThrow('"name" holds the string "alice", not a number');
        expect(await data.keys(P)).toEqual(["kept", "name"]);
    });

    test("a count is held to the limits too", async () => {
        const data = new DataStore(memoryStorage());
        for (let i = 0; i < MAX_DATA_KEYS; i++) await data.change(P, `player ${i}`, 1);
        await expect(data.change(P, "one more", 1)).rejects.toThrow(`at most ${MAX_DATA_KEYS} keys`);
        expect(await data.has(P, "one more")).toBe(false);
        // a key already kept still counts
        expect(await data.change(P, "player 0", 1)).toBe(2);
        await expect(data.change(P, "x".repeat(MAX_DATA_KEY + 1), 1)).rejects.toThrow(`at most ${MAX_DATA_KEY} characters`);
    });

    test("the size is the file as the daemon writes it, so a value let in is never refused at the write", async () => {
        // the daemon refuses a panel's file past 1 MiB of pretty-printed UTF-8
        const base = memoryStorage();
        const daemonLike: ProjectStorage = {
            get: base.get,
            set: async (value, path) => {
                if (new TextEncoder().encode(JSON.stringify(value, null, 2)).length > 1024 * 1024) throw new Error("exceeds the 1 MiB payload cap");
                await base.set(value, path);
            },
        };
        const data = new DataStore(daemonLike);
        // about 300 KB as compact JSON, and over a MiB as the file is written
        await expect(data.set(P, "numbers", Array.from({ length: 150_000 }, () => 0))).rejects.toThrow(`at most ${MAX_DATA_BYTES / 1024} KB`);
        // text of two-byte letters is twice its length
        await expect(data.set(P, "text", "é".repeat(300 * 1024))).rejects.toThrow(`at most ${MAX_DATA_BYTES / 1024} KB`);
        expect(await data.keys(P)).toEqual([]);
        // and the project goes on writing
        await data.set(P, "numbers", Array.from({ length: 1000 }, () => 0));
        expect(await data.change(P, "runs", 1)).toBe(1);
        expect(base.files.get(projectDataPath(P))).toMatchObject({ values: { runs: 1 } });
    });

    test("a restore with a write held and a read queued ahead of it reads the backup's Data", async () => {
        const storage = memoryStorage();
        const data = new DataStore(storage);
        await data.set(P, "runs", 1);
        const backup = structuredClone(storage.files.get(projectDataPath(P)));
        await data.set(P, "runs", 5);

        await data.pause();
        // a write held for this project, behind a first read of another
        const held = data.set(P, "runs", 6);
        const other = data.get("p-other", "runs");
        await new Promise((resolve) => setImmediate(resolve));
        storage.files.set(projectDataPath(P), backup);
        await data.resume(true);

        let timer: ReturnType<typeof setTimeout> | undefined;
        const stuck = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("the read after the restore never answered")), 2000)));
        try {
            expect(await Promise.race([data.get(P, "runs"), stuck])).toBe(1);
        } finally {
            clearTimeout(timer);
        }
        await Promise.all([held, other]);
        expect(storage.files.get(projectDataPath(P))).toEqual({ version: 1, values: { runs: 1 } });
        expect(await data.change(P, "runs", 1)).toBe(2);
        expect(storage.files.get(projectDataPath(P))).toEqual({ version: 1, values: { runs: 2 } });
    });

    test("a write that fails fails the block that made it, and the next write carries it", async () => {
        const base = memoryStorage();
        let broken = true;
        const data = new DataStore({ get: base.get, set: async (value, path) => (broken ? Promise.reject(new Error("the disk is full")) : base.set(value, path)) });
        await expect(data.set(P, "a", 1)).rejects.toThrow("the disk is full");
        broken = false;
        await data.set(P, "b", 2);
        expect(base.files.get(projectDataPath(P))).toEqual({ version: 1, values: { a: 1, b: 2 } });
    });

    test("Data written by a newer Blocks, or damaged, is refused, not overwritten", async () => {
        const storage = memoryStorage();
        storage.files.set(projectDataPath(P), { version: 99, values: {} });
        const data = new DataStore(storage);
        await expect(data.set(P, "a", 1)).rejects.toThrow("newer version of Blocks");
        expect(storage.files.get(projectDataPath(P))).toEqual({ version: 99, values: {} });
    });
});

describe("Data in the service", () => {
    test("is still there after a restart", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Counter", flows(onRun(then(count("runs"), log(read("runs"))))));
        await s.call.runFlows({ project: id });
        await until("the first run", () => s.said(id).length === 1);
        const after = setup({ files: s.files });
        await after.ready;
        await after.call.runFlows({ project: id });
        await until("the run after the restart", () => after.said(id).length === 1);
        expect([...s.said(id), ...after.said(id)]).toEqual(["info: 1", "info: 2"]);
    });

    test("a backup restored brings its Data back, and a change held during the restore doesn't land over it", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Counter", flows(onRun(then(count("runs"), log(read("runs"))))));
        await s.call.runFlows({ project: id });
        await until("the first run", () => s.said(id).length === 1);
        const backup = structuredClone(s.files.get(projectDataPath(id)));
        await s.call.runFlows({ project: id });
        await s.call.runFlows({ project: id });
        await until("two more runs", () => s.said(id).length === 3);

        await s.runtime.backup.beforeRestore(null);
        // a run during the restore waits for it
        await s.call.runFlows({ project: id });
        await new Promise((resolve) => setImmediate(resolve));
        s.files.set(projectDataPath(id), backup);
        await s.runtime.backup.restored();
        expect(s.files.get(projectDataPath(id))).toEqual({ version: 1, values: { runs: 1 } });

        await s.call.runFlows({ project: id });
        await until("a run after the restore", () => s.said(id).at(-1) === "info: 2");
    });

    test("a backup holds the Data's writes until it is copied", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Counter", flows(onRun(count("runs"))));
        await s.runtime.backup.beforeBackup(null);
        await s.call.runFlows({ project: id });
        await new Promise((resolve) => setImmediate(resolve));
        expect(s.files.get(projectDataPath(id))).toBeUndefined();
        await s.runtime.backup.resume();
        await until("the write after the backup", () => s.files.get(projectDataPath(id)) !== undefined);
        expect(s.files.get(projectDataPath(id))).toEqual({ version: 1, values: { runs: 1 } });
    });

    test("a deleted project's Data goes with it, and a copy starts with none", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Counter", flows(onRun(then(count("runs"), log(read("runs"))))));
        await s.call.runFlows({ project: id });
        await until("the run", () => s.said(id).length === 1);
        const copy = await s.call.duplicateProject({ project: id });
        await s.call.runFlows({ project: copy.id });
        await until("the copy's run", () => s.said(copy.id).length === 1);
        expect(s.said(copy.id)).toEqual(["info: 1"]);
        await s.call.deleteProject({ project: id });
        expect(s.files.get(projectDataPath(id))).toBeNull();
    });

    test("an empty key fails the block and says so", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Broken", flows(onRun(count(""))));
        await s.call.runFlows({ project: id });
        await until("the failure", () => s.said(id).length === 1);
        expect(s.said(id)).toEqual(["error: Say which key."]);
    });
});
