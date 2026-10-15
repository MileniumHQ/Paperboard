// Shapes shared by the backup service and its stores. A backup is one
// gzipped tar of a panel's file storage and config document, plus a record
// describing it. Stores keep the record beside the archive; the record is
// read back as untrusted data and checked before anything is restored.
import { isPanelId } from "../../../../packages/paperapi/src/panelIdentity";

export interface BackupRecord {
    format: 1;
    id: string;
    panelId: string;
    /** ISO timestamp */
    createdAt: string;
    /** archive bytes */
    size: number;
    /** archive sha256, hex */
    sha256: string;
    panelVersion: string | null;
    label: string | null;
}

export interface BackupUsage {
    /** bytes Paperboard backups take at this location */
    used: number;
    /** bytes still free there; null when the location reports no limit */
    available: number | null;
}

export interface BackupStore {
    /** proves the location is reachable with its credentials */
    check(): Promise<void>;
    usage(): Promise<BackupUsage>;
    /** newest first, at most MAX_LISTED_BACKUPS */
    list(panelId: string): Promise<BackupRecord[]>;
    put(record: BackupRecord, archivePath: string): Promise<void>;
    /** writes the archive to destPath */
    get(record: BackupRecord, destPath: string): Promise<void>;
    remove(record: BackupRecord): Promise<void>;
}

// Daemon policy, never supplied by remote metadata or a store.
export const BACKUP_ARCHIVE_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const BACKUP_TRANSFER_TIMEOUT_MS = 10 * 60_000;

export function backupArchiveDownloadCap(size: number): number {
    if (!Number.isSafeInteger(size) || size < 0 || size > BACKUP_ARCHIVE_MAX_BYTES) {
        throw new Error(`Backup archive exceeds the ${BACKUP_ARCHIVE_MAX_BYTES} byte limit`);
    }
    return Math.min(size, BACKUP_ARCHIVE_MAX_BYTES);
}

export const MAX_LISTED_BACKUPS = 500;
export const BACKUP_LABEL_MAX = 100;
export const BACKUP_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function newBackupId(now = new Date(), random = Math.floor(Math.random() * 0x1000000)): string {
    const iso = now.toISOString(); // 2026-10-14T12:34:56.789Z
    const stamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
    return `${stamp}-${random.toString(16).padStart(6, "0").slice(-6)}`;
}

/** a record read back from a store; null when it is not one of ours */
export function parseBackupRecord(raw: unknown): BackupRecord | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (r.format !== 1) return null;
    if (typeof r.id !== "string" || !BACKUP_ID_RE.test(r.id)) return null;
    if (!isPanelId(r.panelId)) return null;
    if (typeof r.createdAt !== "string" || Number.isNaN(Date.parse(r.createdAt))) return null;
    if (typeof r.size !== "number" || !Number.isSafeInteger(r.size) || r.size < 0 || r.size > BACKUP_ARCHIVE_MAX_BYTES) return null;
    if (typeof r.sha256 !== "string" || !SHA256_RE.test(r.sha256)) return null;
    if (r.panelVersion !== null && (typeof r.panelVersion !== "string" || r.panelVersion.length > 64)) return null;
    if (r.label !== null && (typeof r.label !== "string" || r.label.length > BACKUP_LABEL_MAX)) return null;
    return {
        format: 1,
        id: r.id,
        panelId: r.panelId,
        createdAt: r.createdAt,
        size: r.size,
        sha256: r.sha256,
        panelVersion: r.panelVersion as string | null,
        label: r.label as string | null,
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
