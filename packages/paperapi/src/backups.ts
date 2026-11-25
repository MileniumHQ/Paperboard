// Panel backups. A backup is a copy of files from a panel's storage, plus a
// little JSON the panel hands over, kept at the backup location the user
// chose for the panel: this computer, an S3-compatible bucket, or Google
// Drive. The panel's service decides what goes in (its beforeBackup hook)
// and keeps running throughout:
//
// 1. a backup is started, from anywhere (the panel, Blocks, the service)
// 2. beforeBackup stops what would write over the copy, and names its files
// 3. the files are copied as they are
// 4. afterBackup lets the panel carry on
// 5. the copy is uploaded
//
// A restore runs the other way: beforeRestore stops what uses the files,
// they are swapped for the backup's, and afterRestore hands the panel its
// JSON back to pick up from. The user chooses the location in a window
// Paperboard shows; a panel opens it with chooseLocation, never sets it.
import { getTransport, RPC_ROUTES } from "./ipc";
import { BACKUP_TARGET_RE, type BackupStatusAnswer } from "./protocol";
import { BACKUP_PROGRESS_EVENT } from "./channels";
import { requirePanelId } from "./panelIdentity";
import { requestShell } from "./shellRequest";
import { currentFrameSession, frameSessionArrived, type FrameSession } from "./frameSession";

export interface BackupRecord {
    format: 2;
    /** sorts by creation time */
    id: string;
    panelId: string;
    /** what of the panel it is a backup of, as the panel names it (a game
     * server's id); null for a backup of the panel as a whole */
    target: string | null;
    /** ISO timestamp */
    createdAt: string;
    /** archive bytes */
    size: number;
    /** archive sha256, hex */
    sha256: string;
    /** the panel version that made the backup */
    panelVersion: string | null;
    label: string | null;
    /** the files and folders of the panel's storage it holds; "" is all of it */
    paths: string[];
    /** paths under those that were left out, and that a restore leaves as they are */
    exclude: string[];
}

/** What a backup holds, as the panel's beforeBackup names it. */
export interface BackupContents {
    /** files and folders in the panel's storage, relative to it with "/"
     * between names; "" is the whole storage. None may hold another. It
     * may be empty when `data` is all there is to keep. */
    paths: string[];
    /** paths under `paths` to leave out; a restore leaves them as they are
     * (a game install the panel downloads again) */
    exclude?: string[];
    /** file names left out wherever they are, such as a lock a running
     * program holds */
    skip?: string[];
    /** JSON the panel gets back in afterRestore, such as the settings the
     * files go with */
    data?: unknown;
}

/** How the copy of a backup ended, as afterBackup hears it: carry on either way. */
export type BackupCopied = { target: string | null } & ({ ok: true } | { ok: false; error: string });

/** How a restore ended, as afterRestore hears it. On ok the files are the
 * backup's and data is what beforeBackup handed over (null when none); on
 * failure they are back as they were. */
export type RestoreEnded = { target: string | null; backup: BackupRecord } & ({ ok: true; data: unknown } | { ok: false; error: string });

export interface BackupLocation {
    id: string;
    kind: "local" | "s3" | "gdrive";
    label: string;
    /** where it is, for people: a folder, a bucket, an account */
    detail: string;
    /** false for "This computer", which is built in */
    removable: boolean;
}

export function isBackupTarget(value: unknown): value is string {
    return typeof value === "string" && BACKUP_TARGET_RE.test(value);
}

/** a path in a panel's storage as backups name it: relative, "/" between
 * names, none of them empty, "." or ".."; "" is the storage itself */
export function isBackupPath(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 1024) return false;
    if (value === "") return true;
    // eslint-disable-next-line no-control-regex
    if (/[\\\u0000-\u001f]/.test(value)) return false;
    return value.split("/").every((name) => name !== "" && name !== "." && name !== "..");
}

/**
 * What a running backup or restore is doing:
 * - `preparing`: the panel gets ready (a game server saves its world)
 * - `packing`: the files are compressed into one archive
 * - `resuming`: the panel carries on
 * - `saving`: the archive goes to the backup location
 * - `downloading`, `checking`, `unpacking`: a restore fetches, verifies and opens the archive
 * - `restoring`: the panel's files are swapped for the backup's
 */
export type BackupStep = "preparing" | "packing" | "resuming" | "saving" | "downloading" | "checking" | "unpacking" | "restoring";

export interface BackupProgress {
    panelId: string;
    /** as in BackupRecord */
    target: string | null;
    kind: "create" | "restore";
    step: BackupStep;
    /** bytes done and expected in this step; null when the step cannot be measured */
    done: number | null;
    total: number | null;
}

