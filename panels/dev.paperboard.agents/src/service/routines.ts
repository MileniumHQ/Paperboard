// Routines: what the agent does on a schedule ("text me a flag fact every
// weekday at 9", "check the forum every hour"). The agent sets them up with
// its tools; the user sees them and can cancel them. When one is due, the
// conversation gets a turn with a note saying so (see Conversation.notice):
// the agent decides what to text, and may text nothing if a check found
// nothing.
//
// One file, routines.json, owned here; the service is its only writer, so
// the routines live in memory and every change is written through, one write
// at a time. A file that can't be read is an error, never an empty list to
// overwrite, and no routine runs until it's fixed.
//
// Times are the computer's local time. A repeating routine whose time passed
// while the service was down is skipped, not run late; a one-off one runs late,
// once, and says so. One timer, for the soonest routine, re-armed after every
// change and at least hourly so a clock change can't strand it.

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { LIMITS, type Routine, type RoutineSchedule, type RoutinesState } from "../contract";
import { DAY_NAMES, describeSchedule, localStamp } from "../routineText";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { Toolset } from "./toolsets";

const L = LIMITS.routines;
const VERSION = 1;
const MAX_SLEEP_MS = 60 * 60_000;
/** a run this far past its time says it's late */
const LATE_MS = 5 * 60_000;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60_000;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)$/;

/** A refusal the agent and the user can read and act on. */
export class RoutineError extends Error {}

type Stored = Omit<Routine, "next">;

export interface RoutinesDeps {
    file: string;
    /** Start the agent on a routine now. Throws when it can't (not set up yet, say): that's the run's error. */
    run(routine: Routine, late: boolean): void;
    onChange(s: RoutinesState): void;
    now?: () => number;
}

export class Routines {
    private items: Stored[] = [];
    private next = new Map<string, number | null>();
    private broken: string | null = "the routines haven't been read yet";
    private revision = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private writes: Promise<unknown> = Promise.resolve();
    private closed = false;

    constructor(private deps: RoutinesDeps) {}

    private now() {
        return (this.deps.now ?? Date.now)();
    }

    /** Read the file and arm the timer. A file that can't be read leaves every routine off, and says why. */
    async load() {
        try {
            this.items = await this.read();
            this.broken = null;
        } catch (e) {
            this.broken = e instanceof Error ? e.message : String(e);
            console.error("[ai] routines are unreadable:", this.broken);
        }
        const now = this.now();
        for (const r of this.items) this.next.set(r.id, firstRun(r, now));
        this.changed();
        this.arm();
    }

    shutdown() {
        this.closed = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        return this.writes;
    }

