import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Routine, RoutinesState } from "../src/contract";
import { nextRun, parseSchedule, RoutineError, Routines } from "../src/service/routines";

// Every time here is local, as the routines' are; the dates are fixed so the weekdays are known.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const WED_10 = at(2026, 10, 21, 10, 0); // a Wednesday

const dirs: string[] = [];
const made: Routines[] = [];
afterEach(async () => {
    await Promise.all(made.splice(0).map((r) => r.shutdown()));
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup(o: { dir?: string; now?: number; fail?: string } = {}) {
    const dir = o.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "ai-routines-"));
    if (!o.dir) dirs.push(dir);
    const clock = { now: o.now ?? WED_10 };
    const runs: { id: string; late: boolean }[] = [];
    const states: RoutinesState[] = [];
    const routines = new Routines({
        file: path.join(dir, "routines.json"),
        now: () => clock.now,
        run: (r: Routine, late: boolean) => {
            if (o.fail) throw new Error(o.fail);
            runs.push({ id: r.id, late });
        },
        onChange: (s) => states.push(s),
    });
    made.push(routines);
    return { routines, clock, runs, states, dir, file: path.join(dir, "routines.json") };
}

describe("schedules", () => {
    test("weekdays at a time: the next one, skipping the weekend", () => {
        const r = { schedule: parseSchedule({ time: "09:00", days: ["mon", "tue", "wed", "thu", "fri"] }, WED_10), created: WED_10, lastRun: null };
        expect(nextRun(r, WED_10)).toBe(at(2026, 10, 22, 9)); // Thursday, not this morning
        expect(nextRun(r, at(2026, 10, 23, 9, 30))).toBe(at(2026, 10, 26, 9)); // Friday after 9 → Monday
        // left out, days are every day; later the same day is today
        expect(nextRun({ ...r, schedule: parseSchedule({ time: "18:30" }, WED_10) }, WED_10)).toBe(at(2026, 10, 21, 18, 30));
    });

    test("every so many minutes, from the last run", () => {
        const r = { schedule: parseSchedule({ every_minutes: 60 }, WED_10), created: WED_10, lastRun: null };
        expect(nextRun(r, WED_10)).toBe(WED_10 + 3_600_000);
        // missed runs aren't owed: the next is the first one after now
        expect(nextRun(r, WED_10 + 5.5 * 3_600_000)).toBe(WED_10 + 6 * 3_600_000);
        expect(nextRun({ ...r, lastRun: WED_10 + 600_000 }, WED_10 + 600_000)).toBe(WED_10 + 600_000 + 3_600_000);
    });

    test("bad schedules are refused with a reason", () => {
        const bad = (a: Record<string, unknown>) => expect(() => parseSchedule(a, WED_10)).toThrow(RoutineError);
        bad({});
        bad({ time: "09:00", every_minutes: 60 });
        bad({ at: "2026-10-21 09:00" }); // already passed
        bad({ at: "2026-02-30 09:00" }); // not a date
        bad({ at: "tomorrow" });
        bad({ time: "9am" });
        bad({ time: "09:00", days: ["someday"] });
        bad({ every_minutes: 5 });
        expect(parseSchedule({ at: "2026-10-23 09:00" }, WED_10)).toEqual({ kind: "once", at: at(2026, 10, 23, 9) });
    });
});

