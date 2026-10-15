// Google Drive backups: one file per archive in a "Paperboard Backups"
// folder Paperboard created (the drive.file scope sees only files this app
// made). The record travels in the file's description; two app properties
// index it, a hash of the panel id (property values are short) and the
// backup id. Access tokens come from the stored refresh token.
import * as crypto from "crypto";
import { logger } from "../logger";
import { assertSecureUrl, expectOk, httpRequest } from "./http";
import { BackupListingError, backupArchiveDownloadCap, MAX_LISTED_BACKUPS, newestFirst, parseBackupRecord, type BackupRecord, type BackupStore, type BackupUsage } from "./types";

export interface DriveEndpoints {
    tokenUrl: string;
    apiBase: string;
    uploadBase: string;
}

export const GOOGLE_ENDPOINTS: DriveEndpoints = {
    tokenUrl: "https://oauth2.googleapis.com/token",
    apiBase: "https://www.googleapis.com/drive/v3",
    uploadBase: "https://www.googleapis.com/upload/drive/v3",
};

export const DRIVE_FOLDER_NAME = "Paperboard Backups";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const LIST_PAGES_MAX = 20;

export interface DriveSettings {
    clientId: string;
    folderId: string;
}

export interface DriveCredentials {
    clientSecret: string;
    refreshToken: string;
}

// access tokens per destination; one entry per configured destination,
// dropped when the destination is removed
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function forgetDriveToken(destinationId: string): void {
    tokenCache.delete(destinationId);
}

export function panelKey(panelId: string): string {
    return crypto.createHash("sha256").update(panelId).digest("hex").slice(0, 40);
}

