import { fileApi, config } from "@paperboard-dev/paperapi";
import { serverSoftware, serverVersion, updatePanelConfig } from "./server";
import type { ServerSoftwareType } from "./software";
import { sanitizeFileName, tryListDirectory } from "./filesystem";

const MODRINTH_API = "https://api.modrinth.com/v2";
const SEARCH_LIMIT = 24;

// Fabric mods live in mods/, everything else (Paper plugins) in plugins/.
export function pluginDirName(software: ServerSoftwareType): string {
    return software === "fabric" ? "mods" : "plugins";
}

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

// ─── Local installation state ───────────────────────────────────────────────

const INSTALL_RECORDS_KEY = "pluginInstalls";

function isInstallRecord(value: unknown): value is InstalledRecord {
    if (typeof value !== "object" || value === null) return false;
    const rec = value as Record<string, unknown>;
    return (
        typeof rec.projectId === "string" &&
        typeof rec.slug === "string" &&
        typeof rec.version === "string" &&
        (rec.iconUrl === undefined || typeof rec.iconUrl === "string")
    );
}

export async function getInstallRecords(): Promise<Record<string, InstalledRecord>> {
    try {
        const saved = await config.get<Record<string, unknown>>();
        const raw = saved?.[INSTALL_RECORDS_KEY];
        if (typeof raw !== "object" || raw === null) return {};
        const records: Record<string, InstalledRecord> = {};
        for (const [filename, value] of Object.entries(raw)) {
            if (isInstallRecord(value)) records[filename] = value;
        }
        return records;
    } catch (err) {
        console.error("[Plugins] Failed to read install records:", err);
        return {};
    }
}

async function writeInstallRecords(
    records: Record<string, InstalledRecord>,
): Promise<void> {
    await updatePanelConfig({ [INSTALL_RECORDS_KEY]: records });
}

// Install records are the primary source of truth; the listing only finds untracked jars
export async function listInstalledPlugins(): Promise<{
    plugins: InstalledPlugin[];
    warning?: string;
}> {
    const dirName = pluginDirName(serverSoftware());
    const [records, listing] = await Promise.all([
        getInstallRecords(),
        tryListDirectory(dirName),
    ]);

    const byFile = new Map<string, InstalledPlugin>();

    for (const [filename, record] of Object.entries(records)) {
        let exists = false;
        try {
            exists = await fileApi.exists(`${dirName}/${filename}`);
        } catch (err) {
            console.error(
                `[Plugins] Failed to verify "${dirName}/${filename}":`,
                err,
            );
        }
        if (!exists) continue;
        byFile.set(filename, { filename, record });
    }

    if (listing.error) {
        console.warn(`[Plugins] ${listing.error} Raw entries: none available.`);
    }
    for (const entry of listing.entries) {
        if (!entry.toLowerCase().endsWith(".jar")) continue;
        const safe = sanitizeFileName(entry);
        if (!safe || byFile.has(safe)) continue;
        byFile.set(safe, { filename: safe, record: records[safe] });
    }

    return {
        plugins: [...byFile.values()].sort((a, b) =>
            a.filename.localeCompare(b.filename),
        ),
        warning: listing.error,
    };
}

export async function deletePlugin(filename: string): Promise<void> {
    const safe = sanitizeFileName(filename);
    if (!safe || !safe.toLowerCase().endsWith(".jar")) {
        throw new Error(`Refusing to delete unsafe path: "${filename}"`);
    }
    await fileApi.delete(`${pluginDirName(serverSoftware())}/${safe}`);
    const records = await getInstallRecords();
    if (records[safe]) {
        delete records[safe];
        await writeInstallRecords(records);
    }
}

// ─── Modrinth API ───────────────────────────────────────────────────────────

export interface ModrinthHit {
    projectId: string;
    slug: string;
    title: string;
    description: string;
    downloads: number;
    follows: number;
    iconUrl?: string;
}

export interface ModrinthProject {
    projectId: string;
    slug: string;
    title: string;
    description: string;
    body: string;
    downloads: number;
    follows: number;
    loaders: string[];
    license: string;
    dateModified: string;
    iconUrl?: string;
}

export interface ResolvedDownload {
    url: string;
    filename: string;
    versionNumber: string;
}

interface RawHit {
    project_id?: string;
    slug?: string;
    title?: string;
    description?: string;
    downloads?: number;
    follows?: number;
    icon_url?: string;
}

interface RawProject {
    id?: string;
    slug?: string;
    title?: string;
    description?: string;
    body?: string;
    downloads?: number;
    follows?: number;
    loaders?: string[];
    license?: { id?: string; name?: string; url?: string };
    modified?: number;
    icon_url?: string;
}

interface RawVersion {
    version_number?: string;
    files?: { url?: string; filename?: string; primary?: boolean }[];
}

// Read the body as text first so non-JSON answers fail with a clear message
async function modrinthFetch<T>(
    path: string,
    params?: Record<string, string>,
): Promise<T> {
    const query = params
        ? `?${new URLSearchParams(params).toString()}`
        : "";
    const res = await fetch(`${MODRINTH_API}${path}${query}`);
    const text = await res.text();

    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(
            `Modrinth returned a non-JSON response (HTTP ${res.status})`,
        );
    }

    if (!res.ok) {
        const description =
            typeof data === "object" &&
            data !== null &&
            "description" in data &&
            typeof (data as { description: unknown }).description === "string"
                ? (data as { description: string }).description
                : `HTTP ${res.status}`;
        throw new Error(`Modrinth request failed: ${description}`);
    }

    return data as T;
}

