import * as fs from "fs";
import { logger } from "./logger";
import * as path from "path";
import * as crypto from "crypto";

// one-shot timers must never hold the process open: unref and move on.
// (bun and node both expose unref on Timeout handles)
export function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    (timer as unknown as { unref?: () => void }).unref?.();
}

// supervisor metadata lands on disk beside the socket: env values whose
// names look like secrets never land with their values
const SECRET_ENV_RE = /TOKEN|SECRET|KEY/i;
const REDACTED = "[redacted]";
export function redactEnvValues(
    env: Record<string, string | undefined> | undefined,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(env ?? {})) {
        out[k] = SECRET_ENV_RE.test(k) ? REDACTED : String(v ?? "");
    }
    return out;
}

// size-limit refusal thrown by engine-level code (file reads, config
// writes). Carries a wire code so the RPC layer maps it without
// message-text matching — see rpcErrorCode in rpc/params.ts.
export class LimitError extends Error {
    readonly code = "INVALID_PARAMS";
    constructor(message: string) {
        super(message);
        this.name = "LimitError";
    }
}

// ─── Atomic JSON persistence ─────────────────────────────────────────────────

// Serializes concurrent writes to the same path
const writeQueues = new Map<string, Promise<void>>();

// Writes a file atomically via temp plus rename
export function writeFileAtomic(
    filePath: string,
    data: string,
): Promise<void> {
    const prev = writeQueues.get(filePath) || Promise.resolve();
    const current = prev
        .catch((err) => logger.debug("[storage] previous queued write failed:", err))
        .then(async () => {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const nonce = crypto.randomBytes(6).toString("hex");
            const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${nonce}`;
            try {
                await fs.promises.writeFile(tmp, data, "utf8");
                await fs.promises.rename(tmp, filePath);
            } catch (err) {
                try {
                    if (fs.existsSync(tmp)) await fs.promises.unlink(tmp);
                } catch (err) { logger.debug("[storage.ts] op failed:", err) }
                throw err;
            }
        })
        .finally(() => {
            if (writeQueues.get(filePath) === current) {
                writeQueues.delete(filePath);
            }
        });

    writeQueues.set(filePath, current);
    return current;
}

export function writeJsonAtomicSync(
    filePath: string,
    value: unknown,
    options?: { mode?: number },
): void {
    writeFileAtomicSync(filePath, JSON.stringify(value, null, 2), options);
}

export function writeFileAtomicSync(
    filePath: string,
    data: string,
    options?: { mode?: number },
): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const nonce = crypto.randomBytes(6).toString("hex");
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${nonce}`;
    try {
        fs.writeFileSync(tmp, data, "utf8");
        // the temp becomes the file, so requested mode applies at birth
        if (options?.mode !== undefined) fs.chmodSync(tmp, options.mode);
        fs.renameSync(tmp, filePath);
    } catch (err) {
        try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch (cleanupErr) {
            console.error(`[storage] failed to clean tmp artifact ${tmp}:`, cleanupErr);
        }
        throw err;
    }
}

export function writeJsonAtomic(
    filePath: string,
    value: unknown,
): Promise<void> {
    return writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

export function readJsonFileSync<T>(filePath: string, fallback: T): T {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
        }
    } catch (err) { logger.debug("[storage.ts] op failed:", err) }
    return fallback;
}

// ─── Path containment ────────────────────────────────────────────────────────

const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

// Sanitizes an id so it can never escape its base directory
export function sanitizeId(id: string | undefined | null): string | null {
    if (!id || typeof id !== "string") return null;
    if (!SAFE_ID_RE.test(id)) return null;
    if (id.startsWith(".")) return null;
    return id;
}

// Directory name for a panel home under files/, dots preserved
export function panelFilesDirName(id: string | undefined | null): string {
    if (!id || typeof id !== "string") return "default";
    return id.replace(/[^a-zA-Z0-9_.-]/g, "_") || "default";
}

// Resolve a relative path inside an isolated dir, rejecting traversal
export function resolveSecureTargetPath(
    baseDir: string,
    targetPath: string,
    appId?: string,
): string {
    const cleanAppId = appId
        ? appId.replace(/[^a-zA-Z0-9_.-]/g, "_")
        : "default";
    const base = path.join(baseDir, cleanAppId);
    const resolved = path.resolve(base, String(targetPath).replace(/^[/\\]+/, ""));
    const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
    if (resolved !== base && !resolved.startsWith(baseWithSep)) {
        throw new Error(
            `Access denied: path traverses outside assigned storage for ${cleanAppId}`,
        );
    }
    return resolved;
}

// ─── Manifest validation ─────────────────────────────────────────────────────

export interface PanelManifestLike {
    id: string;
    name: string;
    description?: string;
    version?: string;
    publisher?: string;
    icon?: string;
    base?: string;
    permissions?: string[];
    [key: string]: unknown;
}

function str(v: unknown, maxLen = 512): string | undefined {
    if (typeof v !== "string") return undefined;
    return v.slice(0, maxLen);
}

// Validates a panel manifest, returning only known-safe bounded fields
export function validatePanelManifest(
    raw: unknown,
    fallbackId: string,
): PanelManifestLike {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Invalid panel manifest: expected object");
    }
    const record = raw as Record<string, unknown>;

    const id = sanitizeId(str(record.id, 128)) ?? sanitizeId(fallbackId);
    if (!id) {
        throw new Error(`Invalid panel id in manifest for ${fallbackId}`);
    }

    const name =
        str(record.name, 128) ||
        str(record.title, 128) ||
        fallbackId;

    const manifest: PanelManifestLike = { id, name };

    const description = str(record.description, 2048);
    if (description) manifest.description = description;

    const version = str(record.version, 32);
    if (version) manifest.version = version;

    const publisher =
        str(record.publisher, 128) || str(record.author, 128);
    if (publisher) manifest.publisher = publisher;

    const icon = str(record.icon, 256);
    if (icon) manifest.icon = icon;

    // `base` must stay relative, never an absolute or parent escape
    const base = str(record.base, 256);
    if (base) {
        if (path.isAbsolute(base) || base.split(/[\\/]/).includes("..")) {
            throw new Error(`Invalid base path in manifest for ${id}`);
        }
        manifest.base = base;
    }

    const service = str(record.service, 256);
    if (service) {
        if (path.isAbsolute(service) || service.split(/[\\/]/).includes("..")) {
            throw new Error(`Invalid service path in manifest for ${id}`);
        }
        manifest.service = service;
    }

    if (typeof record.autostart === "boolean") {
        manifest.autostart = record.autostart;
    }

    // network egress declaration: bounded host list or any-https mode.
    // factual clip here; interpretation lives in panelNet
    if (record.network && typeof record.network === "object" && !Array.isArray(record.network)) {
        // TODO(remove after v3.1): legacy unpackaged panels may surface raw
        // network shapes; importing keeps manifests reviewable via one path
        manifest.network = record.network;
    }

    // declared capability labels: factual clip here (bounded count and
    // length); review reads them, the install dialog surfaces them, and
    // registry-open enforcement will dispatch on them. Nothing here
    // grants anything — it only preserves what the manifest declares.
    if (Array.isArray(record.permissions)) {
        const perms = record.permissions
            .filter((p): p is string => typeof p === "string")
            .map((p) => p.slice(0, 64))
            .slice(0, 64);
        if (perms.length > 0) manifest.permissions = perms;
    }

    return manifest;
}

