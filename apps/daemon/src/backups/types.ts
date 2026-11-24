// Shapes shared by the backup service and its stores. A backup is one
// gzipped tar of files from a panel's storage (and the JSON the panel handed
// over), plus a record describing it. Stores keep the record beside the
// archive; the record is read back as untrusted data and checked before
// anything is restored.
import { isPanelId } from "@mileniumhq/paperapi/panelIdentity";
import { BACKUP_LABEL_MAX } from "@mileniumhq/paperapi/protocol";
import { isBackupPath, isBackupTarget, type BackupRecord } from "@mileniumhq/paperapi/backups";

// the record and progress shapes are PaperAPI's: the daemon sends them as they are
export type { BackupContents, BackupCopied, BackupProgress, BackupProgressChange, BackupRecord, BackupStep, RestoreEnded } from "@mileniumhq/paperapi/backups";

/** a backup's paths: at most this many, so its record stays small */
export const MAX_BACKUP_PATHS = 64;

export interface BackupUsage {
    /** bytes Paperboard backups take at this location */
    used: number;
    /** bytes still free there; null when the location reports no limit */
    available: number | null;
}

/** called with the bytes handled so far */
export type BytesProgress = (done: number) => void;

/** the folder (or key, or tag) a store files a panel target's backups under */
export function targetFolder(target: string | null): string {
    // a target id starts with a letter or digit, so this is never one
    return target ?? "_panel";
}

export interface BackupStore {
    /** proves the location is reachable with its credentials */
    check(): Promise<void>;
    usage(): Promise<BackupUsage>;
    /** the target's backups, newest first, at most MAX_LISTED_BACKUPS */
    list(panelId: string, target: string | null): Promise<BackupRecord[]>;
    /** onProgress hears the archive bytes sent so far */
    put(record: BackupRecord, archivePath: string, onProgress?: BytesProgress): Promise<void>;
    /** writes the archive to destPath; onProgress hears the bytes received so far */
    get(record: BackupRecord, destPath: string, onProgress?: BytesProgress): Promise<void>;
    remove(record: BackupRecord): Promise<void>;
}

// Daemon policy, never supplied by remote metadata or a store.
export const BACKUP_ARCHIVE_MAX_BYTES = 5 * 1024 * 1024 * 1024;

// A transfer's whole lifetime: ten minutes plus the time its bytes take at
// 32 KiB/s, so a large archive over a slow home uplink finishes while a
// server that trickles a byte at a time is still cut off. Stalls are caught
// sooner by each request's idle timeout.
const TRANSFER_BASE_MS = 10 * 60_000;
const TRANSFER_MIN_BYTES_PER_SECOND = 32 * 1024;
export function backupTransferDeadlineMs(bytes: number): number {
    return TRANSFER_BASE_MS + Math.ceil((Math.max(0, bytes) / TRANSFER_MIN_BYTES_PER_SECOND) * 1000);
}

export function backupArchiveDownloadCap(size: number): number {
    if (!Number.isSafeInteger(size) || size < 0 || size > BACKUP_ARCHIVE_MAX_BYTES) {
        throw new Error(`Backup archive exceeds the ${BACKUP_ARCHIVE_MAX_BYTES} byte limit`);
    }
    return Math.min(size, BACKUP_ARCHIVE_MAX_BYTES);
}

export const MAX_LISTED_BACKUPS = 500;

export const BACKUP_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function newBackupId(now = new Date(), random = Math.floor(Math.random() * 0x1000000)): string {
    const iso = now.toISOString(); // 2026-10-14T12:34:56.789Z
    const stamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
    return `${stamp}-${random.toString(16).padStart(6, "0").slice(-6)}`;
}

/**
 * Why a backup's paths and excludes can't be swapped safely; null when they
 * can. A restore swaps each path whole and moves each exclude back, so: no
 * path repeats or holds another, and each exclude sits strictly under one
 * path and inside no other exclude. What a panel names and what a store's
 * record says are both checked by it.
 */
export function backupPathsProblem(paths: unknown, exclude: unknown): string | null {
    const list = (value: unknown, name: string): string | null => {
        if (!Array.isArray(value) || value.length > MAX_BACKUP_PATHS) return `${name} must list at most ${MAX_BACKUP_PATHS} paths`;
        const bad = value.find((entry) => !isBackupPath(entry));
        if (bad !== undefined) return `${JSON.stringify(bad)} in ${name} is not a path in the panel's storage`;
        if (new Set(value).size !== value.length) return `${name} lists a path twice`;
        return null;
    };
    const problem = list(paths, "paths") ?? list(exclude, "exclude");
    if (problem) return problem;
    const inside = (child: string, parent: string) => child !== parent && (parent === "" || child.startsWith(`${parent}/`));
    const named = paths as string[];
    const left = exclude as string[];
    for (const a of named) for (const b of named) if (inside(a, b)) return `${a} is inside ${b === "" ? "the whole storage" : b}, which it also names`;
    for (const e of left) if (e === "" || !named.some((p) => inside(e, p))) return `${JSON.stringify(e)} in exclude is not under one of its paths`;
    for (const a of left) for (const b of left) if (inside(a, b)) return `${a} in exclude is inside ${b}, which it also leaves out`;
    return null;
}

/** a record read back from a store; null when it is not one of ours */
export function parseBackupRecord(raw: unknown): BackupRecord | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (r.format !== 2) return null;
    if (typeof r.id !== "string" || !BACKUP_ID_RE.test(r.id)) return null;
    if (!isPanelId(r.panelId)) return null;
    if (r.target !== null && !isBackupTarget(r.target)) return null;
    if (typeof r.createdAt !== "string" || Number.isNaN(Date.parse(r.createdAt))) return null;
    if (typeof r.size !== "number" || !Number.isSafeInteger(r.size) || r.size < 0 || r.size > BACKUP_ARCHIVE_MAX_BYTES) return null;
    if (typeof r.sha256 !== "string" || !SHA256_RE.test(r.sha256)) return null;
    if (r.panelVersion !== null && (typeof r.panelVersion !== "string" || r.panelVersion.length > 64)) return null;
    if (r.label !== null && (typeof r.label !== "string" || r.label.length > BACKUP_LABEL_MAX)) return null;
    if (backupPathsProblem(r.paths, r.exclude) !== null) return null;
    return {
        format: 2,
        id: r.id,
        panelId: r.panelId,
        target: r.target,
        createdAt: r.createdAt,
        size: r.size,
        sha256: r.sha256,
        panelVersion: r.panelVersion as string | null,
        label: r.label as string | null,
        paths: [...(r.paths as string[])],
        exclude: [...(r.exclude as string[])],
    };
}

/** A location holds records this Paperboard could not read. The listing is
 * refused rather than shortened: a damaged record must not look like a
 * backup that was never made. */
export class BackupListingError extends Error {
    constructor(readonly unreadable: string[]) {
        const shown = unreadable.slice(0, 5).join(", ");
        super(
            `${unreadable.length} backup record${unreadable.length === 1 ? "" : "s"} at this location could not be read (${shown}${unreadable.length > 5 ? ", ..." : ""}), so its backups are not listed. Check the location, or remove the damaged records there`,
        );
        this.name = "BackupListingError";
    }
}

export function newestFirst(records: BackupRecord[]): BackupRecord[] {
    return records.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, MAX_LISTED_BACKUPS);
}