    list(): Routine[] {
        this.usable();
        return this.items.map((r) => this.view(r)).sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity));
    }

    async add(what: unknown, schedule: RoutineSchedule): Promise<Routine> {
        this.usable();
        const text = parseWhat(what);
        if (this.items.length >= L.count) throw new RoutineError(`there are already ${L.count} routines; remove one first`);
        const now = this.now();
        if (schedule.kind === "once" && schedule.at <= now) throw new RoutineError(`${localStamp(schedule.at)} has already passed`);
        const r: Stored = { id: this.newId(), what: text, schedule, created: now, lastRun: null, lastError: null };
        this.items.push(r);
        this.next.set(r.id, firstRun(r, now));
        await this.save();
        this.arm();
        return this.view(r);
    }

    async remove(id: unknown): Promise<{ removed: true }> {
        this.usable();
        const i = this.items.findIndex((r) => r.id === id);
        if (i < 0) throw new RoutineError(`no routine ${String(id)}`);
        const [gone] = this.items.splice(i, 1);
        this.next.delete(gone!.id);
        await this.save();
        this.arm();
        return { removed: true };
    }

    /** Run what's due. The timer calls it; tests call it with their own clock. */
    async check(): Promise<void> {
        if (this.broken || this.closed) return;
        const now = this.now();
        const due = this.items.filter((r) => {
            const at = this.next.get(r.id);
            return at !== null && at !== undefined && at <= now;
        });
        if (!due.length) return this.arm();
        for (const r of due) {
            const at = this.next.get(r.id)!;
            try {
                this.deps.run(this.view(r), now - at > LATE_MS);
                r.lastRun = now;
                r.lastError = null;
            } catch (e) {
                r.lastError = e instanceof Error ? e.message : String(e);
                console.error(`[ai] routine ${r.id} couldn't run:`, r.lastError);
            }
            if (r.schedule.kind === "once" && r.lastError === null) {
                this.items.splice(this.items.indexOf(r), 1);
                this.next.delete(r.id);
            } else {
                // a one-off that couldn't run stays, with its error, until the user removes it
                this.next.set(r.id, r.schedule.kind === "once" ? null : nextRun(r, now));
            }
        }
        try {
            await this.save();
        } catch (e) {
            console.error("[ai] couldn't save the routines after a run:", e instanceof Error ? e.message : String(e));
        }
        this.arm();
    }

    // ------------------------------------------------------------- internals

    private usable() {
        if (this.broken) throw new RoutineError(this.broken);
    }

    private view(r: Stored): Routine {
        return { ...r, schedule: { ...r.schedule } as RoutineSchedule, next: this.next.get(r.id) ?? null };
    }

    private arm() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        if (this.closed || this.broken) return;
        let soonest = Infinity;
        for (const at of this.next.values()) if (at !== null && at < soonest) soonest = at;
        if (soonest === Infinity) return;
        const delay = Math.max(0, Math.min(soonest - this.now(), MAX_SLEEP_MS));
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.check();
        }, delay);
    }

    private changed() {
        this.revision++;
        this.deps.onChange({ revision: this.revision, error: this.broken });
    }

    private async read(): Promise<Stored[]> {
        let raw: string;
        try {
            raw = await fs.readFile(this.deps.file, "utf8");
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw new RoutineError(`the routines can't be read (${this.deps.file}): ${(e as Error).message}`);
        }
        const bad = (why: string) => new RoutineError(`the routines file is unreadable (${why}); it was left as it is: ${this.deps.file}`);
        let doc: any;
        try {
            doc = JSON.parse(raw);
        } catch (e) {
            throw bad((e as Error).message);
        }
        if (!doc || doc.version !== VERSION || !Array.isArray(doc.routines)) throw bad("not a routines file of this version");
        const ids = new Set<string>();
        return doc.routines.map((r: any): Stored => {
            if (typeof r?.id !== "string" || ids.has(r.id) || typeof r.what !== "string" || typeof r.created !== "number") throw bad("a routine is malformed");
            ids.add(r.id);
            const schedule = validSchedule(r.schedule);
            if (!schedule) throw bad(`routine ${r.id} has a schedule this version doesn't know`);
            return {
                id: r.id,
                what: r.what,
                schedule,
                created: r.created,
                lastRun: typeof r.lastRun === "number" ? r.lastRun : null,
                lastError: typeof r.lastError === "string" ? r.lastError : null,
            };
        });
    }

    /** Write the routines as they are now; writes run one at a time, in order. */
    private save(): Promise<void> {
        const data = JSON.stringify({ version: VERSION, routines: this.items }, null, 2);
        const write = async () => {
            await fs.mkdir(path.dirname(this.deps.file), { recursive: true });
            const tmp = `${this.deps.file}.${randomUUID().slice(0, 8)}.tmp`;
            try {
                await fs.writeFile(tmp, data);
                await fs.rename(tmp, this.deps.file);
            } catch (e) {
                await fs.rm(tmp, { force: true });
                throw e;
            }
        };
        const done = this.writes.then(write, write);
        this.writes = done.then(
            () => undefined,
            () => undefined,
        );
        return done.finally(() => this.changed());
    }

    private newId(): string {
        for (;;) {
            const id = randomUUID().replace(/-/g, "").slice(0, 6);
            if (!this.items.some((r) => r.id === id)) return id;
        }
    }

    // ------------------------------------------------------------- the agent's tools

    toolset(): Toolset {
        return {
            id: "routines",
            tools: () => ROUTINE_TOOLS,
            call: (name, args) => this.call(name, args),
            instructions: () => this.instructions(),
        };
    }

    private async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
        try {
            switch (name) {
                case "add_routine": {
                    const r = await this.add(args.what, parseSchedule(args, this.now()));
                    return { text: `Added routine ${r.id}: ${describeSchedule(r.schedule)}, first at ${localStamp(r.next!)}.` };
                }
                case "list_routines": {
                    const all = this.list();
                    return { text: all.length ? all.map(line).join("\n") : "No routines." };
                }
                case "remove_routine":
                    await this.remove(args.id);
                    return { text: `Removed routine ${String(args.id)}.` };
            }
        } catch (e) {
            if (e instanceof RoutineError) return { text: e.message, isError: true };
            throw e;
        }
        throw new RoutineError(`unknown routine tool ${name}`);
    }

    private instructions(): string {
        const now = this.now();
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const day = new Date(now).toLocaleDateString("en-US", { weekday: "long" });
        const head = `It's ${day} ${localStamp(now)} (${zone}) on the user's computer.`;
        if (this.broken) return `${head}\nYour routines are unavailable right now (${this.broken}).`;
        const all = this.list();
        const listed = all.length ? all.map(line).join("\n") : "(none)";
        return `${head}
Routines are things you do on a schedule: when one is due you get a turn that says so. \`add_routine\` when the user asks for something later or regularly ("text me at 9 every weekday", "check this every hour and tell me if it changes"); \`remove_routine\` when they want it stopped. Your routines:
${listed}`;
    }
}

const line = (r: Routine) =>
    `- [${r.id}] ${describeSchedule(r.schedule)}${r.next ? `, next ${localStamp(r.next)}` : ""}: ${r.what.length > 120 ? r.what.slice(0, 119) + "…" : r.what}` +
    (r.lastError ? ` (last run failed: ${r.lastError})` : "");

// ------------------------------------------------------------- schedules

/** When a routine first runs from `now`: a missed repeat is skipped; a missed one-off is due at once. */
function firstRun(r: Stored, now: number): number | null {
    if (r.schedule.kind === "once") return r.lastError === null ? r.schedule.at : null;
    return nextRun(r, now);
}

