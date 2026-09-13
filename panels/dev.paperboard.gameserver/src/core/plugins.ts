import type { ServerSoftwareType } from "../lib/software";

export interface InstalledRecord {
    projectId: string;
    slug: string;
    version: string;
    iconUrl?: string;
}

export interface InstalledPlugin {
    filename: string;
    record?: InstalledRecord;
}

export const INSTALL_RECORDS_KEY = "pluginInstalls";

export function pluginDirName(software: ServerSoftwareType): string {
    return software === "fabric" ? "mods" : "plugins";
}

export function isInstallRecord(value: unknown): value is InstalledRecord {
    if (typeof value !== "object" || value === null) return false;
    const rec = value as Record<string, unknown>;
    return (
        typeof rec.projectId === "string" &&
        typeof rec.slug === "string" &&
        typeof rec.version === "string" &&
        (rec.iconUrl === undefined || typeof rec.iconUrl === "string")
    );
}

export function parseInstallRecords(raw: unknown): Record<string, InstalledRecord> {
    if (typeof raw !== "object" || raw === null) return {};
    const records: Record<string, InstalledRecord> = {};
    for (const [filename, value] of Object.entries(raw as Record<string, unknown>)) {
        if (isInstallRecord(value)) records[filename] = value;
    }
    return records;
}

export function validatePluginFilename(filename: string): string {
    const trimmed = filename.trim();
    // strict jar names only, without importing filesystem
    const ok =
        /^[A-Za-z0-9][A-Za-z0-9._ ()-]*$/.test(trimmed) &&
        !trimmed.includes("..") &&
        trimmed.toLowerCase().endsWith(".jar");
    if (!ok) {
        throw new Error(`Refusing to delete unsafe path: "${filename}"`);
    }
    return trimmed;
}

export interface PluginCollectDeps {
    records: Record<string, InstalledRecord>;
    listingEntries: string[];
    exists: (path: string) => Promise<boolean>;
    sanitize: (name: string) => string | null;
    dirName: string;
    onVerifyError?: (filename: string, err: unknown) => void;
}
// install records are primary truth, listing adds untracked jars
export async function collectInstalledPlugins(deps: PluginCollectDeps): Promise<InstalledPlugin[]> {
    const { records, listingEntries, exists, sanitize, dirName, onVerifyError } = deps;
    const byFile = new Map<string, InstalledPlugin>();

    for (const [filename, record] of Object.entries(records)) {
        let found = false;
        try {
            found = await exists(`${dirName}/${filename}`);
        } catch (err) {
            onVerifyError?.(filename, err);
        }
        if (!found) continue;
        byFile.set(filename, { filename, record });
    }

    for (const entry of listingEntries) {
        if (!entry.toLowerCase().endsWith(".jar")) continue;
        const safe = sanitize(entry);
        if (!safe || byFile.has(safe)) continue;
        byFile.set(safe, { filename: safe, record: records[safe] });
    }

    return [...byFile.values()].sort((a, b) => a.filename.localeCompare(b.filename));
}

// ─── Modrinth version selection (pure) ───────────────────────────────────────
// The network layer fetches two lists: versions filtered to the server's MC
// version ("exact"), and unfiltered loader builds ("fallback"). Selection is
// pure so the fallback path stays testable: a non-exact pick never installs
// silently, it returns exactMatch:false and the caller must confirm.

export interface ModrinthVersionFile {
    url?: string;
    filename?: string;
    primary?: boolean;
    hashes?: { sha1?: string; sha512?: string };
}

export interface ModrinthVersion {
    version_number?: string;
    versionNumber?: string;
    game_versions?: string[];
    gameVersions?: string[];
    files?: ModrinthVersionFile[];
}

export interface VersionPick {
    url: string;
    filename: string;
    versionNumber: string;
    sha1?: string;
    sha512?: string;
    gameVersions: string[];
    exactMatch: boolean;
}

function firstDownloadable(versions: ModrinthVersion[]): Omit<VersionPick, "exactMatch"> | null {
    const latest = versions[0];
    const primary = latest?.files?.find((f) => f.primary) ?? latest?.files?.[0];
    if (!primary?.url || !primary?.filename) return null;
    return {
        url: primary.url,
        filename: primary.filename,
        versionNumber: latest.version_number ?? latest.versionNumber ?? "",
        sha1: primary.hashes?.sha1,
        sha512: primary.hashes?.sha512,
        gameVersions: Array.isArray(latest.game_versions)
            ? (latest.game_versions as string[])
            : Array.isArray(latest.gameVersions)
              ? (latest.gameVersions as string[])
              : [],
    };
}

export function pickVersionFile(
    exactVersions: ModrinthVersion[],
    fallbackVersions: ModrinthVersion[],
): VersionPick {
    const exact = firstDownloadable(exactVersions);
    if (exact) return { ...exact, exactMatch: true };
    const fallback = firstDownloadable(fallbackVersions);
    if (fallback) return { ...fallback, exactMatch: false };
    throw new Error("No downloadable file on the latest version");
}
