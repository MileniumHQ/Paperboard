// S3-compatible backups (AWS S3, Cloudflare R2, MinIO, Backblaze B2): one
// object per archive and one per record, under <prefix><panel dir>/.
// Requests are signed with AWS Signature Version 4; an upload streams the
// archive with an unsigned payload hash over TLS.
import * as crypto from "crypto";
import { panelFilesDirName } from "../storage";
import { logger } from "../logger";
import { assertSecureUrl, expectOk, httpRequest, type HttpRequestInit } from "./http";
import { backupArchiveDownloadCap, BACKUP_ARCHIVE_MAX_BYTES, MAX_LISTED_BACKUPS, newestFirst, parseBackupRecord, type BackupRecord, type BackupStore, type BackupUsage } from "./types";

export interface S3Settings {
    /** https://s3.<region>.amazonaws.com, https://<account>.r2.cloudflarestorage.com */
    endpoint: string;
    region: string;
    bucket: string;
    /** key prefix, "" or ending in "/" */
    prefix: string;
    accessKeyId: string;
    /** bucket in the path instead of the host name (MinIO, most self-hosted) */
    pathStyle: boolean;
}

export interface S3Credentials {
    secretAccessKey: string;
}

const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");
const LIST_PAGES_MAX = 50;

// RFC 3986 encoding, as SigV4 canonicalization requires
export function s3Encode(value: string, keepSlash = false): string {
    const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return keepSlash ? encoded.replace(/%2F/g, "/") : encoded;
}

function hmac(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac("sha256", key).update(data).digest();
}

/** AWS SigV4 Authorization header for a request whose headers are final */
export function signS3Request(input: {
    method: string;
    url: URL;
    headers: Record<string, string>;
    payloadHash: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    amzDate: string;
}): string {
    const dateStamp = input.amzDate.slice(0, 8);
    const lowered: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.headers)) lowered[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
    const signedHeaders = Object.keys(lowered).sort();
    const canonicalQuery = [...input.url.searchParams.entries()]
        .map(([k, v]) => [s3Encode(k), s3Encode(v)])
        .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
    const canonicalPath = input.url.pathname.split("/").map((segment) => s3Encode(decodeURIComponent(segment))).join("/");
    const canonicalRequest = [
        input.method,
        canonicalPath || "/",
        canonicalQuery,
        signedHeaders.map((h) => `${h}:${lowered[h]}\n`).join(""),
        signedHeaders.join(";"),
        input.payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${input.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, crypto.createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), "s3"), "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`;
}

function amzNow(): string {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function xmlValues(xml: string, tag: string): string[] {
    const out: string[] = [];
    const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, "g");
    for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
    return out;
}

export function normalizeS3Prefix(prefix: string): string {
    const trimmed = prefix.replace(/^\/+/, "");
    return trimmed && !trimmed.endsWith("/") ? `${trimmed}/` : trimmed;
}

export class S3BackupStore implements BackupStore {
    private readonly endpoint: URL;
    private readonly prefix: string;

    constructor(
        private readonly settings: S3Settings,
        private readonly credentials: S3Credentials,
    ) {
        this.endpoint = assertSecureUrl(settings.endpoint, "The S3 endpoint");
        this.prefix = normalizeS3Prefix(settings.prefix);
    }

    private objectUrl(key: string, query: Record<string, string> = {}): URL {
        const base = new URL(this.endpoint.origin);
        const encodedKey = key ? s3Encode(key, true) : "";
        if (this.settings.pathStyle) base.pathname = `/${s3Encode(this.settings.bucket)}/${encodedKey}`;
        else {
            base.hostname = `${this.settings.bucket}.${this.endpoint.hostname}`;
            base.pathname = `/${encodedKey}`;
        }
        for (const [k, v] of Object.entries(query)) base.searchParams.set(k, v);
        return base;
    }

    private async send(method: string, url: URL, init: HttpRequestInit & { payloadHash?: string } = {}) {
        const amzDate = amzNow();
        const payloadHash = init.payloadHash ?? EMPTY_SHA256;
        const headers: Record<string, string> = {
            host: url.host,
            "x-amz-content-sha256": payloadHash,
            "x-amz-date": amzDate,
            ...init.headers,
        };
        headers.Authorization = signS3Request({
            method,
            url,
            headers,
            payloadHash,
            region: this.settings.region,
            accessKeyId: this.settings.accessKeyId,
            secretAccessKey: this.credentials.secretAccessKey,
            amzDate,
        });
        return httpRequest(url.toString(), { ...init, method, headers });
    }

