// Panel backups. A backup copies the panel's file storage and config
// document (never its vault secrets) to the backup location the user chose
// for the panel: this computer, an S3-compatible bucket, or Google Drive.
// The user chooses the location in a window Paperboard shows; a panel can
// open it with chooseLocation, never set it itself.
import { getTransport, invokeIn } from "./ipc";
import { BACKUP_PROGRESS_EVENT } from "./channels";
import { requirePanelId } from "./panelIdentity";
import { requestShell } from "./shellRequest";
import { currentFrameSession } from "./frameSession";

export interface BackupRecord {
    format: 1;
    /** sorts by creation time */
    id: string;
    panelId: string;
    /** Present for backups made from a named source. */
    sourceId?: string;
    /** ISO timestamp */
    createdAt: string;
    /** archive bytes */
    size: number;
    /** archive sha256, hex */
    sha256: string;
    /** the panel version that made the backup */
    panelVersion: string | null;
    label: string | null;
}

export interface BackupLocation {
    id: string;
    kind: "local" | "s3" | "gdrive";
    label: string;
    /** where it is, for people: a folder, a bucket, an account */
    detail: string;
    /** false for "This computer", which is built in */
    removable: boolean;
}

/** how often routine backups may run, in hours */
export const ROUTINE_BACKUP_HOURS = [1, 3, 6, 12, 24, 48, 168] as const;
/** the most routine backups a schedule keeps */
export const MAX_ROUTINE_BACKUPS_KEPT = 100;
/** the label routine backups carry; a backup someone makes cannot use it */
export const ROUTINE_BACKUP_LABEL = "Routine backup";

export interface BackupScheduleResult {
    /** ISO time the last routine backup finished */
    at: string;
    ok: boolean;
    /** why it failed; null when it worked */
    message: string | null;
}

/** Routine backups the computer's Paperboard Server makes, app open or not */
export interface BackupSchedule {
    everyHours: (typeof ROUTINE_BACKUP_HOURS)[number];
    /** routine backups beyond the newest this many are deleted; other
     * backups are never deleted by a schedule */
    keep: number;
    /** ISO time the next one is due */
    nextRunAt: string;
    last: BackupScheduleResult | null;
}

/**
 * What a running backup or restore is doing:
 * - `preparing`: the panel's service gets ready (a game server saves its world)
 * - `copying`: the files are copied aside
 * - `packing`: the copy is compressed into one archive
 * - `saving`: the archive goes to the backup location
 * - `downloading`, `checking`, `unpacking`: a restore fetches, verifies and opens the archive
 * - `restoring`: the panel's data is swapped for the backup's
 */
export type BackupStep = "preparing" | "copying" | "packing" | "saving" | "downloading" | "checking" | "unpacking" | "restoring";

export interface BackupProgress {
    /** the panel whose data is backed up */
    panelId: string;
    /** the named source being backed up; null for the panel's own backups */
    sourceId: string | null;
    kind: "create" | "restore";
    step: BackupStep;
    /** bytes done and expected in this step; null when the step cannot be measured */
    done: number | null;
    total: number | null;
    /** true while the step holds the panel's service stopped */
    servicePaused: boolean;
}

/** a change in a panel's running backup; progress is null once it ends */
export interface BackupProgressChange {
    panelId: string;
    sourceId: string | null;
    progress: BackupProgress | null;
}

/** the share of the step done, from 0 to 1; null when it cannot be measured */
export function backupProgressFraction(progress: Pick<BackupProgress, "done" | "total">): number | null {
    if (progress.done === null || progress.total === null) return null;
    if (progress.total <= 0) return 1;
    return Math.min(1, Math.max(0, progress.done / progress.total));
}

const STEP_LABELS: Record<BackupStep, string> = {
    preparing: "Getting ready",
    copying: "Copying files",
    packing: "Compressing",
    saving: "Saving",
    downloading: "Downloading",
    checking: "Checking",
    unpacking: "Unpacking",
    restoring: "Restoring files",
};

/** what a step is called, for people: "Compressing" */
export function backupStepLabel(step: BackupStep): string {
    return STEP_LABELS[step];
}

/** the step and how far along it is, for people: "Compressing 42%" */
export function backupProgressText(progress: Pick<BackupProgress, "step" | "done" | "total">): string {
    const fraction = backupProgressFraction(progress);
    return fraction === null ? `${STEP_LABELS[progress.step]}…` : `${STEP_LABELS[progress.step]} ${Math.floor(fraction * 100)}%`;
}

