import * as fs from "fs";
import { logger } from "./logger";
import * as path from "path";
import * as crypto from "crypto";
import { requirePanelId } from "../../../packages/paperapi/src/panelIdentity";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PAPERBOARD_USER_AGENT } from "./userAgent";

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
        fs.writeFileSync(tmp, data, { encoding: "utf8", mode: options?.mode });
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

    const id = requirePanelId(fallbackId);
    if (record.id !== undefined && requirePanelId(record.id) !== id) {
        throw new Error(`Manifest id "${record.id}" does not match requested panel id "${id}"`);
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

    // NOTE: the `permissions` array was deleted — it was declared,
    // validated, and displayed, but nothing ever dispatched on it, so it
    // taught readers the badges meant something they didn't. Unknown fields
    // like it are dropped here (see the index-signature type above) rather
    // than preserved. Network egress stays declared (`network`) because the
    // panel CSP is actually built from it.

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
export function makeSafeTarFilter(destDir: string): (entryPath: string, entry?: { size?: number; linkpath?: string; type?: string }) => boolean {
    let total = 0;
    let count = 0;
    return (entryPath: string, entry) => {
        total += entry?.size ?? 0;
        if (++count > 100_000 || total > 4 * 1024 * 1024 * 1024) throw new LimitError("Archive exceeds extraction budget");
        if (typeof entryPath !== "string") return false;
        const normalized = path.normalize(entryPath);
        if (path.isAbsolute(normalized)) return false;
        const resolved = path.resolve(destDir, normalized);
        const destWithSep = destDir.endsWith(path.sep)
            ? destDir
            : destDir + path.sep;
        if (entry?.linkpath) {
            const target = path.resolve(entry.type === "SymbolicLink" ? path.dirname(resolved) : destDir, entry.linkpath);
            if (target !== destDir && !target.startsWith(destWithSep)) throw new Error("Archive link escapes destination");
        }
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
    limits: { maxBytes?: number; idleMs?: number; totalMs?: number } = {},
): Promise<{ sha1: string; sha256: string }> {
    onProgress?.({ stage: "starting", percent: 0, message: "Connecting..." });

    if (activeDownloads >= 8) throw new LimitError("Too many concurrent downloads (max 8)");
    activeDownloads++;
    const controller = new AbortController();
    const idleMs = limits.idleMs ?? 45_000;
    let idle = setTimeout(() => controller.abort(new Error("Download connection timed out")), idleMs);
    const lifetime = setTimeout(() => controller.abort(new Error("Download exceeded lifetime deadline")), limits.totalMs ?? 30 * 60_000);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": PAPERBOARD_USER_AGENT },
        });
        if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
        const totalBytes = Number(res.headers.get("content-length")) || 0;
        const cap = limits.maxBytes ?? 2 * 1024 * 1024 * 1024;
        if (totalBytes > cap) throw new LimitError("Download exceeds 2 GiB cap");
        let loadedBytes = 0;
        const sha1 = crypto.createHash("sha1");
        const sha256 = crypto.createHash("sha256");
        await fs.promises.mkdir(path.dirname(tempFilePath), { recursive: true });
        const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            clearTimeout(idle);
            idle = setTimeout(() => controller.abort(new Error("Download stalled")), idleMs);
            loadedBytes += chunk.length;
            if (loadedBytes > cap) { callback(new LimitError("Download exceeds 2 GiB cap")); return; }
            sha1.update(chunk); sha256.update(chunk);
            try {
                onProgress?.({ stage: "downloading", percent: totalBytes ? Math.min(99, Math.round(loadedBytes / totalBytes * 100)) : 50, bytesLoaded: loadedBytes, bytesTotal: totalBytes });
                callback(null, chunk);
            } catch (err) { callback(err as Error); }
        } });
        await pipeline(Readable.fromWeb(res.body as any), meter, fs.createWriteStream(tempFilePath), { signal: controller.signal });
        const actualSha1 = sha1.digest("hex");
        const actualSha256 = sha256.digest("hex");
        if (expectedSha1 && actualSha1 !== expectedSha1.toLowerCase()) throw new Error("SHA1 mismatch");
        if (expectedSha256 && actualSha256 !== expectedSha256.toLowerCase()) throw new Error("SHA256 mismatch");
        return { sha1: actualSha1, sha256: actualSha256 };
    } catch (err) {
        controller.abort();
        await fs.promises.rm(tempFilePath, { force: true });
        throw err;
    } finally {
        clearTimeout(idle); clearTimeout(lifetime);
        activeDownloads--;
    }
}
let activeDownloads = 0;

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