/** The first run strictly after `after`. */
export function nextRun(r: Pick<Stored, "schedule" | "created" | "lastRun">, after: number): number | null {
    const s = r.schedule;
    switch (s.kind) {
        case "once":
            return s.at > after ? s.at : null;
        case "weekly": {
            const [hh, mm] = s.time.split(":").map(Number) as [number, number];
            const d = new Date(after);
            for (let off = 0; off <= 7; off++) {
                const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + off, hh, mm, 0, 0);
                if (at.getTime() > after && s.days.includes(at.getDay())) return at.getTime();
            }
            return null;
        }
        case "every": {
            const step = s.minutes * 60_000;
            const base = r.lastRun ?? r.created;
            return base + Math.max(1, Math.floor((after - base) / step) + 1) * step;
        }
    }
}

function validSchedule(v: any): RoutineSchedule | null {
    if (v?.kind === "once" && Number.isFinite(v.at)) return { kind: "once", at: v.at };
    if (v?.kind === "weekly" && typeof v.time === "string" && TIME.test(v.time) && Array.isArray(v.days) && v.days.length > 0 && v.days.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) {
        return { kind: "weekly", time: v.time, days: [...new Set<number>(v.days)].sort() };
    }
    if (v?.kind === "every" && Number.isInteger(v.minutes) && v.minutes >= L.minEveryMinutes) return { kind: "every", minutes: v.minutes };
    return null;
}

function parseWhat(v: unknown): string {
    if (typeof v !== "string" || !v.trim()) throw new RoutineError("say what the routine does");
    const t = v.trim();
    if (t.length > L.whatChars) throw new RoutineError(`a routine is described in at most ${L.whatChars} characters`);
    return t;
}

/** The agent's arguments as a schedule: exactly one of at, time (with days), every_minutes. */
export function parseSchedule(a: Record<string, unknown>, now: number): RoutineSchedule {
    const given = ["at", "time", "every_minutes"].filter((k) => a[k] !== undefined && a[k] !== null);
    if (given.length !== 1) throw new RoutineError("give exactly one of at, time (with days) or every_minutes");
    if (given[0] === "at") {
        const m = typeof a.at === "string" ? STAMP.exec(a.at.trim()) : null;
        if (!m) throw new RoutineError("at is a local time like 2026-10-23 09:00");
        const [, y, mo, d, h, mi] = m.map(Number) as number[];
        const at = new Date(y!, mo! - 1, d!, h!, mi!).getTime();
        const back = new Date(at);
        if (back.getMonth() !== mo! - 1 || back.getDate() !== d!) throw new RoutineError(`${a.at} isn't a date`);
        if (at <= now) throw new RoutineError(`${a.at} has already passed`);
        if (at - now > MAX_AHEAD_MS) throw new RoutineError("a routine can be at most a year ahead");
        return { kind: "once", at };
    }
    if (given[0] === "time") {
        if (typeof a.time !== "string" || !TIME.test(a.time)) throw new RoutineError("time is HH:MM, 24-hour, like 09:00");
        let days = [0, 1, 2, 3, 4, 5, 6];
        if (a.days !== undefined && a.days !== null) {
            if (!Array.isArray(a.days) || a.days.length === 0) throw new RoutineError(`days is a list like ["mon", "wed"]`);
            days = a.days.map((d) => {
                const i = DAY_NAMES.indexOf(String(d).toLowerCase().slice(0, 3) as (typeof DAY_NAMES)[number]);
                if (i < 0) throw new RoutineError(`${String(d)} isn't a day; use ${DAY_NAMES.join(", ")}`);
                return i;
            });
        }
        return { kind: "weekly", time: a.time, days: [...new Set(days)].sort() };
    }
    const minutes = Number(a.every_minutes);
    if (!Number.isInteger(minutes) || minutes < L.minEveryMinutes) throw new RoutineError(`every_minutes is a whole number, at least ${L.minEveryMinutes}`);
    if (minutes > 7 * 24 * 60) throw new RoutineError("for longer than a week, use time and days");
    return { kind: "every", minutes };
}

export const ROUTINE_TOOLS: ToolSpec[] = [
    {
        name: "add_routine",
        description:
            "Do something on a schedule. Give `what` (what you'll do when it's due, written to yourself) and exactly one of: " +
            "`at` (once, local time `YYYY-MM-DD HH:MM`), `time` (`HH:MM` 24-hour, every day or on `days`), or `every_minutes` " +
            `(at least ${L.minEveryMinutes}). Times are the user's local time.`,
        inputSchema: {
            type: "object",
            properties: {
                what: { type: "string", maxLength: L.whatChars },
                at: { type: "string", description: "once: YYYY-MM-DD HH:MM" },
                time: { type: "string", description: "HH:MM" },
                days: { type: "array", items: { type: "string", enum: [...DAY_NAMES] }, description: "with time; every day if left out" },
                every_minutes: { type: "integer", minimum: L.minEveryMinutes },
            },
            required: ["what"],
        },
    },
    {
        name: "list_routines",
        description: "List your routines with their ids and next run.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "remove_routine",
        description: "Stop and remove a routine by its id.",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
];