// one listener per panel (and source) on the computer's backup event
function listenProgress(scope: string | undefined, panelId: string, sourceId: string | null | undefined, listener: (change: BackupProgressChange) => void): () => void {
    const transport = getTransport(scope);
    const off = transport.subscribeSource(BACKUP_PROGRESS_EVENT, (payload: any) => {
        if (payload?.panelId !== panelId) return;
        if (sourceId !== undefined && (payload.sourceId ?? null) !== sourceId) return;
        listener({ panelId: payload.panelId, sourceId: payload.sourceId ?? null, progress: payload.progress ?? null });
    });
    // the event flows only to a connected socket that declared it
    transport.ensureConnected().catch((err) => console.error("[paperapi] backup progress could not connect:", err));
    return off;
}

export interface BackupStatus {
    /** null until the user chooses where this panel's backups go */
    location: BackupLocation | null;
    /** a backup being made or restored for this panel right now */
    running: "create" | "restore" | null;
    /** how far along that backup is; null when none is running */
    progress: BackupProgress | null;
    /** null when the panel has no routine backups */
    schedule: BackupSchedule | null;
}

export interface BackupLocationUsage {
    /** bytes Paperboard backups take at the location */
    used: number;
    /** bytes still free there; null when the location reports no limit */
    available: number | null;
}

export type ChooseBackupLocationResult = { status: "chosen"; location: BackupLocation } | { status: "canceled" };

export class BackupLocationError extends Error {
    constructor(
        readonly code: "busy" | "unavailable" | "failed",
        message: string,
    ) {
        super(message);
        this.name = "BackupLocationError";
    }
}

// The computer's own folder is named after the computer. The daemon knows
// only the machine's hostname; the shell tells a panel page the name it
// shows for the computer, which is the one people know it by.
export function backupLocationLabel(location: Pick<BackupLocation, "kind" | "label">, computerName: string | null | undefined): string {
    return location.kind === "local" && computerName ? computerName : location.label;
}

function named(location: BackupLocation | null): BackupLocation | null {
    return location && { ...location, label: backupLocationLabel(location, currentFrameSession()?.computerName) };
}

const status = (r: any): BackupStatus => ({ location: named(r?.destination ?? null), running: r?.running ?? null, progress: r?.progress ?? null, schedule: r?.schedule ?? null });

/** A named subset of a panel's files and config, with its own backup history. */
export interface BackupSource {
    id: string;
    directory: string;
    /** Property keys, or an array entry selected by its stable id. */
    config: Array<string | { id: string }>;
    processes: string[];
    exclude?: string[];
    /** File names left out of copies wherever they are, such as a lock a running program holds. May change between definitions. */
    skip?: string[];
    /** One source may retain the panel's original backup history and schedule. */
    legacy?: boolean;
}

function requireSourceId(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new Error("Choose an explicit backup source id");
    return value;
}