// Lenient registry validation, bad values fall back to defaults
export function coerceRegistryRecord(
    raw: unknown,
    fallbackId: string,
): Record<string, unknown> {
    const record =
        raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
    const id = sanitizeId(str(record.id, 128)) ?? fallbackId;
    return {
        id,
        name: str(record.name, 128) || id,
        description: str(record.description, 2048),
        version: str(record.version, 32),
        publisher: str(record.publisher, 128),
        author: str(record.author, 128),
        icon: str(record.icon, 256),
        iconUrl: str(record.iconUrl, 1024),
        downloadUrl: str(record.downloadUrl, 2048),
        sha256: str(record.sha256, 64),
        updatedAt: str(record.updatedAt, 64),
    };
}

// ─── Archive safety ──────────────────────────────────────────────────────────

// Tar filter rejecting absolute paths and traversal members
export function makeSafeTarFilter(destDir: string): (entryPath: string) => boolean {
    return (entryPath: string) => {
        if (typeof entryPath !== "string") return false;
        const normalized = path.normalize(entryPath);
        if (path.isAbsolute(normalized)) return false;
        const resolved = path.resolve(destDir, normalized);
        const destWithSep = destDir.endsWith(path.sep)
            ? destDir
            : destDir + path.sep;
        return resolved.startsWith(destWithSep);
    };
}

