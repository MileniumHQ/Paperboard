import { fileApi, config } from "@paperboard-dev/paperapi";
import { PANEL_ID } from "../service/types";
import { serverSoftware, serverVersion, updatePanelConfig, serverBridge } from "./server";
import { ACTION_IDS } from "../service/contract";
import type { ServerSoftwareType } from "./software";
import { sanitizeFileName } from "./filesystem";
import {
    INSTALL_RECORDS_KEY,
    isInstallRecord,
    parseInstallRecords,
    pickVersionFile,
    pluginDirName,
    validatePluginFilename,
} from "../core/plugins";
import type { InstalledPlugin, InstalledRecord } from "../core/plugins";

export type { InstalledPlugin, InstalledRecord };
export { INSTALL_RECORDS_KEY, isInstallRecord, pluginDirName, validatePluginFilename };

const MODRINTH_API = "https://api.modrinth.com/v2";
const SEARCH_LIMIT = 24;

export async function getInstallRecords(): Promise<Record<string, InstalledRecord>> {
    try {
        // explicit panel id: ambient resolution resolves to last-imported
        const saved = await config.get<Record<string, unknown>>(PANEL_ID);
        return parseInstallRecords(saved?.[INSTALL_RECORDS_KEY]);
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

export async function listInstalledPlugins(): Promise<{
    plugins: InstalledPlugin[];
    warning?: string;
}> {
    // service-owned (service/plugins.ts): listing verifies hashes against
    // install records, and the twin that lived here is gone
    return serverBridge.call(ACTION_IDS.listInstalledPlugins);
}

export async function deletePlugin(filename: string): Promise<void> {
    // service-owned: trash-first delete, never a bare fileApi.delete
    await serverBridge.call(ACTION_IDS.deletePlugin, { filename });
}

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
    /** Modrinth file hashes, passed through to fileApi.download (vanilla/Paper already do) */
    sha1?: string;
    sha512?: string;
    /** MC versions the picked build targets; empty when the API omits them */
    gameVersions: string[];
    /** false when the version-filtered lookup had no match and this is a cross-version fallback */
    exactMatch: boolean;
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
    game_versions?: string[];
    files?: {
        url?: string;
        filename?: string;
        primary?: boolean;
        hashes?: { sha1?: string; sha512?: string };
    }[];
}

// text first so non-JSON answers fail with a clear message
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

// newest file matching the game version, else any loader build.
// The fallback pick is returned with exactMatch:false — callers must surface
// the explicit confirm state, never install it silently.
export async function resolveLatestFile(projectId: string): Promise<ResolvedDownload> {
    const software = serverSoftware();
    const loader = software === "fabric" ? "fabric" : "paper";
    const mcVersion = serverVersion();

    const loaders = JSON.stringify([loader]);
    let exactVersions: RawVersion[] = [];
    let fallbackVersions: RawVersion[] = [];

    if (mcVersion) {
        try {
            exactVersions = await modrinthFetch<RawVersion[]>(
                `/project/${encodeURIComponent(projectId)}/version`,
                { loaders, game_versions: JSON.stringify([mcVersion]) },
            );
        } catch (err) {
            console.error("[Plugins] Game-version lookup failed:", err);
        }
    }

    if (exactVersions.length === 0) {
        fallbackVersions = await modrinthFetch<RawVersion[]>(
            `/project/${encodeURIComponent(projectId)}/version`,
            { loaders },
        );
    }

    return pickVersionFile(exactVersions, fallbackVersions);
}

// thrown instead of installing when the only available build targets a
// different MC version: the UI turns this into the "latest compatible is
// for MC X — install anyway?" confirm, never a silent install
export class PluginVersionMismatchError extends Error {
    readonly mcVersion: string;
    readonly gameVersions: string[];
    readonly filename: string;
    readonly versionNumber: string;

    constructor(pick: ResolvedDownload, mcVersion: string) {
        const targets = pick.gameVersions.length > 0 ? pick.gameVersions.join(", ") : "unknown versions";
        super(
            mcVersion
                ? `Latest build targets Minecraft ${targets} but the server runs ${mcVersion} — install anyway?`
                : `Latest build targets Minecraft ${targets} and no server version is set — install anyway?`,
        );
        this.name = "PluginVersionMismatchError";
        this.mcVersion = mcVersion;
        this.gameVersions = pick.gameVersions;
        this.filename = pick.filename;
        this.versionNumber = pick.versionNumber;
    }
}

export async function installProject(
    projectId: string,
    opts?: { allowIncompatible?: boolean },
): Promise<{ filename: string; version: string }> {
    const file = await resolveLatestFile(projectId);
    if (!file.exactMatch && !opts?.allowIncompatible) {
        throw new PluginVersionMismatchError(file, serverVersion());
    }
    const safe = sanitizeFileName(file.filename);
    if (!safe || !safe.toLowerCase().endsWith(".jar")) {
        throw new Error(`Unsafe download filename: "${file.filename}"`);
    }

    await fileApi.download({
        url: file.url,
        targetPath: `${pluginDirName(serverSoftware())}/${safe}`,
        appId: PANEL_ID,
        // Modrinth hashes ride the same fields vanilla (sha1) and Paper
        // (sha256) already use. The daemon enforces sha1/sha256 today;
        // sha512 travels in checksum for verifiers that accept it.
        ...(file.sha1 ? { sha1: file.sha1 } : {}),
        ...(file.sha512 ? { checksum: { algorithm: "sha512", value: file.sha512 } } : {}),
    });

    // record project for icons and versions
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
