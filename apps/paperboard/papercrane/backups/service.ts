// The daemon's backup service: which location each panel backs up to, and
// creating, listing, restoring and deleting a panel's backups there.
//
// A backup copies the panel's file storage and config document (not vault
// secrets) while its service is stopped, under the panel's operation lock,
// then uploads after the lock is released. A restore downloads, checks the
// size and sha256 the record names, refuses entries that are not this
// panel's data and backups from a newer panel version, then swaps the data
// in transactionally (engine.replacePanelData).
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { PaperCraneEngine } from "../engine";
import { ErrorCode } from "../protocol";
import { RpcError, invalidParams } from "../rpc/errors";
import { logger } from "../logger";
import { createPanelArchive, extractPanelArchive, sha256File } from "./archive";
import {
    BACKUP_VAULT_OWNER,
    DESTINATION_LABEL_MAX,
    LOCAL_DESTINATION_ID,
    MAX_DESTINATIONS,
    readBackupConfig,
    writeBackupConfig,
    type BackupConfig,
    type Destination,
} from "./config";
import { DriveBackupStore, forgetDriveToken, GOOGLE_ENDPOINTS, type DriveEndpoints } from "./driveStore";
import { LocalBackupStore } from "./localStore";
import { normalizeS3Prefix, S3BackupStore } from "./s3Store";
import { BACKUP_ID_RE, BACKUP_LABEL_MAX, newBackupId, type BackupRecord, type BackupStore, type BackupUsage } from "./types";

/** create and restore run at most this many at once, one per panel */
export const MAX_RUNNING_BACKUP_JOBS = 2;

export interface DestinationSummary {
    id: string;
    kind: Destination["kind"];
    label: string;
    /** where it is, for people: a folder, bucket or account; never a secret */
    detail: string;
    removable: boolean;
}

export type NewDestination =
    | {
          kind: "s3";
          label: string;
          endpoint: string;
          region: string;
          bucket: string;
          prefix?: string;
          accessKeyId: string;
          secretAccessKey: string;
          pathStyle?: boolean;
      }
    | { kind: "gdrive"; label: string; clientId: string; clientSecret: string; refreshToken: string };

function conflict(message: string): RpcError {
    return new RpcError(ErrorCode.CONFLICT, message);
}

function notFound(message: string): RpcError {
    return new RpcError(ErrorCode.NOT_FOUND, message);
}

function field(input: any, name: string, max: number, optional = false): string {
    const value = input?.[name];
    if (value === undefined && optional) return "";
    if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max) {
        throw invalidParams(`${name} must be a string of at most ${max} characters`);
    }
    return value.trim();
}

