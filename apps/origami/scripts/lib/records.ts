// Package records for the PACKAGES namespace, written by the operator's
// updater scripts (never by a worker route). The daemon consumes these in
// papercrane/engine.ts: it installs platforms[<os>-<arch>] and refuses any
// entry without a sha256.

export const PLATFORM_KEYS = [
    "linux-x64",
    "linux-arm64",
    "macos-x64",
    "macos-arm64",
    "windows-x64",
    "windows-arm64",
] as const;

export type PlatformKey = (typeof PLATFORM_KEYS)[number];

/**
 * How the archive maps onto the installed package directory. Must match
 * PACKAGE_LAYOUTS in apps/paperboard/papercrane/engineArchives.ts.
 * - wrapped (default): one top-level wrapper dir around bin/ (JDKs)
 * - root: the archive root is the package root and holds bin/
 * - bin: the archive root is the package's bin/ directory
 */
export type PackageLayout = "wrapped" | "root" | "bin";

export interface PlatformDownload {
    url: string;
    sha256: string;
    size?: number;
    layout?: PackageLayout;
    // offline release-key signature over (name, version, platform, sha256);
    // added at write time by kv.putRecord, verified by every daemon
    signature?: string;
}

export interface PackageRecord {
    name: string;
    version: string;
    platforms: Partial<Record<PlatformKey, PlatformDownload>>;
}

const SHA256_RE = /^[a-f0-9]{64}$/;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Throws on the first defect; a record that fails here is never written. */
export function assertValidRecord(record: PackageRecord): void {
    if (!NAME_RE.test(record.name)) {
        throw new Error(`invalid package name ${JSON.stringify(record.name)}`);
    }
    if (typeof record.version !== "string" || !record.version.trim()) {
        throw new Error(`${record.name}: missing version`);
    }
    const entries = Object.entries(record.platforms);
    if (entries.length === 0) {
        throw new Error(`${record.name}: no platforms`);
    }
    for (const [key, dl] of entries) {
        if (!(PLATFORM_KEYS as readonly string[]).includes(key)) {
            throw new Error(`${record.name}: unknown platform key ${key}`);
        }
        if (!dl) continue;
        let url: URL;
        try {
            url = new URL(dl.url);
        } catch {
            throw new Error(`${record.name}/${key}: unparseable url ${JSON.stringify(dl.url)}`);
        }
        if (url.protocol !== "https:") {
            throw new Error(`${record.name}/${key}: url must be https`);
        }
        if (!SHA256_RE.test(dl.sha256)) {
            throw new Error(`${record.name}/${key}: missing or malformed sha256`);
        }
    }
}

export async function fetchJson<T>(
    url: string,
    fetchFn: typeof fetch = fetch,
    headers: Record<string, string> = {},
): Promise<T> {
    const res = await fetchFn(url, {
        headers: {
            "User-Agent": "Origami-Package-Updater/2.0",
            Accept: "application/json",
            ...headers,
        },
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
}

export async function fetchText(
    url: string,
    fetchFn: typeof fetch = fetch,
): Promise<string> {
    const res = await fetchFn(url, {
        headers: { "User-Agent": "Origami-Package-Updater/2.0" },
        signal: AbortSignal.timeout(30_000),
        redirect: "follow",
    });
    if (!res.ok) {
        throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
}