function quote(value: string): string {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export class DriveBackupStore implements BackupStore {
    constructor(
        private readonly destinationId: string,
        private readonly settings: DriveSettings,
        private readonly credentials: DriveCredentials,
        private readonly endpoints: DriveEndpoints = GOOGLE_ENDPOINTS,
    ) {
        for (const url of [endpoints.tokenUrl, endpoints.apiBase, endpoints.uploadBase]) assertSecureUrl(url, "A Google endpoint");
    }

    private async accessToken(): Promise<string> {
        const cached = tokenCache.get(this.destinationId);
        if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
        const res = await httpRequest(this.endpoints.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: this.settings.clientId,
                client_secret: this.credentials.clientSecret,
                refresh_token: this.credentials.refreshToken,
                grant_type: "refresh_token",
            }).toString(),
            maxBytes: 64 * 1024,
        });
        if (res.status === 400 || res.status === 401) {
            throw new Error("Google refused the saved sign-in. Reconnect this backup location from Computer Info > Backups");
        }
        const body = JSON.parse(expectOk(res, "Refreshing the Google sign-in").body.toString("utf8"));
        if (typeof body.access_token !== "string") throw new Error("Google sent no access token");
        tokenCache.set(this.destinationId, { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 });
        return body.access_token;
    }

    private async api(path: string, init: Parameters<typeof httpRequest>[1] = {}, base = this.endpoints.apiBase) {
        const token = await this.accessToken();
        return httpRequest(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
    }

    private async files(query: string, fields: string): Promise<any[]> {
        const out: any[] = [];
        let pageToken = "";
        for (let page = 0; page < LIST_PAGES_MAX; page++) {
            const params = new URLSearchParams({ q: query, fields: `nextPageToken, files(${fields})`, pageSize: "1000", spaces: "drive" });
            if (pageToken) params.set("pageToken", pageToken);
            const body = JSON.parse(expectOk(await this.api(`/files?${params}`), "Listing Google Drive").body.toString("utf8"));
            out.push(...(Array.isArray(body.files) ? body.files : []));
            pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : "";
            if (!pageToken) return out;
        }
        logger.warn(`[backups] the Google Drive listing stopped after ${LIST_PAGES_MAX} pages`);
        return out;
    }

    private inFolder(): string {
        return `${quote(this.settings.folderId)} in parents and trashed = false`;
    }

    private async fileId(record: BackupRecord): Promise<string> {
        const found = await this.files(
            `${this.inFolder()} and appProperties has { key='pbBackup' and value=${quote(record.id)} } and appProperties has { key='pbPanel' and value=${quote(panelKey(record.panelId))} }`,
            "id",
        );
        if (!found[0]?.id) throw new Error(`Backup ${record.id} is not in Google Drive`);
        return found[0].id;
    }

    /** creates the folder a new Drive location writes into; resolves with its id */
    async createFolder(): Promise<string> {
        const res = await this.api("/files?fields=id", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME }),
        });
        const id = JSON.parse(expectOk(res, "Creating the Google Drive folder").body.toString("utf8")).id;
        if (typeof id !== "string") throw new Error("Google Drive did not return the new folder");
        return id;
    }

    async check(): Promise<void> {
        const res = await this.api(`/files/${encodeURIComponent(this.settings.folderId)}?fields=id,trashed`);
        const body = JSON.parse(expectOk(res, "Reaching the Google Drive folder").body.toString("utf8"));
        if (body.trashed) throw new Error(`The "${DRIVE_FOLDER_NAME}" folder is in the Google Drive trash`);
    }

    async usage(): Promise<BackupUsage> {
        const about = JSON.parse(expectOk(await this.api("/about?fields=storageQuota"), "Reading Google Drive storage").body.toString("utf8"));
        const limit = Number(about.storageQuota?.limit);
        const usage = Number(about.storageQuota?.usage ?? 0);
        const files = await this.files(`${this.inFolder()} and appProperties has { key='pbFormat' and value='1' }`, "size");
        return {
            used: files.reduce((sum, f) => sum + (Number(f.size) || 0), 0),
            available: Number.isFinite(limit) ? Math.max(0, limit - usage) : null,
        };
    }

    async list(panelId: string): Promise<BackupRecord[]> {
        const files = await this.files(`${this.inFolder()} and appProperties has { key='pbPanel' and value=${quote(panelKey(panelId))} }`, "id, description");
        const records: BackupRecord[] = [];
        const unreadable: string[] = [];
        for (const file of files.slice(0, MAX_LISTED_BACKUPS * 2)) {
            let parsed: BackupRecord | null;
            try {
                parsed = parseBackupRecord(JSON.parse(String(file.description ?? "")));
            } catch (err) {
                logger.warn(`[backups] Google Drive file ${file.id} has no readable record:`, err);
                parsed = null;
            }
            if (!parsed) unreadable.push(String(file.id));
            else if (parsed.panelId === panelId) records.push(parsed);
        }
        if (unreadable.length) throw new BackupListingError(unreadable);
        return newestFirst(records);
    }

    async put(record: BackupRecord, archivePath: string): Promise<void> {
        const metadata = {
            name: `${record.id}.pbbackup`,
            parents: [this.settings.folderId],
            mimeType: "application/gzip",
            description: JSON.stringify(record),
            appProperties: { pbFormat: "1", pbPanel: panelKey(record.panelId), pbBackup: record.id },
        };
        const session = expectOk(
            await this.api(
                "/files?uploadType=resumable",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json; charset=UTF-8",
                        "X-Upload-Content-Type": "application/gzip",
                        "X-Upload-Content-Length": String(record.size),
                    },
                    body: JSON.stringify(metadata),
                },
                this.endpoints.uploadBase,
            ),
            "Starting the Google Drive upload",
        );
        const location = session.headers.location;
        if (typeof location !== "string") throw new Error("Google Drive did not start an upload session");
        assertSecureUrl(location, "The Google Drive upload address");
        expectOk(
            await httpRequest(location, {
                method: "PUT",
                headers: { "Content-Type": "application/gzip" },
                bodyFile: { path: archivePath, size: record.size },
                timeoutMs: 120_000,
            }),
            "Uploading the backup to Google Drive",
        );
    }

    async get(record: BackupRecord, destPath: string): Promise<void> {
        const maxFileBytes = backupArchiveDownloadCap(record.size);
        const id = await this.fileId(record);
        expectOk(
            await this.api(`/files/${encodeURIComponent(id)}?alt=media`, { toFile: destPath, maxFileBytes, timeoutMs: 120_000 }),
            "Downloading the backup from Google Drive",
        );
    }

    async remove(record: BackupRecord): Promise<void> {
        const id = await this.fileId(record);
        expectOk(await this.api(`/files/${encodeURIComponent(id)}`, { method: "DELETE" }), "Deleting the backup from Google Drive");
    }
}