    private panelPrefix(panelId: string): string {
        return `${this.prefix}${panelFilesDirName(panelId)}/`;
    }

    private keys(record: BackupRecord): { archive: string; record: string } {
        const base = `${this.panelPrefix(record.panelId)}${record.id}`;
        return { archive: `${base}.pbbackup`, record: `${base}.json` };
    }

    private async listKeys(prefix: string): Promise<{ key: string; size: number }[]> {
        const out: { key: string; size: number }[] = [];
        let token: string | undefined;
        for (let page = 0; page < LIST_PAGES_MAX; page++) {
            const query: Record<string, string> = { "list-type": "2", prefix };
            if (token) query["continuation-token"] = token;
            const res = expectOk(await this.send("GET", this.objectUrl("", query)), "Listing the bucket");
            const xml = res.body.toString("utf8");
            const keys = xmlValues(xml, "Key");
            const sizes = xmlValues(xml, "Size");
            keys.forEach((key, i) => out.push({ key, size: Number(sizes[i] ?? 0) }));
            if (xmlValues(xml, "IsTruncated")[0] !== "true") return out;
            token = xmlValues(xml, "NextContinuationToken")[0];
            if (!token) return out;
        }
        logger.warn(`[backups] the bucket listing stopped after ${LIST_PAGES_MAX} pages`);
        return out;
    }

    async check(): Promise<void> {
        expectOk(await this.send("GET", this.objectUrl("", { "list-type": "2", prefix: this.prefix, "max-keys": "1" })), "Reaching the bucket");
    }

    async usage(): Promise<BackupUsage> {
        const objects = await this.listKeys(this.prefix);
        return { used: objects.reduce((sum, o) => sum + (o.key.endsWith(".pbbackup") ? o.size : 0), 0), available: null };
    }

    async list(panelId: string): Promise<BackupRecord[]> {
        const objects = await this.listKeys(this.panelPrefix(panelId));
        const archives = new Set(objects.filter((o) => o.key.endsWith(".pbbackup")).map((o) => o.key.slice(0, -".pbbackup".length)));
        const recordKeys = objects
            .map((o) => o.key)
            .filter((key) => key.endsWith(".json") && archives.has(key.slice(0, -".json".length)))
            .sort()
            .reverse()
            .slice(0, MAX_LISTED_BACKUPS);
        const records: BackupRecord[] = [];
        for (const key of recordKeys) {
            const res = await this.send("GET", this.objectUrl(key), { maxBytes: 64 * 1024 });
            // a record deleted since the listing is gone, not a failure
            if (res.status === 404) {
                logger.warn(`[backups] record ${key} vanished after the listing`);
                continue;
            }
            expectOk(res, "Reading a backup record");
            try {
                const parsed = parseBackupRecord(JSON.parse(res.body.toString("utf8")));
                if (parsed && parsed.panelId === panelId) records.push(parsed);
            } catch (err) {
                logger.warn(`[backups] record ${key} is not JSON:`, err);
            }
        }
        return newestFirst(records);
    }

    async put(record: BackupRecord, archivePath: string): Promise<void> {
        if (record.size > BACKUP_ARCHIVE_MAX_BYTES) throw new Error("S3 accepts at most 5 GiB in one upload");
        const keys = this.keys(record);
        expectOk(
            await this.send("PUT", this.objectUrl(keys.archive), {
                payloadHash: "UNSIGNED-PAYLOAD",
                headers: { "content-type": "application/gzip" },
                bodyFile: { path: archivePath, size: record.size },
                timeoutMs: 120_000,
            }),
            "Uploading the backup",
        );
        const body = JSON.stringify(record);
        expectOk(
            await this.send("PUT", this.objectUrl(keys.record), {
                payloadHash: crypto.createHash("sha256").update(body).digest("hex"),
                headers: { "content-type": "application/json" },
                body,
            }),
            "Saving the backup record",
        );
    }

    async get(record: BackupRecord, destPath: string): Promise<void> {
        const maxFileBytes = backupArchiveDownloadCap(record.size);
        expectOk(
            await this.send("GET", this.objectUrl(this.keys(record).archive), { toFile: destPath, maxFileBytes, timeoutMs: 120_000 }),
            "Downloading the backup",
        );
    }

    async remove(record: BackupRecord): Promise<void> {
        const keys = this.keys(record);
        expectOk(await this.send("DELETE", this.objectUrl(keys.record)), "Deleting the backup record");
        expectOk(await this.send("DELETE", this.objectUrl(keys.archive)), "Deleting the backup");
    }
}
