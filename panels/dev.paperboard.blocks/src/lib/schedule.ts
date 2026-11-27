// What a schedule hat says, and when it next runs. A time of day is on this
// computer's clock: "Every day at 02:30" runs at 03:30 the night the clocks
// skip 02:30, and once, at the first, the night 01:30 comes twice.
import { BUILTIN } from "./names";

/** The fewest seconds between two runs of "Every". */
export const MIN_INTERVAL_SECONDS = 5;
/** The most days between two runs of "Every". */
export const MAX_INTERVAL_DAYS = 365;

export type Schedule =
    | { kind: "every"; ms: number }
    /** `days` by Date#getDay: 0 is Sunday */
    | { kind: "at"; hour: number; minute: number; days: number[] };

export const SCHEDULE_HATS: readonly string[] = [BUILTIN.every, BUILTIN.everyDay, BUILTIN.onDays];

export const isScheduleHat = (type: string) => SCHEDULE_HATS.includes(type);

const UNIT_SECONDS: Record<string, number> = { SECONDS: 1, MINUTES: 60, HOURS: 3600 };

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
/** What "On" can say, as the days it means. */
export const DAY_CHOICES: Record<string, number[]> = {
    WEEKDAYS: [1, 2, 3, 4, 5],
    WEEKENDS: [0, 6],
    MON: [1],
    TUE: [2],
    WED: [3],
    THU: [4],
    FRI: [5],
    SAT: [6],
    SUN: [0],
};

/** "9:5" as "09:05", or null when it isn't a time of day. */
export function cleanTime(text: unknown): string | null {
    const match = typeof text === "string" ? /^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/.exec(text) : null;
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeOf(text: unknown): { hour: number; minute: number } {
    const clean = cleanTime(text);
    if (!clean) throw new Error(`"${String(text ?? "")}" isn't a time of day; write it as 04:00 or 23:30`);
    return { hour: Number(clean.slice(0, 2)), minute: Number(clean.slice(3)) };
}

/** What a schedule hat's fields say; throws why when they say nothing that can run. */
export function scheduleOf(hat: { type: string; fields?: Record<string, unknown> }): Schedule {
    const fields = hat.fields ?? {};
    switch (hat.type) {
        case BUILTIN.every: {
            const amount = Number(fields.EVERY);
            const unit = UNIT_SECONDS[String(fields.UNIT)];
            if (!unit) throw new Error(`Unknown unit ${String(fields.UNIT)}`);
            const seconds = amount * unit;
            if (!Number.isFinite(seconds) || seconds < MIN_INTERVAL_SECONDS) throw new Error(`A schedule runs at most every ${MIN_INTERVAL_SECONDS} seconds`);
            if (seconds > MAX_INTERVAL_DAYS * 86_400) throw new Error(`A schedule runs at least every ${MAX_INTERVAL_DAYS} days`);
            return { kind: "every", ms: Math.round(seconds * 1000) };
        }
        case BUILTIN.everyDay:
            return { kind: "at", ...timeOf(fields.TIME), days: EVERY_DAY };
        case BUILTIN.onDays: {
            const days = DAY_CHOICES[String(fields.DAYS)];
            if (!days) throw new Error(`Unknown days ${String(fields.DAYS)}`);
            return { kind: "at", ...timeOf(fields.TIME), days };
        }
    }
    throw new Error(`"${hat.type}" is not a schedule`);
}

/** The first time the schedule runs after `after` (epoch ms), strictly later. */
export function nextRun(schedule: Schedule, after: number): number {
    if (schedule.kind === "every") return after + schedule.ms;
    const from = new Date(after);
    // a week and a day reaches every day of the week, past a day the clocks change on
    for (let day = 0; day <= 8; day++) {
        const at = new Date(from.getFullYear(), from.getMonth(), from.getDate() + day, schedule.hour, schedule.minute);
        if (at.getTime() > after && schedule.days.includes(at.getDay())) return at.getTime();
    }
    throw new Error("The schedule names no day");
}