export interface EcosystemInfo {
    projectType: "plugin" | "mod";
    loaderCategory: string;
    kind: "plugin" | "mod";
}

// Paper consumes plugins ("paper" loader), Fabric consumes mods ("fabric")
export function getEcosystem(software: ServerSoftwareType): EcosystemInfo | null {
    switch (software) {
        case "paper":
            return { projectType: "plugin", loaderCategory: "paper", kind: "plugin" };
        case "fabric":
            return { projectType: "mod", loaderCategory: "fabric", kind: "mod" };
        default:
            return null;
    }
}

// Search restricted to the installed loader; facets are raw JSON strings
export async function searchModrinth(query: string): Promise<ModrinthHit[]> {
    const eco = getEcosystem(serverSoftware());
    if (!eco) return [];

    const facets = JSON.stringify([
        [`project_type:${eco.projectType}`],
        [`categories:${eco.loaderCategory}`],
    ]);

    const data = await modrinthFetch<{ hits?: RawHit[] }>("/search", {
        query,
        limit: String(SEARCH_LIMIT),
        facets,
    });

    const hits: ModrinthHit[] = [];
    for (const hit of data.hits ?? []) {
        if (!hit.project_id || !hit.slug || !hit.title) continue;
        hits.push({
            projectId: hit.project_id,
            slug: hit.slug,
            title: hit.title,
            description: hit.description ?? "",
            downloads: typeof hit.downloads === "number" ? hit.downloads : 0,
            follows: typeof hit.follows === "number" ? hit.follows : 0,
            iconUrl: hit.icon_url || undefined,
        });
    }
    return hits;
}

export async function getProject(projectIdOrSlug: string): Promise<ModrinthProject> {
    const data = await modrinthFetch<RawProject>(
        `/project/${encodeURIComponent(projectIdOrSlug)}`,
    );
    if (!data.id || !data.slug || !data.title) {
        throw new Error("Modrinth returned an incomplete project");
    }
    const licenseName =
        data.license?.name ||
        (data.license?.id ? data.license.id.toUpperCase() : undefined) ||
        data.license?.url ||
        "Unknown";
    return {
        projectId: data.id,
        slug: data.slug,
        title: data.title,
        description: data.description ?? "",
        body: data.body ?? "",
        downloads: typeof data.downloads === "number" ? data.downloads : 0,
        follows: typeof data.follows === "number" ? data.follows : 0,
        loaders: Array.isArray(data.loaders) ? data.loaders : [],
        license: licenseName,
        dateModified: data.modified
            ? new Date(data.modified).toISOString()
            : "",
        iconUrl: data.icon_url || undefined,
    };
}

// Newest file matching the MC version, falling back to any loader build
async function resolveLatestFile(projectId: string): Promise<ResolvedDownload> {
    const software = serverSoftware();
    const loader = software === "fabric" ? "fabric" : "paper";
    const mcVersion = serverVersion();

    const loaders = JSON.stringify([loader]);
    let versions: RawVersion[] = [];

    if (mcVersion) {
        try {
            versions = await modrinthFetch<RawVersion[]>(
                `/project/${encodeURIComponent(projectId)}/version`,
                { loaders, game_versions: JSON.stringify([mcVersion]) },
            );
        } catch (err) {
            console.error("[Plugins] Game-version lookup failed:", err);
        }
    }

    if (versions.length === 0) {
        versions = await modrinthFetch<RawVersion[]>(
            `/project/${encodeURIComponent(projectId)}/version`,
            { loaders },
        );
    }

    const latest = versions[0];
    const primary = latest?.files?.find((f) => f.primary) ?? latest?.files?.[0];
    if (!primary?.url || !primary?.filename) {
        throw new Error("No downloadable file on the latest version");
    }
    return {
        url: primary.url,
        filename: primary.filename,
        versionNumber: latest.version_number ?? "",
    };
}

export async function installProject(
    projectId: string,
): Promise<{ filename: string; version: string }> {
    const file = await resolveLatestFile(projectId);
    const safe = sanitizeFileName(file.filename);
    if (!safe || !safe.toLowerCase().endsWith(".jar")) {
        throw new Error(`Unsafe download filename: "${file.filename}"`);
    }

    await fileApi.download({
        url: file.url,
        targetPath: `${pluginDirName(serverSoftware())}/${safe}`,
    });

    // Remember which project this jar belongs to for icons and versions
    try {
        const project = await getProject(projectId);
        const records = await getInstallRecords();
        records[safe] = {
            projectId: project.projectId,
            slug: project.slug,
            version: file.versionNumber || "latest",
            iconUrl: project.iconUrl,
        };
        await writeInstallRecords(records);
    } catch (err) {
        console.error("[Plugins] Failed to record install metadata:", err);
    }

    return { filename: safe, version: file.versionNumber };
}
