// Schedules: when a schedule hat runs, on this computer's clock (New York
// here, so the clocks change twice a year), and how the service keeps them
// through a restart, a sleep, a missed run, and a project switched off or
// deleted. Time is a clock the test turns; the files are in memory.
process.env.TZ = "America/New_York";

import { describe, expect, test } from "bun:test";
import { BUILTIN } from "../src/lib/names";
import { cleanTime, nextRun, scheduleOf } from "../src/lib/schedule";
import { CATCH_UP_DELAY_MS, SCHEDULES_FILE } from "../src/lib/scheduler";
import { WAIT, flows, say, setup, type Draft } from "./helpers/runtime";
import { testClock } from "./helpers/clock";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const everyDay = (time: string, then: Draft): Draft => ({ type: BUILTIN.everyDay, fields: { TIME: time }, inputs: { DO: { block: then } } });
const onDays = (days: string, time: string, then: Draft): Draft => ({ type: BUILTIN.onDays, fields: { DAYS: days, TIME: time }, inputs: { DO: { block: then } } });
const every = (amount: number, unit: string, then: Draft): Draft => ({ type: BUILTIN.every, fields: { EVERY: amount, UNIT: unit }, inputs: { DO: { block: then } } });

/** A local time in New York, as a person reads it. */
const local = (iso: string) => new Date(iso);
const at = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${d.getTimezoneOffset() === 240 ? "EDT" : "EST"}`;
};

/** A service over these files, started on this clock, with one project of these flows. */
async function serviceAt(start: string, files = new Map<string, unknown>()) {
    const time = testClock(local(start));
    const s = setup({ files, clock: time.clock });
    await s.ready;
    return { ...s, time };
}

const runs = (s: { said: (p: string) => string[] }, project: string, what = "ran") => s.said(project).filter((line) => line === `info: ${what}`).length;
const nextOf = (s: { state: () => { nextRuns: Record<string, Record<string, number>> } }, project: string) => Object.values(s.state().nextRuns[project] ?? {});

describe("when a schedule runs", () => {
    test("a time of day is written as hours and minutes, and anything else is refused", () => {
        expect(cleanTime("9:5")).toBe("09:05");
        expect(cleanTime(" 23 : 59 ")).toBe("23:59");
        expect(cleanTime("24:00")).toBeNull();
        expect(cleanTime("4pm")).toBeNull();
        expect(() => scheduleOf({ type: BUILTIN.everyDay, fields: { TIME: "25:00" } })).toThrow('"25:00" isn\'t a time of day');
        expect(() => scheduleOf({ type: BUILTIN.every, fields: { EVERY: 2, UNIT: "SECONDS" } })).toThrow("at most every 5 seconds");
        expect(scheduleOf({ type: BUILTIN.every, fields: { EVERY: 90, UNIT: "MINUTES" } })).toEqual({ kind: "every", ms: 90 * MINUTE });
    });

    test("on weekdays skips the weekend, and weekends skip the week", () => {
        // Friday 2026-06-12, after 08:00
        const friday = local("2026-06-12T09:00:00").getTime();
        expect(at(nextRun(scheduleOf({ type: BUILTIN.onDays, fields: { DAYS: "WEEKDAYS", TIME: "08:00" } }), friday))).toBe("2026-06-15 08:00 EDT");
        expect(at(nextRun(scheduleOf({ type: BUILTIN.onDays, fields: { DAYS: "WEEKENDS", TIME: "08:00" } }), friday))).toBe("2026-06-13 08:00 EDT");
        expect(at(nextRun(scheduleOf({ type: BUILTIN.onDays, fields: { DAYS: "FRI", TIME: "08:00" } }), friday))).toBe("2026-06-19 08:00 EDT");
    });

    test("the night the clocks go forward, a time they skip runs an hour on, and the next day at its time", () => {
        const daily = scheduleOf({ type: BUILTIN.everyDay, fields: { TIME: "02:30" } });
        const first = nextRun(daily, local("2026-03-07T12:00:00").getTime());
        expect(at(first)).toBe("2026-03-08 03:30 EDT");
        expect(at(nextRun(daily, first))).toBe("2026-03-09 02:30 EDT");
    });

    test("the night the clocks go back, a time that comes twice runs once", () => {
        const daily = scheduleOf({ type: BUILTIN.everyDay, fields: { TIME: "01:30" } });
        const first = nextRun(daily, local("2026-10-31T12:00:00").getTime());
        expect(at(first)).toBe("2026-11-01 01:30 EDT");
        // the second 01:30 that night is an hour later, and isn't a run
        expect(at(nextRun(daily, first))).toBe("2026-11-02 01:30 EST");
        expect(nextRun(daily, first) - first).toBe(DAY + HOUR);
    });

    test("every hour stays an hour apart while the clocks change", () => {
        const hourly = scheduleOf({ type: BUILTIN.every, fields: { EVERY: 1, UNIT: "HOURS" } });
        const before = local("2026-11-01T00:45:00").getTime();
        expect(nextRun(hourly, before) - before).toBe(HOUR);
        expect(nextRun(hourly, nextRun(hourly, before)) - before).toBe(2 * HOUR);
    });
});

describe("the service's schedules", () => {
    test("a daily schedule runs at its time, says when it runs next, and a restart before then doesn't run it again", async () => {
        const s = await serviceAt("2026-06-10T03:50:00");
        const id = await s.make("Nightly", flows(everyDay("04:00", say("ran"))));
        expect(nextOf(s, id).map(at)).toEqual(["2026-06-10 04:00 EDT"]);
        await s.time.to(local("2026-06-10T04:00:30"));
        expect(runs(s, id)).toBe(1);
        expect(nextOf(s, id).map(at)).toEqual(["2026-06-11 04:00 EDT"]);

        // the service restarts at 04:05 over the same files
        const after = await serviceAt("2026-06-10T04:05:00", s.files);
        await after.time.to(local("2026-06-10T12:00:00"));
        expect(runs(after, id)).toBe(0);
        expect(nextOf(after, id).map(at)).toEqual(["2026-06-11 04:00 EDT"]);
        await after.time.to(local("2026-06-11T04:01:00"));
        expect(runs(after, id)).toBe(1);
    });

    test("a run missed while the service was away runs once, a minute after it starts, and then on time", async () => {
        const s = await serviceAt("2026-06-10T03:50:00");
        const id = await s.make("Nightly", flows(everyDay("04:00", say("ran"))));
        // away from before 04:00 on the 10th until 09:00 on the 13th: three runs missed
        const back = await serviceAt("2026-06-13T09:00:00", s.files);
        await back.time.advance(CATCH_UP_DELAY_MS - 1000);
        expect(runs(back, id)).toBe(0);
        await back.time.advance(2000);
        expect(runs(back, id)).toBe(1);
        expect(nextOf(back, id).map(at)).toEqual(["2026-06-14 04:00 EDT"]);
        await back.time.to(local("2026-06-14T04:00:30"));
        expect(runs(back, id)).toBe(2);
    });

    test("after the computer sleeps through many runs, it runs once when it wakes, then counts from then", async () => {
        const s = await serviceAt("2026-06-10T12:00:00");
        const id = await s.make("Poll", flows(every(10, "MINUTES", say("ran"))));
        await s.time.advance(10 * MINUTE + 1000);
        expect(runs(s, id)).toBe(1);
        s.time.sleep(5 * HOUR);
        await s.time.advance(0);
        expect(runs(s, id)).toBe(2);
        const woke = s.time.now();
        expect(nextOf(s, id)).toEqual([woke + 10 * MINUTE]);
        await s.time.advance(10 * MINUTE);
        expect(runs(s, id)).toBe(3);
    });

    test("the night the clocks go back, a daily schedule runs once", async () => {
        const s = await serviceAt("2026-10-31T23:00:00");
        const id = await s.make("Late", flows(everyDay("01:30", say("ran"))));
        // 01:31 EDT, then the clocks go back and 01:31 comes again, in EST
        await s.time.to(local("2026-11-01T01:31:00-04:00"));
        expect(runs(s, id)).toBe(1);
        await s.time.to(local("2026-11-01T01:31:00-05:00"));
        expect(runs(s, id)).toBe(1);
        await s.time.to(local("2026-11-02T01:31:00"));
        expect(runs(s, id)).toBe(2);
    });

    test("a project switched off stops its schedules, and switched on again starts them from then, without the runs it missed", async () => {
        const s = await serviceAt("2026-06-10T03:50:00");
        const id = await s.make("Nightly", flows(everyDay("04:00", say("ran"))));
        await s.call.updateProject({ project: id, enabled: false });
        expect(s.state().nextRuns[id]).toBeUndefined();
        expect(s.time.pending()).toBe(0);
        await s.time.to(local("2026-06-12T12:00:00"));
        expect(runs(s, id)).toBe(0);
        await s.call.updateProject({ project: id, enabled: true });
        expect(nextOf(s, id).map(at)).toEqual(["2026-06-13 04:00 EDT"]);
        await s.time.advance(2 * HOUR);
        expect(runs(s, id)).toBe(0);
    });

    test("a deleted project's schedules stop, and the file lets go of them", async () => {
        const s = await serviceAt("2026-06-10T03:50:00");
        const id = await s.make("Nightly", flows(everyDay("04:00", say("ran"))));
        expect(Object.keys((s.files.get(SCHEDULES_FILE) as { schedules: object }).schedules)).toEqual([id]);
        await s.call.deleteProject({ project: id });
        await s.time.advance(0);
        expect(s.time.pending()).toBe(0);
        expect((s.files.get(SCHEDULES_FILE) as { schedules: object }).schedules).toEqual({});
        await s.time.to(local("2026-06-11T12:00:00"));
        expect(runs(s, id)).toBe(0);
    });

    test("a run still going when the next is due skips that one, and says so", async () => {
        const s = await serviceAt("2026-06-10T12:00:00");
        const id = await s.make("Slow", flows(every(5, "MINUTES", { ...say("started"), next: { block: { type: WAIT } } })));
        await s.time.advance(CATCH_UP_DELAY_MS);
        await s.time.advance(5 * MINUTE);
        expect(runs(s, id, "started")).toBe(1);
        await s.time.advance(5 * MINUTE);
        expect(runs(s, id, "started")).toBe(1);
        expect(s.said(id)).toContain("info: A scheduled run was skipped: the last one is still going");
        expect(s.state().running[id]).toBe(1);
    });

    test("an edited schedule starts again from the edit, and one that can't run says why on its block", async () => {
        const s = await serviceAt("2026-06-10T03:50:00");
        const id = await s.make("Nightly", flows(everyDay("04:00", say("ran"))));
        await s.call.saveFlows({ project: id, flows: flows(everyDay("05:00", say("ran"))), preview: null });
        expect(nextOf(s, id).map(at)).toEqual(["2026-06-10 05:00 EDT"]);
        await s.call.saveFlows({ project: id, flows: flows(everyDay("5 o'clock", say("ran"))), preview: null });
        expect(s.state().nextRuns[id]).toBeUndefined();
        expect(s.state().log.at(-1)).toMatchObject({ level: "error", blockId: "hat0", message: "This schedule doesn't run: \"5 o'clock\" isn't a time of day; write it as 04:00 or 23:30." });
        // the same mistake isn't said again by an edit elsewhere
        const lines = s.state().log.length;
        await s.call.saveFlows({ project: id, flows: flows(everyDay("5 o'clock", say("ran")), say("x")), preview: null });
        expect(s.state().log.length).toBe(lines);
    });

    test("a schedules file that can't be read is said, and the schedules start again from now", async () => {
        const files = new Map<string, unknown>();
        const s = await serviceAt("2026-06-10T03:50:00", files);
        const id = await s.make("Nightly", flows(everyDay("04:00", say("ran"))));
        files.set(SCHEDULES_FILE, { schedules: "damaged" });
        const after = await serviceAt("2026-06-12T09:00:00", files);
        expect(after.said(id)).toEqual(["error: When the schedules last ran couldn't be read (the file is damaged), so they start again from now."]);
        await after.time.advance(2 * HOUR);
        expect(runs(after, id)).toBe(0);
        expect(nextOf(after, id).map(at)).toEqual(["2026-06-13 04:00 EDT"]);
    });
});

describe("schedules and backups", () => {
    test("a restore keeps when the schedules last ran here, so it doesn't run them again", async () => {
        const s = await serviceAt("2026-06-10T03:50:00");
        const id = await s.make("Nightly", flows(onDays("WEEKDAYS", "04:00", say("ran"))));
        const backup = structuredClone(Object.fromEntries(s.files));
        await s.time.to(local("2026-06-10T04:01:00"));
        expect(runs(s, id)).toBe(1);
        await s.runtime.backup.beforeRestore(null);
        for (const [path, value] of Object.entries(backup)) s.files.set(path, value);
        await s.runtime.backup.restored();
        await s.time.advance(HOUR);
        expect(runs(s, id)).toBe(1);
        expect(nextOf(s, id).map(at)).toEqual(["2026-06-11 04:00 EDT"]);
        // the file says so too: a restart after the restore doesn't run it again
        const after = await serviceAt("2026-06-10T09:00:00", s.files);
        await after.time.advance(2 * HOUR);
        expect(runs(after, id)).toBe(0);
    });
});