/** a change in a panel's running backup; progress is null once it ends */
export interface BackupProgressChange {
    panelId: string;
    target: string | null;
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
    packing: "Compressing",
    resuming: "Finishing up",
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

/** why a running backup's progress can't be heard; null once it can again */
export type BackupProgressLost = (why: string | null) => void;

export interface BackupStatus {
    /** null until the user chooses where this panel's backups go */
    location: BackupLocation | null;
    /** the backup or restore of this target running now; null when none is */
    progress: BackupProgress | null;
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

const named = (location: BackupLocation, session: FrameSession | null): BackupLocation => ({ ...location, label: backupLocationLabel(location, session?.computerName) });

const status = async (r: BackupStatusAnswer): Promise<BackupStatus> => ({ location: r.location ? named(r.location, await frameSessionArrived()) : null, progress: r.progress });

/** which of the panel's backups a call means: a target, or the panel's own */
export interface BackupTarget {
    /** the panel's own name for what is backed up (a game server's id);
     * left out for backups of the panel as a whole */
    target?: string;
}

function targetOf(options: BackupTarget | undefined): { target?: string } {
    if (options?.target === undefined) return {};
    if (!isBackupTarget(options.target)) throw new Error("A backup target is a short id: letters, digits, '.', '_' and '-'");
    return { target: options.target };
}

export const backupApi = {
    /** where the panel's backups go, and the target's running backup */
    status: async (appId: string, options?: BackupTarget, scope?: string): Promise<BackupStatus> =>
        status(await RPC_ROUTES["backup-status"].call(scope, { panelId: requirePanelId(appId), ...targetOf(options) })),

    /** the target's backups, newest first */
    list: (appId: string, options?: BackupTarget, scope?: string): Promise<BackupRecord[]> =>
        RPC_ROUTES["backup-list"].call(scope, { panelId: requirePanelId(appId), ...targetOf(options) }),

    /** backs the target up now, as the panel's beforeBackup names it */
    create: (appId: string, options: BackupTarget & { label?: string } = {}, scope?: string): Promise<BackupRecord> =>
        RPC_ROUTES["backup-create"].call(scope, { panelId: requirePanelId(appId), ...targetOf(options), label: options.label }),

    /** puts the target's files back as the backup has them */
    restore: (appId: string, backupId: string, options?: BackupTarget, scope?: string): Promise<BackupRecord> =>
        RPC_ROUTES["backup-restore"].call(scope, { panelId: requirePanelId(appId), ...targetOf(options), backupId }),

    delete: (appId: string, backupId: string, options?: BackupTarget, scope?: string): Promise<void> =>
        RPC_ROUTES["backup-delete"].call(scope, { panelId: requirePanelId(appId), ...targetOf(options), backupId }),

    /** every backup or restore running now for the panel, any target */
    progress: (appId: string, scope?: string): Promise<BackupProgress[]> =>
        RPC_ROUTES["backup-progress"].call(scope, { panelId: requirePanelId(appId) }),

    /**
     * Hears the panel's running backups and restores (any target) move on a
     * step, and end; returns the unsubscribe. onLost hears why progress
     * can't be heard (the connection failed or dropped), and null once it
     * can again: show it, then read progress() again.
     */
    onProgress: (appId: string, listener: (change: BackupProgressChange) => void, options: { onLost?: BackupProgressLost; scope?: string } = {}): (() => void) => {
        const panelId = requirePanelId(appId);
        const transport = getTransport(options.scope);
        const off = transport.subscribeEvent(BACKUP_PROGRESS_EVENT, (change) => {
            if (change.panelId === panelId) listener({ panelId, target: change.target, progress: change.progress });
        });
        const onLost = options.onLost;
        let lost: string | null = null;
        const onStatus = (s: { connected: boolean; error?: string }) => {
            const why = s.connected ? null : (s.error ?? "The connection to the Paperboard Server dropped");
            // a drop that is still a drop says nothing new
            if ((why === null) === (lost === null)) return;
            lost = why;
            onLost?.(why);
        };
        if (onLost) transport.onStatus(onStatus);
        transport.keepConnected();
        return () => {
            off();
            if (onLost) transport.offStatus(onStatus);
        };
    },

    /** shows Paperboard's backup location window for this panel. Call it
     * from the panel page, not a widget. */
    chooseLocation: (appId: string): Promise<ChooseBackupLocationResult> =>
        requestShell<ChooseBackupLocationResult>({
            type: "paperboard:backup-location",
            fields: { panelId: requirePanelId(appId) },
            unavailable: () => new BackupLocationError("unavailable", "Choosing a backup location needs a panel shown in Paperboard"),
            widget: () => new BackupLocationError("unavailable", "A widget cannot choose a backup location; open its panel instead"),
            busy: () => new BackupLocationError("busy", "The backup location window is already open"),
            parse: (result: any) => {
                if (result?.status === "canceled") return { status: "canceled" };
                if (result?.status === "chosen" && result.location && typeof result.location.id === "string") {
                    // a reply comes only to a frame the shell has given a session
                    return { status: "chosen", location: named(result.location, currentFrameSession()) };
                }
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
    list: (scope?: string): Promise<BackupLocation[]> => RPC_ROUTES["backup-locations"].call(scope, {}),
    /** why the computer's locations file cannot be used; null when it can */
    problem: (scope?: string): Promise<string | null> => RPC_ROUTES["backup-locations-problem"].call(scope, {}),
    /** sets an unreadable locations file aside (it is kept) and starts a
     * fresh list; panels that used a location choose again */
    recover: (scope?: string): Promise<{ keptAs: string }> => RPC_ROUTES["backup-locations-recover"].call(scope, {}),
    usage: (locationId: string, scope?: string): Promise<BackupLocationUsage> => RPC_ROUTES["backup-location-usage"].call(scope, { locationId }),
    add: (location: NewBackupLocation, scope?: string): Promise<BackupLocation> => RPC_ROUTES["backup-location-add"].call(scope, { location }),
    remove: (locationId: string, scope?: string): Promise<void> => RPC_ROUTES["backup-location-remove"].call(scope, { locationId }),
    /** where the panel's backups go; null clears the choice */
    setForPanel: async (panelId: string, locationId: string | null, scope?: string): Promise<BackupStatus> =>
        status(await RPC_ROUTES["backup-panel-location-set"].call(scope, { panelId: requirePanelId(panelId), locationId })),
};
