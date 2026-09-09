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