function versionParts(v: string): [number, number, number] | null {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** true when a backup from version `made` should not go onto `installed` */
export function isNewerVersion(made: string | null, installed: string | null): boolean {
    if (made === null || installed === null || made === installed) return false;
    const a = versionParts(made);
    const b = versionParts(installed);
    // versions that cannot be compared are not assumed safe
    if (!a || !b) return true;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

export class BackupService {
    private readonly root: string;
    private readonly configFile: string;
    private readonly workDir: string;
    private readonly running = new Map<string, "create" | "restore">();
    private configWrites: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly engine: PaperCraneEngine,
        private readonly driveEndpoints: DriveEndpoints = GOOGLE_ENDPOINTS,
    ) {
        this.root = path.join(engine.getAppDataDir(), "backups");
        this.configFile = path.join(this.root, "destinations.json");
        // beside the data, so staged restores move in with a rename
        this.workDir = path.join(this.root, ".work");
    }

    // ─── Locations ──────────────────────────────────────────────────────

    private config(): BackupConfig {
        return readBackupConfig(this.configFile);
    }

    /** read-modify-write of the locations file, one at a time */
    private mutate<T>(fn: (config: BackupConfig) => Promise<T> | T): Promise<T> {
        const next = this.configWrites.then(async () => {
            const config = this.config();
            const result = await fn(config);
            await writeBackupConfig(this.configFile, config);
            return result;
        });
        this.configWrites = next.catch((err) => logger.debug("[backups] a locations change failed:", err));
        return next;
    }

    private destination(id: string, config = this.config()): Destination {
        const found = config.destinations.find((d) => d.id === id);
        if (!found) throw notFound(`No backup location ${JSON.stringify(id)}`);
        return found;
    }

    private secret(destinationId: string, name: string): string {
        const { found, value } = this.engine.getSecret(`${destinationId}.${name}`, BACKUP_VAULT_OWNER);
        if (!found || !value) throw new Error(`The backup location is missing its ${name}. Remove it and add it again`);
        return value;
    }

    private store(dest: Destination): BackupStore {
        switch (dest.kind) {
            case "local":
                return new LocalBackupStore(path.join(this.root, "panels"));
            case "s3":
                return new S3BackupStore(dest.s3, { secretAccessKey: this.secret(dest.id, "secret-key") });
            case "gdrive":
                return new DriveBackupStore(
                    dest.id,
                    dest.drive,
                    { clientSecret: this.secret(dest.id, "client-secret"), refreshToken: this.secret(dest.id, "refresh-token") },
                    this.driveEndpoints,
                );
        }
    }

    private summary(dest: Destination): DestinationSummary {
        const detail =
            dest.kind === "local"
                ? path.join(this.root, "panels")
                : dest.kind === "s3"
                  ? `${dest.s3.bucket}${dest.s3.prefix ? `/${dest.s3.prefix.replace(/\/$/, "")}` : ""} at ${new URL(dest.s3.endpoint).host}`
                  : "Google Drive, Paperboard Backups folder";
        return { id: dest.id, kind: dest.kind, label: dest.label, detail, removable: dest.id !== LOCAL_DESTINATION_ID };
    }

    listDestinations(): DestinationSummary[] {
        return this.config().destinations.map((d) => this.summary(d));
    }

    async destinationUsage(destinationId: string): Promise<BackupUsage> {
        return this.store(this.destination(destinationId)).usage();
    }

    async addDestination(input: NewDestination): Promise<DestinationSummary> {
        const label = field(input, "label", DESTINATION_LABEL_MAX);
        const id = `d-${crypto.randomBytes(6).toString("hex")}`;
        let dest: Destination;
        const secrets: Array<[string, string]> = [];
        if (input?.kind === "s3") {
            const endpoint = field(input, "endpoint", 512);
            dest = {
                id,
                kind: "s3",
                label,
                s3: {
                    endpoint,
                    region: field(input, "region", 64),
                    bucket: field(input, "bucket", 63),
                    prefix: normalizeS3Prefix(field(input, "prefix", 256, true)),
                    accessKeyId: field(input, "accessKeyId", 256),
                    pathStyle: input.pathStyle === true,
                },
            };
            secrets.push(["secret-key", field(input, "secretAccessKey", 1024)]);
        } else if (input?.kind === "gdrive") {
            dest = { id, kind: "gdrive", label, drive: { clientId: field(input, "clientId", 512), folderId: "" } };
            secrets.push(["client-secret", field(input, "clientSecret", 1024)], ["refresh-token", field(input, "refreshToken", 2048)]);
        } else {
            throw invalidParams('kind must be "s3" or "gdrive"');
        }
        if (this.config().destinations.length - 1 >= MAX_DESTINATIONS) throw conflict(`Paperboard keeps at most ${MAX_DESTINATIONS} backup locations`);

        for (const [name, value] of secrets) this.engine.setSecret(`${id}.${name}`, value, BACKUP_VAULT_OWNER);
        try {
            if (dest.kind === "gdrive") {
                const drive = this.store(dest) as DriveBackupStore;
                dest.drive.folderId = await drive.createFolder();
            }
            await this.store(dest).check();
            return await this.mutate((config) => {
                if (config.destinations.length - 1 >= MAX_DESTINATIONS) throw conflict(`Paperboard keeps at most ${MAX_DESTINATIONS} backup locations`);
                config.destinations.push(dest);
                return this.summary(dest);
            });
        } catch (err) {
            this.forgetSecrets(id);
            throw err;
        }
    }

    private forgetSecrets(destinationId: string): void {
        for (const name of ["secret-key", "client-secret", "refresh-token"]) {
            this.engine.deleteSecret(`${destinationId}.${name}`, BACKUP_VAULT_OWNER);
        }
        forgetDriveToken(destinationId);
    }

    /** forgets the location; backups already there stay where they are */
    async removeDestination(destinationId: string): Promise<void> {
        if (destinationId === LOCAL_DESTINATION_ID) throw invalidParams("This computer is built in and cannot be removed");
        await this.mutate((config) => {
            this.destination(destinationId, config);
            config.destinations = config.destinations.filter((d) => d.id !== destinationId);
            for (const [panelId, destId] of Object.entries(config.panels)) {
                if (destId === destinationId) delete config.panels[panelId];
            }
        });
        this.forgetSecrets(destinationId);
    }

    async setPanelDestination(panelId: string, destinationId: string | null): Promise<void> {
        this.engine.installedPanelVersion(panelId); // refuses a panel that is not installed
        await this.mutate((config) => {
            if (destinationId === null) delete config.panels[panelId];
            else config.panels[panelId] = this.destination(destinationId, config).id;
        });
    }

    // ─── A panel's backups ──────────────────────────────────────────────

    status(panelId: string): { destination: DestinationSummary | null; running: "create" | "restore" | null } {
        const config = this.config();
        const destId = config.panels[panelId];
        return {
            destination: destId ? this.summary(this.destination(destId, config)) : null,
            running: this.running.get(panelId) ?? null,
        };
    }

    private panelStore(panelId: string): BackupStore {
        const config = this.config();
        const destId = config.panels[panelId];
        if (!destId) throw conflict("No backup location chosen for this panel");
        return this.store(this.destination(destId, config));
    }

    private async job<T>(panelId: string, kind: "create" | "restore", fn: () => Promise<T>): Promise<T> {
        const current = this.running.get(panelId);
        if (current) throw conflict(`A backup ${current === "create" ? "is being made" : "is being restored"} for this panel`);
        if (this.running.size >= MAX_RUNNING_BACKUP_JOBS) throw conflict("Paperboard is busy with other backups. Try again when they finish");
        this.running.set(panelId, kind);
        try {
            fs.mkdirSync(this.workDir, { recursive: true });
            return await fn();
        } finally {
            this.running.delete(panelId);
        }
    }

    async create(panelId: string, label: string | null): Promise<BackupRecord> {
        if (label !== null && (typeof label !== "string" || label.length > BACKUP_LABEL_MAX)) {
            throw invalidParams(`label must be at most ${BACKUP_LABEL_MAX} characters`);
        }
        const store = this.panelStore(panelId);
        return this.job(panelId, "create", async () => {
            const id = newBackupId();
            const archive = path.join(this.workDir, `${id}.pbbackup`);
            try {
                const { size, sha256, panelVersion } = await this.engine.withPanelOperation(panelId, async () => {
                    // a service that takes part gets ready first (a game
                    // server stops writing its world). When that fails the
                    // service is still stopped and started again below, which
                    // undoes a half-done preparation, and nothing is copied.
                    let notReady: unknown = null;
                    try {
                        await this.engine.prepareServiceForBackup(panelId);
                    } catch (err) {
                        notReady = err;
                    }
                    return this.engine.withServicePaused(panelId, async () => {
                        if (notReady !== null) {
                            throw conflict(`The panel could not get ready for a backup: ${notReady instanceof Error ? notReady.message : String(notReady)}`);
                        }
                        const panelVersion = this.engine.installedPanelVersion(panelId);
                        const made = await createPanelArchive(this.engine.getAppDataDir(), this.engine.panelDataEntries(panelId), archive);
                        return { ...made, panelVersion };
                    });
                });
                const record: BackupRecord = {
                    format: 1,
                    id,
                    panelId,
                    createdAt: new Date().toISOString(),
                    size,
                    sha256,
                    panelVersion,
                    label: label?.trim() || null,
                };
                await store.put(record, archive);
                return record;
            } finally {
                await fs.promises.rm(archive, { force: true });
            }
        });
    }

    async list(panelId: string): Promise<BackupRecord[]> {
        return this.panelStore(panelId).list(panelId);
    }

    private async find(store: BackupStore, panelId: string, backupId: string): Promise<BackupRecord> {
        if (typeof backupId !== "string" || !BACKUP_ID_RE.test(backupId)) throw invalidParams("backupId is not a backup id");
        const record = (await store.list(panelId)).find((r) => r.id === backupId);
        if (!record || record.panelId !== panelId) throw notFound(`Backup ${backupId} is not at this panel's backup location`);
        return record;
    }

    async restore(panelId: string, backupId: string): Promise<BackupRecord> {
        const store = this.panelStore(panelId);
        return this.job(panelId, "restore", async () => {
            const record = await this.find(store, panelId, backupId);
            const installed = this.engine.installedPanelVersion(panelId);
            if (isNewerVersion(record.panelVersion, installed)) {
                throw conflict(`This backup was made by version ${record.panelVersion} of the panel; ${installed} is installed. Update the panel first`);
            }
            const archive = path.join(this.workDir, `${record.id}-restore.pbbackup`);
            const staging = await fs.promises.mkdtemp(path.join(this.workDir, "restore-"));
            try {
                await store.get(record, archive);
                const size = fs.statSync(archive).size;
                if (size !== record.size || (await sha256File(archive)) !== record.sha256) {
                    throw new Error("The downloaded backup does not match its record; it was not restored");
                }
                const entries = this.engine.panelDataEntries(panelId);
                const staged = await extractPanelArchive(archive, entries, staging);
                await this.engine.withPanelOperation(panelId, () => this.engine.replacePanelData(panelId, staged));
                return record;
            } finally {
                await fs.promises.rm(archive, { force: true });
                await fs.promises.rm(staging, { recursive: true, force: true });
            }
        });
    }

    async remove(panelId: string, backupId: string): Promise<void> {
        const store = this.panelStore(panelId);
        await store.remove(await this.find(store, panelId, backupId));
    }
}
