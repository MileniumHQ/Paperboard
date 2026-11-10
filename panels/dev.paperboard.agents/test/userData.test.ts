import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import type { Routine } from "../src/contract";
import { Checkpoints } from "../src/service/checkpoints";
import { HomeFolder } from "../src/service/homeFolder";
import { Memory, type MemoryChange } from "../src/service/memory";
import { Routines } from "../src/service/routines";
import { tempDir } from "./support/host";

const dirs: string[] = [];
const closers: (() => unknown)[] = [];
afterEach(async () => {
    for (const c of closers.splice(0)) await c();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const temp = () => {
    const d = tempDir("userdata");
    dirs.push(d);
    return d;
};

// Memory, routines and checkpoints keep user data (memory).
describe("memory", () => {
    test("facts and notes survive a restart, and concurrent adds are all kept", async () => {
        const dir = temp();
        const memory = new Memory({ dir, onChange: () => {} });
        const facts = await Promise.all(Array.from({ length: 20 }, (_, i) => memory.addFact(`fact number ${i}`)));
        await memory.saveNote("trip-plans", "when the user talks about travel", "# Lisbon\nIn May.");
        const again = new Memory({ dir, onChange: () => {} });
        const list = await again.list();
        expect(list.facts.map((f) => f.text).sort()).toEqual(facts.map((f) => f.text).sort());
        expect(list.facts).toHaveLength(20);
        expect(list.notes).toEqual([{ key: "trip-plans", when: "when the user talks about travel" }]);
        expect((await again.readNote("trip-plans")).body).toBe("# Lisbon\nIn May.");
    });

    test("an unreadable index is an error, shown, and never written over", async () => {
        const dir = temp();
        fs.mkdirSync(dir, { recursive: true });
        const index = path.join(dir, "index.json");
        fs.writeFileSync(index, '{"version":1,"facts":[{"id":"f-1","text":"the user is Ada"}');
        const changes: MemoryChange[] = [];
        const memory = new Memory({ dir, onChange: (c) => changes.push(c) });
        await expect(memory.list()).rejects.toThrow(/memory's index is unreadable/);
        await expect(memory.addFact("a new fact")).rejects.toThrow(/left as it is/);
        await expect(memory.saveNote("x", "when", "body")).rejects.toThrow(/left as it is/);
        expect(fs.readFileSync(index, "utf8")).toBe('{"version":1,"facts":[{"id":"f-1","text":"the user is Ada"}');
        expect(changes.at(-1)!.error).toMatch(/unreadable/);
        // and the agent is told, not shown an empty memory
        expect(await memory.instructions()).toMatch(/^Your memory is unavailable right now/);
    });
});

// Memory, routines and checkpoints keep user data (routines).
describe("routines", () => {
    const MIN = 60_000;

    function routines(file: string, clock: { now: number }) {
        const runs: { routine: Routine; late: boolean }[] = [];
        const r = new Routines({ file, run: (routine, late) => runs.push({ routine, late }), onChange: () => {}, now: () => clock.now });
        closers.push(() => r.shutdown());
        return { r, runs };
    }

    test("they persist, and each runs once per due time", async () => {
        const file = path.join(temp(), "routines.json");
        const clock = { now: Date.UTC(2026, 10, 9, 12, 0) };
        const first = routines(file, clock);
        await first.r.load();
        const every = await first.r.add("check the forum", { kind: "every", minutes: 15 });
        await first.r.shutdown();

        const second = routines(file, clock);
        await second.r.load();
        expect(second.r.list().map((x) => [x.id, x.what])).toEqual([[every.id, "check the forum"]]);
        clock.now += 15 * MIN;
        await second.r.check();
        await second.r.check();
        expect(second.runs.map((x) => x.routine.id)).toEqual([every.id]);
        clock.now += 15 * MIN;
        await second.r.check();
        expect(second.runs).toHaveLength(2);
    });

    test("a one-off missed while the service was down runs once, late, and is done", async () => {
        const file = path.join(temp(), "routines.json");
        const clock = { now: Date.UTC(2026, 10, 9, 12, 0) };
        const first = routines(file, clock);
        await first.r.load();
        const once = await first.r.add("text the user happy birthday", { kind: "once", at: clock.now + 30 * MIN });
        await first.r.shutdown();
        clock.now += 3 * 60 * MIN;
        const second = routines(file, clock);
        await second.r.load();
        await second.r.check();
        await second.r.check();
        expect(second.runs.map((x) => [x.routine.id, x.late])).toEqual([[once.id, true]]);
        expect(second.r.list()).toEqual([]);
        expect(JSON.parse(fs.readFileSync(file, "utf8")).routines).toEqual([]);
    });

    test("an unreadable routines.json is left alone and nothing runs", async () => {
        const file = path.join(temp(), "routines.json");
        const damaged = '{"version":1,"routines":[{"id":"abc123","what":"x","schedule":{"kind":"once","at":1},"created":0}';
        fs.writeFileSync(file, damaged);
        const clock = { now: Date.UTC(2026, 10, 9, 12, 0) };
        const { r, runs } = routines(file, clock);
        await r.load();
        await r.check();
        expect(runs).toEqual([]);
        expect(() => r.list()).toThrow(/routines file is unreadable/);
        await expect(r.add("another", { kind: "every", minutes: 30 })).rejects.toThrow(/left as it is/);
        expect(fs.readFileSync(file, "utf8")).toBe(damaged);
    });
});

// Memory, routines and checkpoints keep user data (checkpoints).
describe("checkpoints", () => {
    function setup() {
        const root = temp();
        const home = new HomeFolder(path.join(root, "home"));
        home.ensure();
        const checkpoints = new Checkpoints({ home, dir: path.join(root, "checkpoints") });
        const tools = checkpoints.toolset();
        const call = async (name: string, args: Record<string, unknown>) => {
            const r = await tools.call(name, args, { fromFlow: false });
            return r;
        };
        const file = (rel: string) => path.join(home.root, ...rel.split("/"));
        return { root, home, call, file };
    }

    test("a restore brings the home folder back, and checkpoints first so it can be undone", async () => {
        const { call, file } = setup();
        fs.mkdirSync(file("Apps/planner"), { recursive: true });
        fs.writeFileSync(file("Apps/planner/index.html"), "v1");
        fs.writeFileSync(file("notes.txt"), "keep me");
        expect((await call("checkpoint", { note: "planner works" })).text).toMatch(/^Kept checkpoint 1/);

        fs.writeFileSync(file("Apps/planner/index.html"), "v2 broken");
        fs.rmSync(file("notes.txt"));
        fs.writeFileSync(file("stray.txt"), "new");
        const restored = await call("restore", { checkpoint: 1 });
        expect(restored.isError).toBeFalsy();
        expect(restored.text).toContain("Checkpoint 2 has how it was before");
        expect(fs.readFileSync(file("Apps/planner/index.html"), "utf8")).toBe("v1");
        expect(fs.readFileSync(file("notes.txt"), "utf8")).toBe("keep me");
        expect(fs.existsSync(file("stray.txt"))).toBe(false);

        // the restore is undone by the checkpoint it made
        await call("restore", { checkpoint: 2 });
        expect(fs.readFileSync(file("Apps/planner/index.html"), "utf8")).toBe("v2 broken");
        expect(fs.existsSync(file("notes.txt"))).toBe(false);
        expect(fs.readFileSync(file("stray.txt"), "utf8")).toBe("new");
    });

    test("links are never stored, followed or written through, and paths outside home are refused", async () => {
        const { root, call, file } = setup();
        const outside = path.join(root, "outside");
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, "secret.txt"), "the user's own file");
        fs.mkdirSync(file("docs"));
        fs.writeFileSync(file("docs/a.txt"), "home's a");
        fs.symlinkSync(outside, file("link"));
        const made = await call("checkpoint", { note: "with a link" });
        expect(made.text).toContain("Not kept: ~/link (a link)");
        expect(fs.readdirSync(path.join(root, "checkpoints", "files")).flatMap((s) => fs.readdirSync(path.join(root, "checkpoints", "files", s)))).toHaveLength(1);

        // ~/docs becomes a link out of home; restoring docs/a.txt must not write through it
        fs.rmSync(file("docs"), { recursive: true });
        fs.symlinkSync(outside, file("docs"));
        const restore = await call("restore", { checkpoint: 1, path: "~/docs" });
        expect(restore.isError).toBe(true);
        expect(fs.readdirSync(outside)).toEqual(["secret.txt"]);
        expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("the user's own file");

        for (const where of ["../outside", "/etc", "~/../outside", "~/link/secret.txt"]) {
            const r = await call("restore", { checkpoint: 1, path: where });
            expect(r.isError).toBe(true);
            expect(r.text).toMatch(/home folder/);
        }
        expect(fs.readdirSync(outside)).toEqual(["secret.txt"]);
    });
});