describe("routines", () => {
    test("added routines are kept in their file and come back after a restart", async () => {
        const { routines, dir, file } = setup();
        await routines.load();
        const r = await routines.add("text a flag fact", { kind: "weekly", time: "09:00", days: [1, 2, 3, 4, 5] });
        expect(r.next).toBe(at(2026, 10, 22, 9));
        expect(JSON.parse(fs.readFileSync(file, "utf8")).routines).toHaveLength(1);

        const again = setup({ dir });
        await again.routines.load();
        expect(again.routines.list().map((x) => [x.id, x.what, x.next])).toEqual([[r.id, "text a flag fact", at(2026, 10, 22, 9)]]);
    });

    test("when due, a routine runs once; a one-off is then gone and a repeat moves on", async () => {
        const { routines, clock, runs } = setup();
        await routines.load();
        const once = await routines.add("remind about the dentist", { kind: "once", at: at(2026, 10, 21, 12) });
        const daily = await routines.add("flag fact", { kind: "weekly", time: "12:00", days: [0, 1, 2, 3, 4, 5, 6] });
        await routines.check(); // nothing due yet
        expect(runs).toEqual([]);

        clock.now = at(2026, 10, 21, 12, 0);
        await routines.check();
        await routines.check(); // a second check at the same time runs nothing again
        expect(runs.map((r) => r.id).sort()).toEqual([once.id, daily.id].sort());
        expect(runs.every((r) => !r.late)).toBe(true);
        expect(routines.list().map((r) => [r.id, r.next, r.lastRun])).toEqual([[daily.id, at(2026, 10, 22, 12), at(2026, 10, 21, 12)]]);
    });

    test("after downtime, a missed one-off runs late, once; a missed repeat is skipped", async () => {
        const { routines, dir } = setup();
        await routines.load();
        const once = await routines.add("remind me", { kind: "once", at: at(2026, 10, 21, 12) });
        await routines.add("flag fact", { kind: "weekly", time: "12:00", days: [3] });
        await routines.shutdown();

        const later = setup({ dir, now: at(2026, 10, 21, 15) });
        await later.routines.load();
        await later.routines.check();
        expect(later.runs).toEqual([{ id: once.id, late: true }]);
        expect(later.routines.list().map((r) => r.next)).toEqual([at(2026, 10, 28, 12)]);
    });

    test("a run that can't happen is recorded, and a one-off stays so the user sees it", async () => {
        const { routines, clock } = setup({ fail: "the agent isn't set up yet" });
        await routines.load();
        await routines.add("remind me", { kind: "once", at: at(2026, 10, 21, 12) });
        clock.now = at(2026, 10, 21, 12);
        await routines.check();
        expect(routines.list()).toMatchObject([{ what: "remind me", next: null, lastError: "the agent isn't set up yet" }]);
    });

    test("a file that can't be read is an error, left as it is, and nothing runs or changes", async () => {
        const { routines, file, states, runs } = setup();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "{not json");
        await routines.load();
        expect(states.at(-1)!.error).toMatch(/unreadable/);
        expect(() => routines.list()).toThrow(RoutineError);
        await expect(routines.add("x", { kind: "every", minutes: 60 })).rejects.toThrow(RoutineError);
        await routines.check();
        expect(runs).toEqual([]);
        expect(fs.readFileSync(file, "utf8")).toBe("{not json");
    });

    test("bounded: at most LIMITS.routines.count, and what they say is capped", async () => {
        const { routines } = setup();
        await routines.load();
        for (let i = 0; i < 50; i++) await routines.add(`r${i}`, { kind: "every", minutes: 60 });
        await expect(routines.add("one more", { kind: "every", minutes: 60 })).rejects.toThrow(/remove one first/);
        await routines.remove(routines.list()[0]!.id);
        await expect(routines.add("x".repeat(501), { kind: "every", minutes: 60 })).rejects.toThrow(/at most 500/);
    });

    test("the agent's tools add, list and remove; a refusal is a tool error it can read", async () => {
        const { routines } = setup();
        await routines.load();
        const set = routines.toolset();
        const added = await set.call("add_routine", { what: "text a flag fact", time: "09:00", days: ["mon", "fri"] });
        expect(added.text).toMatch(/^Added routine (\w+): Mon, Fri at 09:00, first at 2026-10-23 09:00\.$/);
        const id = /routine (\w+)/.exec(added.text)![1]!;
        expect((await set.call("list_routines", {})).text).toContain(`[${id}] Mon, Fri at 09:00`);
        expect(await set.call("add_routine", { what: "x", every_minutes: 1 })).toMatchObject({ isError: true });
        expect(await set.instructions!()).toContain("It's Wednesday 2026-10-21 10:00");
        expect((await set.call("remove_routine", { id })).text).toBe(`Removed routine ${id}.`);
        expect((await set.call("list_routines", {})).text).toBe("No routines.");
    });
});
