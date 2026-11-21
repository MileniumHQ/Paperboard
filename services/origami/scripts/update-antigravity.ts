// Refreshes the `antigravity` record (the Antigravity CLI `agy` the Agent
// panel drives) to the latest release published by Google's Antigravity CLI
// auto-updater.
//
//   bun run update:antigravity              latest release across all 6 platforms
//   bun run update:antigravity -- --dry-run print, don't write
//
// Paperboard does not host Antigravity. Each platform has a manifest JSON
// pointing at Google Cloud Storage (`antigravity-public/antigravity-cli/...`)
// with a SHA-512 digest:
//   - Linux & macOS: a .tar.gz holding a single `antigravity` executable,
//     placed at `bin/agy` by a `tar` recipe.
//   - Windows: a bare .exe (no archive), placed at `bin/agy.exe` by a `file`
//     recipe.
//
// Trust: the auto-updater manifest is the authority for the release version
// and SHA-512 of every platform asset, and downloads must stay on Google's
// GCS bucket. Every asset is streamed and hashed; a SHA-512 mismatch, host
// mismatch, version skew across platforms, or missing tarball member drops
// the whole record.
import { fetchJson, listTar, memberSet, withStreamedDownload } from "./lib/download";
import { runUpdater, settle } from "./lib/cli";
import {
    assertValidRecord,
    PLATFORM_KEYS,
    type PackageRecipe,
    type PackageRecord,
    type PlatformDownload,
    type PlatformKey,
} from "./lib/records";

export const MANIFEST_BASE = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests";
const EXPECTED_HOST = "storage.googleapis.com";
const EXPECTED_PATH_PREFIX = "/antigravity-public/antigravity-cli/";
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SHA512_RE = /^[a-f0-9]{128}$/;

export interface AntigravityTarget {
    manifest: string;
    recipe: PackageRecipe;
}

export const TARGETS: Record<PlatformKey, AntigravityTarget> = {
    "linux-x64": { manifest: "linux_amd64.json", recipe: { unpack: "tar", take: { "bin/agy": "antigravity" } } },
    "linux-arm64": { manifest: "linux_arm64.json", recipe: { unpack: "tar", take: { "bin/agy": "antigravity" } } },
    "macos-x64": { manifest: "darwin_amd64.json", recipe: { unpack: "tar", take: { "bin/agy": "antigravity" } } },
    "macos-arm64": { manifest: "darwin_arm64.json", recipe: { unpack: "tar", take: { "bin/agy": "antigravity" } } },
    "windows-x64": { manifest: "windows_amd64.json", recipe: { unpack: "file", take: { "bin/agy.exe": "file" } } },
    "windows-arm64": { manifest: "windows_arm64.json", recipe: { unpack: "file", take: { "bin/agy.exe": "file" } } },
};

export interface AntigravityManifest {
    version: string;
    url: string;
    sha512: string;
}

function checkManifest(key: PlatformKey, raw: unknown): AntigravityManifest {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`antigravity/${key}: unexpected manifest response`);
    }
    const { version, url, sha512 } = raw as Record<string, unknown>;
    if (typeof version !== "string" || !VERSION_RE.test(version)) {
        throw new Error(`antigravity/${key}: unexpected version ${JSON.stringify(version)}`);
    }
    if (typeof url !== "string") {
        throw new Error(`antigravity/${key}: missing download url`);
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`antigravity/${key}: unparseable download url ${JSON.stringify(url)}`);
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== EXPECTED_HOST || !parsed.pathname.startsWith(EXPECTED_PATH_PREFIX)) {
        throw new Error(`antigravity/${key}: unexpected download host or path ${JSON.stringify(url)}`);
    }
    const normalized = typeof sha512 === "string" ? sha512.trim().toLowerCase() : "";
    if (!SHA512_RE.test(normalized)) {
        throw new Error(`antigravity/${key}: manifest has no SHA-512`);
    }
    return { version, url, sha512: normalized };
}

export async function buildLatestAntigravityRecord(fetchFn: typeof fetch = fetch): Promise<PackageRecord> {
    const manifests = {} as Record<PlatformKey, AntigravityManifest>;
    await Promise.all(
        PLATFORM_KEYS.map(async (key) => {
            const url = `${MANIFEST_BASE}/${TARGETS[key].manifest}`;
            manifests[key] = checkManifest(key, await fetchJson<unknown>(url, fetchFn));
        }),
    );

    const versions = new Set(PLATFORM_KEYS.map((key) => manifests[key].version));
    if (versions.size !== 1) {
        const detail = PLATFORM_KEYS.map((key) => `${key}=${manifests[key].version}`).join(", ");
        throw new Error(`antigravity platforms are on different versions: ${detail}`);
    }
    const version = manifests["linux-x64"].version;

    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    await Promise.all(
        PLATFORM_KEYS.map(async (key) => {
            const { url, sha512 } = manifests[key];
            const { recipe } = TARGETS[key];
            const file = recipe.unpack === "tar" ? `${key}.tar.gz` : `${key}.exe`;
            platforms[key] = await withStreamedDownload(url, fetchFn, { prefix: "origami-antigravity-", file }, async (download) => {
                if (download.sha512 !== sha512) {
                    throw new Error(`antigravity/${key}: SHA-512 differs from manifest (${download.sha512} !== ${sha512})`);
                }
                if (recipe.unpack === "tar") {
                    const members = memberSet(await listTar(download.path));
                    for (const source of Object.values(recipe.take)) {
                        if (!members.has(source)) {
                            throw new Error(`antigravity/${key}: ${source} is not in the archive`);
                        }
                    }
                }
                return { url, sha256: download.sha256, size: download.size, recipe };
            });
        }),
    );

    const record: PackageRecord = { name: "antigravity", version, platforms };
    assertValidRecord(record);
    return record;
}

if (import.meta.main) {
    runUpdater(async () => [await settle("antigravity", () => buildLatestAntigravityRecord())]);
}