// ─── Downloads ───────────────────────────────────────────────────────────────

export interface DownloadProgressPayload {
    stage:
        | "starting"
        | "checking"
        | "downloading"
        | "verifying"
        | "extracting"
        | "completed"
        | "error";
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}

export type ProgressCallback = (payload: DownloadProgressPayload) => void;

// Streams a URL to a file with progress and optional SHA check
export async function streamToFileWithProgress(
    url: string,
    tempFilePath: string,
    onProgress?: ProgressCallback,
    expectedSha1?: string,
    expectedSha256?: string,
): Promise<{ sha1: string; sha256: string }> {
    onProgress?.({ stage: "starting", percent: 0, message: "Connecting..." });

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to download from ${url} (HTTP ${res.status})`);
    }
    if (!res.body) {
        throw new Error("No response body available for download");
    }

    const totalBytes = Number(res.headers.get("content-length")) || 0;
    let loadedBytes = 0;

    const dir = path.dirname(tempFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const fileStream = fs.createWriteStream(tempFilePath);
    const sha1Hash = crypto.createHash("sha1");
    const sha256Hash = crypto.createHash("sha256");

    const reader = res.body.getReader();
    const IDLE_TIMEOUT_MS = 45_000;
    const MAX_DOWNLOAD_BYTES = 2048 * 1024 * 1024; // per-download cap
    let idleTick: ReturnType<typeof setTimeout>;
    while (true) {
        // stalled connections fail loudly instead of hanging forever; the
        // timer is cleared per iteration, not stacked per chunk
        const readResult = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
                idleTick = setTimeout(
                    () => reject(new Error("Download stalled: no data for 45s")),
                    IDLE_TIMEOUT_MS,
                );
            }),
        ]).finally(() => clearTimeout(idleTick));
        const { done, value } = readResult as any;
        if (done) break;
        if (!value) continue;

        // cap total bytes even when the host lies about content-length
        loadedBytes += value.length;
        if (loadedBytes > MAX_DOWNLOAD_BYTES) {
            fs.rmSync(tempFilePath, { force: true });
            throw new Error(`Download exceeds ${MAX_DOWNLOAD_BYTES} byte cap`);
        }

        fileStream.write(value);
        sha1Hash.update(value);
        sha256Hash.update(value);

        const percent =
            totalBytes > 0 ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100)) : 50;
        onProgress?.({
            stage: "downloading",
            percent,
            bytesLoaded: loadedBytes,
            bytesTotal: totalBytes,
        });
    }
    await new Promise<void>((resolve) => fileStream.end(resolve));

    const actualSha1 = sha1Hash.digest("hex").toLowerCase();
    const actualSha256 = sha256Hash.digest("hex").toLowerCase();

    if (expectedSha1 && actualSha1 !== expectedSha1.toLowerCase()) {
        throw new Error(`SHA1 mismatch. Expected ${expectedSha1}, got ${actualSha1}`);
    }
    if (expectedSha256 && actualSha256 !== expectedSha256.toLowerCase()) {
        fs.rmSync(tempFilePath, { force: true });
        throw new Error(
            `SHA256 mismatch. Expected ${expectedSha256}, got ${actualSha256}`,
        );
    }

    return { sha1: actualSha1, sha256: actualSha256 };
}

// Safely moves a file across filesystems or partitions
export async function moveFileSafe(src: string, dest: string): Promise<void> {
    try {
        await fs.promises.rename(src, dest);
    } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "EXDEV") {
            await fs.promises.copyFile(src, dest);
            await fs.promises.unlink(src);
        } else {
            throw err;
        }
    }
}
