// How a routine's schedule reads, to the agent and to the user. Pure: the
// service and the UI both use it.

import type { RoutineSchedule } from "./contract";

export const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A local time as YYYY-MM-DD HH:MM. */
export function localStamp(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function describeSchedule(s: RoutineSchedule): string {
    switch (s.kind) {
        case "once":
            return `once, at ${localStamp(s.at)}`;
        case "weekly": {
            const days = [...s.days].sort((a, b) => a - b);
            const which =
                days.length === 7
                    ? "every day"
                    : days.join() === "1,2,3,4,5"
                      ? "weekdays"
                      : days.join() === "0,6"
                        ? "weekends"
                        : days.map((d) => DAY_LABELS[d]).join(", ");
            return `${which} at ${s.time}`;
        }
        case "every":
            return s.minutes % 60 === 0 ? `every ${s.minutes / 60 === 1 ? "hour" : `${s.minutes / 60} hours`}` : `every ${s.minutes} minutes`;
    }
}
