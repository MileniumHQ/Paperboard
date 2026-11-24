// The computer's backup locations: the list, each one's store and secrets,
// and which one each panel's backups go to. Every change is the user's,
// made in the shell (the RPC needs host authority).
import * as crypto from "crypto";
import * as path from "path";
import type { PaperCraneEngine } from "../engine/index";
import { ErrorCode } from "../core/protocol";
import { RpcError, invalidParams } from "../rpc/errors";
import { SerialQueue } from "@mileniumhq/paperapi/serialQueue";
import type { BackupLocation, NewBackupLocation } from "@mileniumhq/paperapi/backups";
import {
    BACKUP_VAULT_OWNER,
    LOCAL_LOCATION_ID,
    LOCATION_LABEL_MAX,
    MAX_LOCATIONS,
    BackupConfigUnreadableError,
    readBackupConfig,
    recoverBackupConfig,
    writeBackupConfig,
    type BackupConfig,
    type StoredLocation,
} from "./config";
import { DriveBackupStore, forgetDriveToken, GOOGLE_ENDPOINTS, type DriveEndpoints } from "./driveStore";
import { LocalBackupStore } from "./localStore";
import { normalizeS3Prefix, S3BackupStore } from "./s3Store";
import type { BackupStore, BackupUsage } from "./types";

export const conflict = (message: string) => new RpcError(ErrorCode.CONFLICT, message);
export const notFound = (message: string) => new RpcError(ErrorCode.NOT_FOUND, message);

function field(input: any, name: string, max: number, optional = false): string {
    const value = input?.[name];
    if (value === undefined && optional) return "";
    if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max) {
        throw invalidParams(`${name} must be a string of at most ${max} characters`);
    }
    return value.trim();
}

export class BackupLocations {
    private readonly configFile: string;
    private readonly configWrites = new SerialQueue();

    constructor(
        private readonly engine: PaperCraneEngine,
        /** <data dir>/backups */
        private readonly root: string,
        private readonly driveEndpoints: DriveEndpoints = GOOGLE_ENDPOINTS,
    ) {
        this.configFile = path.join(root, "destinations.json");
    }

    private config(): BackupConfig {
        return readBackupConfig(this.configFile);
    }

    /** read-modify-write of the locations file, one at a time */
    private mutate<T>(fn: (config: BackupConfig) => Promise<T> | T): Promise<T> {
        return this.configWrites.run(async () => {
            const config = this.config();
            const result = await fn(config);
            await writeBackupConfig(this.configFile, config);
            return result;
        });
    }

    /** null when the locations file reads fine (or does not exist yet);
     * otherwise why it cannot be used. Every other locations call refuses
     * until recover sets the file aside. */
    problem(): string | null {
        try {
            this.config();
            return null;
        } catch (err) {
            if (err instanceof BackupConfigUnreadableError) return err.message;
            throw err;
        }
    }

    /** the explicit recovery from an unreadable locations file: it is kept
     * under a new name and the list starts fresh. Panels that used a
     * location choose again; backups at the locations are untouched. */
    recover(): Promise<{ keptAs: string }> {
        return this.configWrites.run(() => ({ keptAs: recoverBackupConfig(this.configFile) }));
    }

    private find(id: string, config = this.config()): StoredLocation {
        const found = config.locations.find((l) => l.id === id);
        if (!found) throw notFound(`No backup location ${JSON.stringify(id)}`);
        return found;
    }

    private secret(locationId: string, name: string): string {
        const { found, value } = this.engine.getSecret(`${locationId}.${name}`, BACKUP_VAULT_OWNER);
        if (!found || !value) throw new Error(`The backup location is missing its ${name}. Remove it and add it again`);
        return value;
    }

    private store(location: StoredLocation): BackupStore {
        switch (location.kind) {
            case "local":
                return new LocalBackupStore(path.join(this.root, "panels"));
            case "s3":
                return new S3BackupStore(location.s3, { secretAccessKey: this.secret(location.id, "secret-key") });
            case "gdrive":
                return new DriveBackupStore(
                    location.id,
                    location.drive,
                    { clientSecret: this.secret(location.id, "client-secret"), refreshToken: this.secret(location.id, "refresh-token") },
                    this.driveEndpoints,
                );
        }
    }

    private summary(location: StoredLocation): BackupLocation {
        const detail =
            location.kind === "local"
                ? path.join(this.root, "panels")
                : location.kind === "s3"
                  ? `${location.s3.bucket}${location.s3.prefix ? `/${location.s3.prefix.replace(/\/$/, "")}` : ""} at ${new URL(location.s3.endpoint).host}`
                  : "Google Drive, Paperboard Backups folder";
        return { id: location.id, kind: location.kind, label: location.label, detail, removable: location.id !== LOCAL_LOCATION_ID };
    }

    list(): BackupLocation[] {
        return this.config().locations.map((l) => this.summary(l));
    }

    usage(locationId: string): Promise<BackupUsage> {
        return this.store(this.find(locationId)).usage();
    }

