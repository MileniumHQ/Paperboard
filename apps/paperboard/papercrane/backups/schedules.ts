// Routine backups: per panel, a backup every so many hours, keeping the
// newest few. The daemon runs them, so they happen with Paperboard closed.
// The schedules have their own file (backups/schedules.json) and one
// owner, BackupService; this module holds the rules and the file format.
import * as fs from "fs";
import { writeFileAtomic } from "../storage";
import { invalidParams } from "../rpc/errors";
import { isPanelId } from "../../../../packages/paperapi/src/panelIdentity";

export const SCHEDULE_FILE_VERSION = 1;
export const MAX_SCHEDULES = 64;
export const SCHEDULE_HOURS = [1, 3, 6, 12, 24, 48, 168] as const;
export const MAX_KEEP = 100;
/** what a routine backup is labelled; only these are pruned */
export const SCHEDULED_LABEL = "Routine backup";
/** a routine backup that found the panel busy tries again this soon */
export const BUSY_RETRY_MS = 15 * 60 * 1000;
/** the timer wakes at least this often, so a changed clock is noticed */
export const MAX_SLEEP_MS = 60 * 60 * 1000;

export interface ScheduleResult {
    /** ISO time it finished */
    at: string;
    ok: boolean;
    /** what went wrong, or what was pruned */
    message: string | null;
}

export interface BackupSchedule {
    everyHours: number;
    keep: number;
    /** ISO time the next routine backup is due */
    nextRunAt: string;
    last: ScheduleResult | null;
}

export interface ScheduleFile {
    version: typeof SCHEDULE_FILE_VERSION;
    panels: Record<string, BackupSchedule>;
}

const iso = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

function validSchedule(value: any): value is BackupSchedule {
    return value && typeof value === "object"
        && (SCHEDULE_HOURS as readonly number[]).includes(value.everyHours)
        && Number.isInteger(value.keep) && value.keep >= 1 && value.keep <= MAX_KEEP
        && iso(value.nextRunAt)
        && (value.last === null || (value.last && iso(value.last.at) && typeof value.last.ok === "boolean"
            && (value.last.message === null || typeof value.last.message === "string")));
}

/** Missing is no schedules. Unreadable or unknown is an error, never empty:
 * writing over it would drop every panel's schedule. */
export function readSchedules(file: string): ScheduleFile {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (err: any) {
        if (err?.code === "ENOENT") return { version: SCHEDULE_FILE_VERSION, panels: {} };
        throw err;
    }
    let data: any;
    try {
        data = JSON.parse(text);
    } catch (err) {
        throw new Error(`The routine backup schedules (${file}) are not readable JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (data?.version !== SCHEDULE_FILE_VERSION || !data.panels || typeof data.panels !== "object") {
        throw new Error(`The routine backup schedules (${file}) are in a format this Paperboard does not know`);
    }
    for (const [panelId, schedule] of Object.entries(data.panels)) {
        if (!isPanelId(panelId) || !validSchedule(schedule)) {
            throw new Error(`The routine backup schedule for ${JSON.stringify(panelId)} in ${file} is damaged`);
        }
    }
    return data as ScheduleFile;
}

export function writeSchedules(file: string, schedules: ScheduleFile): Promise<void> {
    return writeFileAtomic(file, `${JSON.stringify(schedules, null, 2)}\n`);
}

/** a schedule a caller asked for, checked */
export function scheduleInput(input: any): { everyHours: number; keep: number } {
    if (!input || typeof input !== "object") throw invalidParams("schedule must be an object or null");
    if (!(SCHEDULE_HOURS as readonly number[]).includes(input.everyHours)) {
        throw invalidParams(`everyHours must be one of ${SCHEDULE_HOURS.join(", ")}`);
    }
    if (!Number.isInteger(input.keep) || input.keep < 1 || input.keep > MAX_KEEP) {
        throw invalidParams(`keep must be a whole number from 1 to ${MAX_KEEP}`);
    }
    return { everyHours: input.everyHours, keep: input.keep };
}

export const hours = (n: number) => n * 60 * 60 * 1000;

/** panels whose routine backup is due at `now`, soonest first */
export function duePanels(schedules: ScheduleFile, now: number): string[] {
    return Object.entries(schedules.panels)
        .filter(([, s]) => Date.parse(s.nextRunAt) <= now)
        .sort(([, a], [, b]) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))
        .map(([panelId]) => panelId);
}

/** how long the timer sleeps before it looks again */
export function sleepFor(schedules: ScheduleFile, now: number): number {
    const next = Math.min(...Object.values(schedules.panels).map((s) => Date.parse(s.nextRunAt)));
    if (!Number.isFinite(next)) return MAX_SLEEP_MS;
    return Math.max(1000, Math.min(MAX_SLEEP_MS, next - now));
}

/** routine backups beyond the newest `keep`; other backups are never pruned */
export function backupsToPrune<T extends { id: string; label: string | null; createdAt: string }>(records: readonly T[], keep: number): T[] {
    return records
        .filter((r) => r.label === SCHEDULED_LABEL)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
        .slice(keep);
}
