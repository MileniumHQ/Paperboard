import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Atomic JSON persistence ─────────────────────────────────────────────────

// Writes a file atomically: data lands in a temp file first, then is renamed
// over the target so a crash mid-write can never corrupt existing state.
export async function writeFileAtomic(
    filePath: string,
    data: string,
): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
        await fs.promises.writeFile(tmp, data, "utf8");
        await fs.promises.rename(tmp, filePath);
    } catch (err) {
        try {
            if (fs.existsSync(tmp)) await fs.promises.unlink(tmp);
        } catch {}
        throw err;
    }
}

export function writeJsonAtomicSync(
    filePath: string,
    value: unknown,
): void {
    writeFileAtomicSync(filePath, JSON.stringify(value, null, 2));
}

export function writeFileAtomicSync(
    filePath: string,
    data: string,
): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
        fs.writeFileSync(tmp, data, "utf8");
        fs.renameSync(tmp, filePath);
    } catch (err) {
        try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch {}
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
    } catch {}
    return fallback;
}

// ─── Path containment ────────────────────────────────────────────────────────

const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

// Sanitizes a panel/package/app id so it can never escape its base directory.
// Returns null for ids that contain traversal or unsafe characters.
export function sanitizeId(id: string | undefined | null): string | null {
    if (!id || typeof id !== "string") return null;
    if (!SAFE_ID_RE.test(id)) return null;
    if (id.startsWith(".")) return null;
    return id;
}

// Resolves a relative target path inside an isolated per-app directory,
// rejecting any traversal outside it. The separator is included in the prefix
// check so sibling directories like `<base>-evil` are rejected too.
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

// Validates and normalizes a panel manifest coming from disk or the registry.
// Throws on structurally invalid input; the returned manifest only contains
// known-safe fields with bounded lengths.
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

    // `base` must be a relative path — absolute paths would let a manifest
    // point the panel origin at arbitrary filesystem locations.
    const base = str(record.base, 256);
    if (base) {
        if (path.isAbsolute(base) || base.split(/[\\/]/).includes("..")) {
            throw new Error(`Invalid base path in manifest for ${id}`);
        }
        manifest.base = base;
    }

    return manifest;
}

// Lenient validation for registry index records where most fields are optional
// and untrusted values simply fall back to safe defaults instead of throwing.
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

// Filter factory for tar extraction: rejects absolute paths and traversal
// members so a malicious archive cannot write outside destDir even if the
// underlying library's own protections ever change.
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

// Streams a URL to a file with progress callbacks and optional SHA verification.
// Writes to tempFilePath; caller moves it into place after this resolves.
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
    while (true) {
        // Idle guard: a stalled connection must fail loudly instead of
        // hanging an unnamed download forever.
        const readResult = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new Error("Download stalled: no data for 45s")),
                    IDLE_TIMEOUT_MS,
                ),
            ),
        ]);
        const { done, value } = readResult as any;
        if (done) break;
        if (!value) continue;

        fileStream.write(value);
        sha1Hash.update(value);
        sha256Hash.update(value);
        loadedBytes += value.length;

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