    async add(input: NewBackupLocation): Promise<BackupLocation> {
        const label = field(input, "label", LOCATION_LABEL_MAX);
        const id = `d-${crypto.randomBytes(6).toString("hex")}`;
        let location: StoredLocation;
        const secrets: Array<[string, string]> = [];
        if (input?.kind === "s3") {
            location = {
                id,
                kind: "s3",
                label,
                s3: {
                    endpoint: field(input, "endpoint", 512),
                    region: field(input, "region", 64),
                    bucket: field(input, "bucket", 63),
                    prefix: normalizeS3Prefix(field(input, "prefix", 256, true)),
                    accessKeyId: field(input, "accessKeyId", 256),
                    pathStyle: input.pathStyle === true,
                },
            };
            secrets.push(["secret-key", field(input, "secretAccessKey", 1024)]);
        } else if (input?.kind === "gdrive") {
            location = { id, kind: "gdrive", label, drive: { clientId: field(input, "clientId", 512), folderId: "" } };
            secrets.push(["client-secret", field(input, "clientSecret", 1024)], ["refresh-token", field(input, "refreshToken", 2048)]);
        } else {
            throw invalidParams('kind must be "s3" or "gdrive"');
        }
        if (this.config().locations.length - 1 >= MAX_LOCATIONS) throw conflict(`Paperboard keeps at most ${MAX_LOCATIONS} backup locations`);

        for (const [name, value] of secrets) this.engine.setSecret(`${id}.${name}`, value, BACKUP_VAULT_OWNER);
        try {
            if (location.kind === "gdrive") {
                const drive = this.store(location) as DriveBackupStore;
                location.drive.folderId = await drive.createFolder();
            }
            await this.store(location).check();
            return await this.mutate((config) => {
                if (config.locations.length - 1 >= MAX_LOCATIONS) throw conflict(`Paperboard keeps at most ${MAX_LOCATIONS} backup locations`);
                config.locations.push(location);
                return this.summary(location);
            });
        } catch (err) {
            this.forgetSecrets(id);
            throw err;
        }
    }

    /**
     * Signs an existing Google Drive location in again (its sign-in expired
     * or was revoked). The location keeps its id and its folder, so the
     * backups already there stay listed: the new sign-in is proven against
     * that folder before it replaces the saved one, and a different Google
     * account that cannot see the folder is refused with the old sign-in
     * left in place.
     */
    async reconnect(locationId: string, input: unknown): Promise<BackupLocation> {
        const location = this.find(locationId);
        if (location.kind !== "gdrive") throw invalidParams("Only a Google Drive location can be signed in again");
        const clientId = field(input, "clientId", 512);
        const clientSecret = field(input, "clientSecret", 1024);
        const refreshToken = field(input, "refreshToken", 2048);
        // a stand-in id keeps the proof's access token out of the location's cache
        const proofId = `${location.id}.reconnect`;
        try {
            await new DriveBackupStore(proofId, { clientId, folderId: location.drive.folderId }, { clientSecret, refreshToken }, this.driveEndpoints).check();
        } finally {
            forgetDriveToken(proofId);
        }
        const previous = (["client-secret", "refresh-token"] as const).map((name) => [name, this.engine.getSecret(`${location.id}.${name}`, BACKUP_VAULT_OWNER)] as const);
        this.engine.setSecret(`${location.id}.client-secret`, clientSecret, BACKUP_VAULT_OWNER);
        this.engine.setSecret(`${location.id}.refresh-token`, refreshToken, BACKUP_VAULT_OWNER);
        try {
            await this.mutate((current) => {
                const target = this.find(locationId, current);
                if (target.kind === "gdrive") target.drive.clientId = clientId;
            });
        } catch (err) {
            // the vault goes back to what it held: the old value, or nothing
            for (const [name, { found, value }] of previous) {
                if (found && value) this.engine.setSecret(`${location.id}.${name}`, value, BACKUP_VAULT_OWNER);
                else this.engine.deleteSecret(`${location.id}.${name}`, BACKUP_VAULT_OWNER);
            }
            throw err;
        } finally {
            forgetDriveToken(location.id);
        }
        return this.summary(this.find(locationId));
    }

    private forgetSecrets(locationId: string): void {
        for (const name of ["secret-key", "client-secret", "refresh-token"]) {
            this.engine.deleteSecret(`${locationId}.${name}`, BACKUP_VAULT_OWNER);
        }
        forgetDriveToken(locationId);
    }

    /** forgets the location; backups already there stay where they are */
    async remove(locationId: string): Promise<void> {
        if (locationId === LOCAL_LOCATION_ID) throw invalidParams("The computer's own folder is built in and cannot be removed");
        await this.mutate((config) => {
            this.find(locationId, config);
            config.locations = config.locations.filter((l) => l.id !== locationId);
            for (const [panelId, chosen] of Object.entries(config.panels)) {
                if (chosen === locationId) delete config.panels[panelId];
            }
        });
        this.forgetSecrets(locationId);
    }

    /** where the panel's backups go; null clears the choice */
    async setForPanel(panelId: string, locationId: string | null): Promise<void> {
        this.engine.installedPanelVersion(panelId); // refuses a panel that is not installed
        await this.mutate((config) => {
            if (locationId === null) delete config.panels[panelId];
            else config.panels[panelId] = this.find(locationId, config).id;
        });
    }

    /** the location the panel's backups go to; null until the user chooses one */
    forPanel(panelId: string): BackupLocation | null {
        const config = this.config();
        const chosen = config.panels[panelId];
        return chosen ? this.summary(this.find(chosen, config)) : null;
    }

    /** the store the panel's backups go to */
    storeFor(panelId: string): BackupStore {
        const config = this.config();
        const chosen = config.panels[panelId];
        if (!chosen) throw conflict("No backup location chosen for this panel");
        return this.store(this.find(chosen, config));
    }
}
