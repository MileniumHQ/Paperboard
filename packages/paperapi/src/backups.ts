// Panel backups. A backup copies the panel's file storage and config
// document (never its vault secrets) to the backup location the user chose
// for the panel: this computer, an S3-compatible bucket, or Google Drive.
// The user chooses the location in a window Paperboard shows; a panel can
// open it with chooseLocation, never set it itself.
import { invokeIn } from "./ipc";
import { requirePanelId } from "./panelIdentity";
import { requestShell } from "./shellRequest";

export interface BackupRecord {
    format: 1;
    /** sorts by creation time */
    id: string;
    panelId: string;
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

export interface BackupStatus {
    /** null until the user chooses where this panel's backups go */
    location: BackupLocation | null;
    /** a backup being made or restored for this panel right now */
    running: "create" | "restore" | null;
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

const status = (r: any): BackupStatus => ({ location: r?.destination ?? null, running: r?.running ?? null });

export const backupApi = {
    /** where this panel's backups go, and whether one is running */
    status: async (appId: string, scope?: string): Promise<BackupStatus> =>
        status(await invokeIn(scope, "backup-status", { panelId: requirePanelId(appId) })),

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
                if (result?.status === "chosen" && result.location && typeof result.location.id === "string") return { status: "chosen", location: result.location };
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
    usage: (locationId: string, scope?: string): Promise<BackupLocationUsage> =>
        invokeIn<BackupLocationUsage>(scope, "backup-location-usage", { destinationId: locationId }),
    add: (location: NewBackupLocation, scope?: string): Promise<BackupLocation> =>
        invokeIn<BackupLocation>(scope, "backup-location-add", { destination: location }),
    remove: (locationId: string, scope?: string): Promise<void> =>
        invokeIn<void>(scope, "backup-location-remove", { destinationId: locationId }),
    /** null clears the panel's choice */
    setForPanel: async (panelId: string, locationId: string | null, scope?: string): Promise<BackupStatus> =>
        status(await invokeIn(scope, "backup-panel-location-set", { panelId: requirePanelId(panelId), destinationId: locationId })),
};
