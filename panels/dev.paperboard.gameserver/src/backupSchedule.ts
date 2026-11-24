// Routine backups: a backup of a server every so many hours, keeping the
// newest few. Each server keeps its schedule in its own saved entry, beside
// its settings rather than in them, so restoring a backup never changes it.
// The panel's service runs them (service/backups.ts); the Backups tab and
// the service share these rules.

/** how often routine backups may run, in hours */
export const ROUTINE_BACKUP_HOURS = [1, 3, 6, 12, 24, 48, 168] as const;
export type RoutineBackupHours = (typeof ROUTINE_BACKUP_HOURS)[number];
/** the most routine backups a schedule keeps */
export const MAX_ROUTINE_BACKUPS_KEPT = 100;
/** the label routine backups carry, which tells them apart: a backup someone makes can't use it */
export const ROUTINE_BACKUP_LABEL = "Routine backup";

export interface RoutineBackupResult {
    /** ISO time the last routine backup ended */
    at: string;
    ok: boolean;
    /** why it failed; null when it worked */
    message: string | null;
}

export interface BackupSchedule {
    everyHours: RoutineBackupHours;
    /** routine backups beyond the newest this many are deleted; other backups never are */
    keep: number;
    /** ISO time the next one is due */
    nextRunAt: string;
    last: RoutineBackupResult | null;
}

/** what someone chooses: how often, and how many to keep */
export type BackupScheduleChoice = Pick<BackupSchedule, "everyHours" | "keep">;

export const isRoutineHours = (value: unknown): value is RoutineBackupHours => (ROUTINE_BACKUP_HOURS as readonly unknown[]).includes(value);
const isTime = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

/** a chosen schedule, checked; throws saying what is wrong */
export function readScheduleChoice(value: unknown): BackupScheduleChoice {
    const raw = value as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A backup schedule is an object");
    if (!isRoutineHours(raw.everyHours)) throw new Error(`Routine backups run every ${ROUTINE_BACKUP_HOURS.join(", ")} hours`);
    if (!Number.isInteger(raw.keep) || (raw.keep as number) < 1 || (raw.keep as number) > MAX_ROUTINE_BACKUPS_KEPT)
        throw new Error(`Keep from 1 to ${MAX_ROUTINE_BACKUPS_KEPT} routine backups`);
    return { everyHours: raw.everyHours, keep: raw.keep as number };
}

/** a saved schedule, checked; throws when it is damaged */
export function readBackupSchedule(value: unknown): BackupSchedule {
    const choice = readScheduleChoice(value);
    const raw = value as Record<string, unknown>;
    const last = raw.last as Record<string, unknown> | null;
    if (!isTime(raw.nextRunAt)) throw new Error("The routine backup schedule's next time is damaged");
    if (last !== null && (!last || typeof last !== "object" || !isTime(last.at) || typeof last.ok !== "boolean" || (last.message !== null && typeof last.message !== "string")))
        throw new Error("The routine backup schedule's last result is damaged");
    return { ...choice, nextRunAt: raw.nextRunAt as string, last: last && { at: last.at as string, ok: last.ok as boolean, message: last.message as string | null } };
}

/** whether a label is the one kept for routine backups */
export const isRoutineLabel = (label: string | null | undefined) => label?.trim().toLowerCase() === ROUTINE_BACKUP_LABEL.toLowerCase();

/** the routine backups beyond the newest `keep`; a backup someone made is never among them */
export function routineBackupsToPrune<T extends { id: string; label: string | null; createdAt: string }>(records: readonly T[], keep: number): T[] {
    return records
        .filter((record) => record.label === ROUTINE_BACKUP_LABEL)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
        .slice(keep);
}