export const backupApi = {
    defineSource: (appId: string, source: BackupSource, scope?: string): Promise<void> =>
        invokeIn<void>(scope, "backup-source-define", { panelId: requirePanelId(appId), source }),
    forSource: (appId: string, sourceId: string, scope?: string) => {
        const identity = { panelId: requirePanelId(appId), sourceId: requireSourceId(sourceId) };
        return {
            status: async (): Promise<BackupStatus> => status(await invokeIn(scope, "backup-status", identity)),
            list: (): Promise<BackupRecord[]> => invokeIn(scope, "backup-list", identity),
            create: (options: { label?: string } = {}): Promise<BackupRecord> => invokeIn(scope, "backup-create", { ...identity, label: options.label }),
            restore: (backupId: string): Promise<BackupRecord> => invokeIn(scope, "backup-restore", { ...identity, backupId }),
            delete: (backupId: string): Promise<void> => invokeIn(scope, "backup-delete", { ...identity, backupId }),
            setSchedule: async (schedule: { everyHours: BackupSchedule["everyHours"]; keep: number } | null): Promise<BackupStatus> => status(await invokeIn(scope, "backup-schedule-set", { ...identity, schedule })),
            chooseLocation: (): Promise<ChooseBackupLocationResult> => backupApi.chooseLocation(appId, sourceId),
            /** hears this source's running backup or restore move on, and end */
            onProgress: (listener: (change: BackupProgressChange) => void): (() => void) =>
                listenProgress(scope, identity.panelId, identity.sourceId, listener),
        };
    },
    /** where this panel's backups go, and whether one is running */
    status: async (appId: string, scope?: string): Promise<BackupStatus> =>
        status(await invokeIn(scope, "backup-status", { panelId: requirePanelId(appId) })),

    /** every backup or restore running now for the panel's data, its
     * named sources included */
    progress: (appId: string, scope?: string): Promise<BackupProgress[]> =>
        invokeIn<BackupProgress[]>(scope, "backup-progress", { panelId: requirePanelId(appId) }),

    /** hears the panel's running backups and restores (its named sources
     * included) move on a step, and end; returns the unsubscribe */
    onProgress: (appId: string, listener: (change: BackupProgressChange) => void, scope?: string): (() => void) =>
        listenProgress(scope, requirePanelId(appId), undefined, listener),

    /** backs up the panel's files and config now. The panel's service is
     * stopped while its data is copied, then started again. */
    create: (appId: string, options: { label?: string } = {}, scope?: string): Promise<BackupRecord> =>
        invokeIn<BackupRecord>(scope, "backup-create", { panelId: requirePanelId(appId), label: options.label }),

    /** newest first */
    list: (appId: string, scope?: string): Promise<BackupRecord[]> =>
        invokeIn<BackupRecord[]>(scope, "backup-list", { panelId: requirePanelId(appId) }),

    /** replaces the panel's files and config with the backup's */
    restore: (appId: string, backupId: string, scope?: string): Promise<BackupRecord> =>
        invokeIn<BackupRecord>(scope, "backup-restore", { panelId: requirePanelId(appId), backupId }),

    delete: (appId: string, backupId: string, scope?: string): Promise<void> =>
        invokeIn<void>(scope, "backup-delete", { panelId: requirePanelId(appId), backupId }),

    /** turns routine backups on, changes them, or (with null) turns them
     * off. The first runs one interval from now; a backup location must be
     * chosen first. Changing only `keep` leaves the next one when it was. */
    setSchedule: async (appId: string, schedule: { everyHours: BackupSchedule["everyHours"]; keep: number } | null, scope?: string): Promise<BackupStatus> =>
        status(await invokeIn(scope, "backup-schedule-set", { panelId: requirePanelId(appId), schedule })),

    /** shows Paperboard's backup location window for this panel. Call it
     * from the panel page, not a widget. */
    chooseLocation: (appId: string, sourceId?: string): Promise<ChooseBackupLocationResult> =>
        requestShell<ChooseBackupLocationResult>({
            type: "paperboard:backup-location",
            fields: { panelId: requirePanelId(appId), ...(sourceId !== undefined ? { sourceId: requireSourceId(sourceId) } : {}) },
            unavailable: () => new BackupLocationError("unavailable", "Choosing a backup location needs a panel shown in Paperboard"),
            widget: () => new BackupLocationError("unavailable", "A widget cannot choose a backup location; open its panel instead"),
            busy: () => new BackupLocationError("busy", "The backup location window is already open"),
            parse: (result: any) => {
                if (result?.status === "canceled") return { status: "canceled" };
                if (result?.status === "chosen" && result.location && typeof result.location.id === "string") return { status: "chosen", location: named(result.location)! };
                if (result?.status === "failed") return new BackupLocationError("failed", String(result.message ?? "Choosing a backup location failed"));
                return new BackupLocationError("failed", "The shell sent a malformed backup location result");
            },
        }),
};

export type NewBackupLocation =
    | { kind: "s3"; label: string; endpoint: string; region: string; bucket: string; prefix?: string; accessKeyId: string; secretAccessKey: string; pathStyle?: boolean }
    | { kind: "gdrive"; label: string; clientId: string; clientSecret: string; refreshToken: string };

/** Paperboard's own settings: the locations a computer offers. These need
 * the host's credential; a panel's is refused. */
export const backupLocationsApi = {
    list: (scope?: string): Promise<BackupLocation[]> => invokeIn<BackupLocation[]>(scope, "backup-locations"),
    /** why the computer's locations file cannot be used; null when it can */
    problem: (scope?: string): Promise<string | null> => invokeIn<string | null>(scope, "backup-locations-problem"),
    /** sets an unreadable locations file aside (it is kept) and starts a
     * fresh list; panels that used a location choose again */
    recover: (scope?: string): Promise<{ keptAs: string }> => invokeIn<{ keptAs: string }>(scope, "backup-locations-recover"),
    usage: (locationId: string, scope?: string): Promise<BackupLocationUsage> =>
        invokeIn<BackupLocationUsage>(scope, "backup-location-usage", { destinationId: locationId }),
    add: (location: NewBackupLocation, scope?: string): Promise<BackupLocation> =>
        invokeIn<BackupLocation>(scope, "backup-location-add", { destination: location }),
    remove: (locationId: string, scope?: string): Promise<void> =>
        invokeIn<void>(scope, "backup-location-remove", { destinationId: locationId }),
    /** null clears the panel's choice */
    setForPanel: async (panelId: string, locationId: string | null, scope?: string, sourceId?: string): Promise<BackupStatus> =>
        status(await invokeIn(scope, "backup-panel-location-set", { panelId: requirePanelId(panelId), destinationId: locationId, sourceId })),
};
