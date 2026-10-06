import semver from "semver";
import { fileApi, config } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../service/types";
import { serverSoftware, serverVersion, updatePanelConfig, serverBridge } from "./server";
import { behaviorVersionOf } from "./versionProfile";
import { ACTION_IDS } from "../service/contract";
import type { ServerSoftwareType } from "./software";
import { sanitizeFileName } from "./filesystem";
import {
    INSTALL_RECORDS_KEY,
    classifyPluginUpdate,
    isInstallRecord,
    parseInstallRecords,
    pickVersionFile,
    pluginDirName,
    validatePluginFilename,
    type PluginUpdateStatus as CoreUpdateStatus,
} from "../core/plugins";
import type { InstalledPlugin, InstalledRecord } from "../core/plugins";
import { apiFetch } from "./userAgent";

export type { InstalledPlugin, InstalledRecord };
export { INSTALL_RECORDS_KEY, isInstallRecord, pluginDirName, validatePluginFilename };

const MODRINTH_API = "https://api.modrinth.com/v2";
const SEARCH_LIMIT = 24;
// Environments with functionality on a dedicated server, per Modrinth.
const SERVER_ENVIRONMENTS = [
    "client_and_server", "server_only", "server_only_client_optional",
    "dedicated_server_only", "client_only_server_optional",
    "client_or_server", "client_or_server_prefers_both",
];

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
    followers?: number;
    loaders?: string[];
    license?: { id?: string; name?: string; url?: string };
    updated?: string;
    icon_url?: string;
}

export interface RawVersionDependency {
    version_id?: string | null;
    project_id?: string | null;
    file_name?: string | null;
    dependency_type?: string;
}

interface RawVersion {
    environment?: string;
    id?: string;
    version_number?: string;
    name?: string;
    version_type?: string;
    loaders?: string[];
    game_versions?: string[];
    date_published?: string;
    featured?: boolean;
    dependencies?: RawVersionDependency[];
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
    signal?: AbortSignal,
): Promise<T> {
    const query = params
        ? `?${new URLSearchParams(params).toString()}`
        : "";
    const res = await apiFetch(`${MODRINTH_API}${path}${query}`, {
        signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
    });
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

export async function searchModrinth(query: string, signal?: AbortSignal): Promise<ModrinthHit[]> {
    const eco = getEcosystem(serverSoftware());
    if (!eco) return [];
    const mcVersion = serverVersion();
    if (eco.kind === "mod" && !mcVersion) throw new Error("Choose a server version before browsing Modrinth.");

    const facets = JSON.stringify([
        [`project_type:${eco.projectType}`],
        [`categories:${eco.loaderCategory}`],
        ...(eco.kind === "mod" ? [[`versions:${mcVersion}`]] : []),
        SERVER_ENVIRONMENTS.map((environment) => `environment:${environment}`),
    ]);

    const data = await modrinthFetch<{ hits?: RawHit[] }>("/search", {
        query,
        limit: String(SEARCH_LIMIT),
        facets,
        index: query ? "relevance" : "downloads",
    }, signal);

    const hits: ModrinthHit[] = [];
    for (const hit of (data.hits ?? []).slice(0, SEARCH_LIMIT)) {
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
    // Plugins browse across Minecraft versions; exact builds are required only for mods.
    if (eco.kind === "plugin") return hits;

    // Project facets can match different releases (e.g. Fabric on 1.20,
    // Forge on 1.21). Verify an actual server build for this loader/version.
    // At most four requests at once, and at most one search page of projects.
    const verificationController = new AbortController();
    const verificationSignal = signal
        ? AbortSignal.any([signal, verificationController.signal])
        : verificationController.signal;
    const compatible = new Array<boolean>(hits.length).fill(false);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, hits.length) }, async () => {
        while (next < hits.length) {
            const index = next++;
            verificationSignal.throwIfAborted();
            const versions = await modrinthFetch<RawVersion[]>(
                `/project/${encodeURIComponent(hits[index].projectId)}/version`,
                {
                    loaders: JSON.stringify([eco.loaderCategory]),
                    game_versions: JSON.stringify([mcVersion]),
                    include_changelog: "false",
                },
                verificationSignal,
            );
            compatible[index] = versions.some((version) =>
                version.loaders?.includes(eco.loaderCategory) &&
                version.game_versions?.includes(mcVersion) &&
                SERVER_ENVIRONMENTS.includes(version.environment ?? "") &&
                version.files?.some((file) => file.url && file.filename?.endsWith(".jar")),
            );
        }
    })).catch((error) => {
        verificationController.abort();
        throw error;
    });
    return hits.filter((_, index) => compatible[index]);
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
        follows: typeof data.followers === "number" ? data.followers : 0,
        loaders: Array.isArray(data.loaders) ? data.loaders : [],
        license: licenseName,
        dateModified: data.updated ?? "",
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

/** Which side of the running version a build's target list sits on. */
export type TargetVersionSide = "older" | "newer" | "mixed" | "unknown";

export function targetVersionSide(
    gameVersions: string[],
    serverVersionValue: string | null | undefined,
): TargetVersionSide {
    const server = serverVersionValue
        ? semver.coerce(behaviorVersionOf(serverVersionValue))
        : null;
    if (!server || gameVersions.length === 0) return "unknown";
    let older = false;
    let newer = false;
    for (const target of gameVersions) {
        const v = semver.coerce(behaviorVersionOf(target));
        if (!v) continue;
        if (semver.lt(v, server)) older = true;
        else if (semver.gt(v, server)) newer = true;
    }
    if (older && newer) return "mixed";
    if (older) return "older";
    if (newer) return "newer";
    return "unknown";
}

// One warning sentence for a build that does not match the running server.
export function pluginVersionWarning(
    gameVersions: string[],
    serverVersionValue: string | null | undefined,
): string {
    const side = targetVersionSide(gameVersions, serverVersionValue);
    const relative =
        side === "mixed"
            ? "older and newer"
            : side === "unknown"
              ? "other"
              : side;
    return `This build targets versions ${relative} than this one. Installing it has a chance of crashing the server on startup.`;
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

// ─── Version picker + dependency install ───────────────────────────────
// The install modal lists every build for the current loader (bounded) and
// what each one pulls in. Dependencies come from Modrinth's version records;
// required ones install automatically, optional ones are opt-in, and
// incompatible/embedded ones are surfaced, never installed.

export interface ProjectVersionOption {
    /** Modrinth version id ("" when the record omits it) */
    versionId: string;
    versionNumber: string;
    name: string;
    gameVersions: string[];
    loaders: string[];
    versionType: string;
    datePublished: string;
    /** true when the build targets this server's loader + MC version */
    matchesServer: boolean;
    /** the build the modal preselects (first exact match) */
    recommended: boolean;
    dependencies: RawVersionDependency[];
}

/** newest 50 builds for the current loader, recommended first-marked */
export const MAX_VERSION_OPTIONS = 50;

export async function listProjectVersions(
    projectId: string,
): Promise<ProjectVersionOption[]> {
    const software = serverSoftware();
    const loader = software === "fabric" ? "fabric" : "paper";
    const mcVersion = serverVersion();
    const versions = await modrinthFetch<RawVersion[]>(
        `/project/${encodeURIComponent(projectId)}/version`,
        { loaders: JSON.stringify([loader]) },
    );
    const options: ProjectVersionOption[] = [];
    for (const v of (versions ?? []).slice(0, MAX_VERSION_OPTIONS)) {
        const gameVersions = Array.isArray(v.game_versions) ? v.game_versions : [];
        const matchesServer =
            (v.loaders ?? [loader]).includes(loader) &&
            (!mcVersion || gameVersions.includes(mcVersion));
        options.push({
            versionId: typeof v.id === "string" ? v.id : "",
            versionNumber: v.version_number ?? "",
            name: typeof v.name === "string" ? v.name : "",
            gameVersions,
            loaders: Array.isArray(v.loaders) ? v.loaders : [],
            versionType: typeof v.version_type === "string" ? v.version_type : "",
            datePublished: typeof v.date_published === "string" ? v.date_published : "",
            matchesServer,
            recommended: false,
            dependencies: Array.isArray(v.dependencies) ? v.dependencies : [],
        });
    }
    const firstMatch = options.findIndex((o) => o.matchesServer);
    if (firstMatch >= 0 && options[firstMatch].versionNumber) {
        options[firstMatch].recommended = true;
    }
    return options;
}

export type DependencyKind = "required" | "optional" | "incompatible" | "embedded";

export interface ResolvedDependency {
    /** stable key for checkboxes: version_id, else project_id, else file name */
    key: string;
    name: string;
    kind: DependencyKind;
    versionNumber: string;
    gameVersions: string[];
    projectId?: string;
    versionId?: string;
    /** present when the dep resolves to a verifiable jar */
    file?: { url: string; filename: string; sha1?: string; sha512?: string };
    /** set when nothing downloadable could be resolved */
    unresolvableReason?: string;
}

/** how many dependency records one version may pull in (names + files) */
export const MAX_DEPENDENCIES = 12;

function dependencyKindOf(raw: RawVersionDependency): DependencyKind {
    const t = (raw.dependency_type ?? "required").toLowerCase();
    if (t === "optional") return "optional";
    if (t === "incompatible") return "incompatible";
    if (t === "embedded") return "embedded";
    return "required";
}

function depDisplayName(
    project: { title?: string; slug?: string } | null,
    raw: RawVersionDependency,
): string {
    if (project?.title) return project.title;
    if (project?.slug) return project.slug;
    if (raw.file_name) return String(raw.file_name).replace(/\.jar$/i, "");
    if (raw.project_id) return String(raw.project_id);
    return "Unknown dependency";
}

async function fetchProjectMeta(projectId: string): Promise<{
    title?: string;
    slug?: string;
    iconUrl?: string;
} | null> {
    try {
        const data = await modrinthFetch<RawProject>(
            `/project/${encodeURIComponent(projectId)}`,
        );
        return {
            title: data.title,
            slug: data.slug,
            iconUrl: data.icon_url || undefined,
        };
    } catch (err) {
        console.error("[Plugins] Dependency project lookup failed:", err);
        return null;
    }
}

// Resolves one dependency record to a displayable, optionally downloadable
// entry. Exact (loader + MC version) builds only — a dep with no exact
// build is reported, never silently substituted with a wrong-version jar.
async function resolveOneDependency(
    raw: RawVersionDependency,
): Promise<ResolvedDependency> {
    const kind = dependencyKindOf(raw);
    const key =
        (typeof raw.version_id === "string" && raw.version_id) ||
        (typeof raw.project_id === "string" && raw.project_id) ||
        (typeof raw.file_name === "string" && raw.file_name) ||
        "dep";
    if (kind === "incompatible" || kind === "embedded") {
        const meta =
            typeof raw.project_id === "string" && raw.project_id
                ? await fetchProjectMeta(raw.project_id)
                : null;
        return {
            key,
            name: depDisplayName(meta, raw),
            kind,
            versionNumber: "",
            gameVersions: [],
            projectId:
                typeof raw.project_id === "string" ? raw.project_id : undefined,
            versionId:
                typeof raw.version_id === "string" ? raw.version_id : undefined,
            unresolvableReason:
                kind === "incompatible"
                    ? "Must not be installed alongside this version."
                    : "Bundled with the version; nothing to install.",
        };
    }

    const software = serverSoftware();
    const loader = software === "fabric" ? "fabric" : "paper";
    const mcVersion = serverVersion();
    const base = {
        key,
        name: "",
        kind,
        versionNumber: "",
        gameVersions: [] as string[],
        projectId:
            typeof raw.project_id === "string" ? raw.project_id : undefined,
        versionId:
            typeof raw.version_id === "string" ? raw.version_id : undefined,
    };

    // pinned version id wins; idents the exact file the author declared
    if (typeof raw.version_id === "string" && raw.version_id) {
        try {
            const v = await modrinthFetch<RawVersion>(
                `/version/${encodeURIComponent(raw.version_id)}`,
            );
            const files = Array.isArray(v.files) ? v.files : [];
            const primary = files.find((f) => f.primary) ?? files[0];
            const sha1 = primary?.hashes?.sha1;
            const sha512 = primary?.hashes?.sha512;
            const gameVersions = Array.isArray(v.game_versions) ? v.game_versions : [];
            const projectId =
                typeof v === "object" && v !== null && "project_id" in v
                    ? String((v as { project_id: unknown }).project_id ?? "")
                    : "";
            const meta = projectId ? await fetchProjectMeta(projectId) : null;
            if (!primary?.url || !primary?.filename || (!sha1 && !sha512)) {
                return {
                    ...base,
                    name: depDisplayName(meta, raw),
                    versionNumber: v.version_number ?? "",
                    gameVersions,
                    projectId: projectId || base.projectId,
                    unresolvableReason:
                        "The pinned version has no verifiable file; refusing to install it.",
                };
            }
            return {
                ...base,
                name: depDisplayName(meta, raw),
                versionNumber: v.version_number ?? "",
                gameVersions,
                projectId: projectId || base.projectId,
                file: {
                    url: primary.url,
                    filename: primary.filename,
                    ...(sha1 ? { sha1 } : {}),
                    ...(sha512 ? { sha512 } : {}),
                },
            };
        } catch (err) {
            return {
                ...base,
                name: depDisplayName(null, raw),
                unresolvableReason: `Could not read the pinned version: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    // project-only reference: latest exact build for this loader + MC
    if (typeof raw.project_id === "string" && raw.project_id) {
        const projectId = raw.project_id;
        const meta = await fetchProjectMeta(projectId);
        const name = depDisplayName(meta, raw);
        try {
            const params: Record<string, string> = {
                loaders: JSON.stringify([loader]),
                ...(mcVersion ? { game_versions: JSON.stringify([mcVersion]) } : {}),
            };
            const versions = await modrinthFetch<RawVersion[]>(
                `/project/${encodeURIComponent(projectId)}/version`,
                params,
            );
            const latest = (versions ?? [])[0];
            const files = Array.isArray(latest?.files) ? latest!.files! : [];
            const primary = files.find((f) => f.primary) ?? files[0];
            if (!primary?.url || !primary?.filename || (!primary.hashes?.sha1 && !primary.hashes?.sha512)) {
                return {
                    ...base,
                    name,
                    versionNumber: latest?.version_number ?? "",
                    gameVersions: Array.isArray(latest?.game_versions)
                        ? (latest!.game_versions as string[])
                        : [],
                    unresolvableReason: mcVersion
                        ? `No verifiable ${loader} build for Minecraft ${mcVersion}.`
                        : "No verifiable build found.",
                };
            }
            return {
                ...base,
                name,
                versionNumber: latest?.version_number ?? "",
                gameVersions: Array.isArray(latest?.game_versions)
                    ? (latest!.game_versions as string[])
                    : [],
                file: {
                    url: primary.url,
                    filename: primary.filename,
                    ...(primary.hashes?.sha1 ? { sha1: primary.hashes.sha1 } : {}),
                    ...(primary.hashes?.sha512 ? { sha512: primary.hashes.sha512 } : {}),
                },
            };
        } catch (err) {
            return {
                ...base,
                name,
                unresolvableReason: `Could not resolve a build: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    return { ...base, name: depDisplayName(null, raw), unresolvableReason: "No project or version reference." };
}

async function resolveRawDependencies(
    dependencies: RawVersionDependency[],
): Promise<ResolvedDependency[]> {
    const out: ResolvedDependency[] = [];
    for (const raw of (dependencies ?? []).slice(0, MAX_DEPENDENCIES)) {
        out.push(await resolveOneDependency(raw));
    }
    return out;
}

export async function resolveVersionDependencies(
    dependencies: RawVersionDependency[],
): Promise<ResolvedDependency[]> {
    return resolveRawDependencies(dependencies);
}

// Single download+record implementation for every install path. The record
// write is optional so the legacy contract holds: a project-metadata
// failure must not fail an install that already downloaded.
async function downloadAndRecordFile(input: {
    projectId: string;
    slug: string;
    versionNumber: string;
    title?: string;
    iconUrl?: string;
    file: { url: string; filename: string; sha1?: string; sha512?: string };
    record: boolean;
}): Promise<{ filename: string; version: string }> {
    const safe = sanitizeFileName(input.file.filename);
    if (!safe || !safe.toLowerCase().endsWith(".jar")) {
        throw new Error(
            `Can't save Modrinth's file name "${input.file.filename}" — it contains characters that aren't allowed in a jar name.`,
        );
    }

    await fileApi.download({
        url: input.file.url,
        targetPath: `${pluginDirName(serverSoftware())}/${safe}`,
        appId: PANEL_ID,
        // Modrinth hashes ride the same fields vanilla (sha1) and Paper
        // (sha256) already use. The daemon enforces sha1/sha256 today;
        // sha512 travels in checksum for verifiers that accept it.
        ...(input.file.sha1 ? { sha1: input.file.sha1 } : {}),
        ...(input.file.sha512
            ? { checksum: { algorithm: "sha512", value: input.file.sha512 } }
            : {}),
    });

    if (input.record) {
        const records = await getInstallRecords();
        records[safe] = {
            projectId: input.projectId,
            slug: input.slug,
            version: input.versionNumber || "latest",
            title: input.title || undefined,
            iconUrl: input.iconUrl,
        };
        await writeInstallRecords(records);
    }

    return { filename: safe, version: input.versionNumber };
}

export async function installProject(
    projectId: string,
    opts?: { allowIncompatible?: boolean },
): Promise<{ filename: string; version: string }> {
    const file = await resolveLatestFile(projectId);
    if (!file.exactMatch && !opts?.allowIncompatible) {
        throw new PluginVersionMismatchError(file, serverVersion());
    }

    // record project for icons and versions
    let meta: { slug: string; title?: string; iconUrl?: string } | null = null;
    try {
        const project = await getProject(projectId);
        meta = { slug: project.slug, title: project.title, iconUrl: project.iconUrl };
    } catch (err) {
        console.error("[Plugins] Failed to record install metadata:", err);
    }

    return downloadAndRecordFile({
        projectId,
        slug: meta?.slug ?? projectId,
        versionNumber: file.versionNumber,
        title: meta?.title,
        iconUrl: meta?.iconUrl,
        file,
        record: meta !== null,
    });
}

export interface ResolvedMainFile {
    url: string;
    filename: string;
    sha1?: string;
    sha512?: string;
    versionNumber: string;
    gameVersions: string[];
}

export interface InstallPreview {
    title: string;
    versionNumber: string;
    gameVersions: string[];
    matchesServer: boolean;
    mainFile: ResolvedMainFile | null;
    required: ResolvedDependency[];
    optional: ResolvedDependency[];
    transitive: ResolvedDependency[];
    incompatible: ResolvedDependency[];
    embedded: ResolvedDependency[];
    /** required entries (direct or transitive) that could not resolve */
    failures: string[];
}

function primaryFileOf(
    v: RawVersion,
): { url: string; filename: string; sha1?: string; sha512?: string } | null {
    const files = Array.isArray(v.files) ? v.files : [];
    const primary = files.find((f) => f.primary) ?? files[0];
    if (!primary?.url || !primary?.filename) return null;
    if (!primary.hashes?.sha1 && !primary.hashes?.sha512) return null;
    return {
        url: primary.url,
        filename: primary.filename,
        ...(primary.hashes?.sha1 ? { sha1: primary.hashes.sha1 } : {}),
        ...(primary.hashes?.sha512 ? { sha512: primary.hashes.sha512 } : {}),
    };
}

function depLabel(dep: ResolvedDependency): string {
    const ver = dep.versionNumber ? ` v${dep.versionNumber}` : "";
    const games = dep.gameVersions.length > 0 ? ` (${dep.gameVersions.join(", ")})` : "";
    return `${dep.name}${ver}${games}`;
}

// Full resolve pass with no writes: the main file, every required dep, the
// checked optional deps, and transitive required deps — each either
// verifiable or listed in failures, so the install phase never half-installs
// on a surprise.
export async function previewInstall(
    projectId: string,
    title: string,
    versionId: string,
    includeOptionalKeys: string[] = [],
): Promise<InstallPreview> {
    const software = serverSoftware();
    const loader = software === "fabric" ? "fabric" : "paper";
    const mcVersion = serverVersion();
    const record = await modrinthFetch<RawVersion>(
        `/version/${encodeURIComponent(versionId)}`,
    );
    const versionNumber = record.version_number ?? "";
    const gameVersions = Array.isArray(record.game_versions) ? record.game_versions : [];
    const matchesServer =
        (record.loaders ?? [loader]).includes(loader) &&
        (!mcVersion || gameVersions.includes(mcVersion));
    const mainFile = primaryFileOf(record);

    const direct = await resolveRawDependencies(record.dependencies ?? []);
    const required = direct.filter((d) => d.kind === "required");
    const optional = direct.filter((d) => d.kind === "optional");
    const incompatible = direct.filter((d) => d.kind === "incompatible");
    const embedded = direct.filter((d) => d.kind === "embedded");

    const transitive: ResolvedDependency[] = [];
    const failures: string[] = [];
    const seen = new Set<string>([projectId.toLowerCase()]);
    const wanted = new Set(includeOptionalKeys);
    const installedCount = () => transitive.length + required.length;
    const consider = async (dep: ResolvedDependency, depth: number) => {
        if (!dep.projectId) return;
        const idKey = dep.projectId.toLowerCase();
        if (seen.has(idKey)) return;
        seen.add(idKey);
        if (!dep.file) {
            failures.push(
                `${dep.name}: ${dep.unresolvableReason ?? "could not be resolved"}`,
            );
            return;
        }
        if (depth > 0) transitive.push(dep);
        if (depth >= MAX_DEP_DEPTH || installedCount() > MAX_DEP_INSTALLS) return;
        if (!dep.versionId) return;
        const sub = await modrinthFetch<RawVersion>(
            `/version/${encodeURIComponent(dep.versionId)}`,
        ).catch(() => null);
        if (!sub) return;
        for (const t of await resolveRawDependencies(
            (sub.dependencies ?? []).filter((r) => dependencyKindOf(r) === "required"),
        )) {
            await consider(t, depth + 1);
            if (installedCount() > MAX_DEP_INSTALLS) return;
        }
    };
    for (const dep of required) {
        await consider(dep, 0);
        if (installedCount() > MAX_DEP_INSTALLS) break;
    }
    for (const dep of optional) {
        if (!wanted.has(dep.key)) continue;
        await consider(dep, 0);
        if (installedCount() > MAX_DEP_INSTALLS) break;
    }

    return {
        title,
        versionNumber,
        gameVersions,
        matchesServer,
        mainFile: mainFile
            ? { ...mainFile, versionNumber, gameVersions }
            : null,
        required,
        optional,
        transitive,
        incompatible,
        embedded,
        failures,
    };
}

export interface InstallVersionSelection {
    projectId: string;
    slug: string;
    /** Modrinth project title, stored so the card survives a reload */
    title?: string;
    iconUrl?: string;
    versionId: string;
    /** ResolvedDependency.key values of optional deps to include */
    includeOptionalKeys?: string[];
}

export interface InstalledFileSummary {
    filename: string;
    versionNumber: string;
    title: string;
    kind: "main" | "required" | "optional";
}

// Installs an explicitly chosen version plus its required dependencies
// (and checked optionals). Resolution happens fully before any write, so a
// missing required dep fails the install instead of half-installing it.
export async function installProjectVersion(
    selection: InstallVersionSelection,
): Promise<InstalledFileSummary[]> {
    const preview = await previewInstall(
        selection.projectId,
        selection.title ?? selection.slug,
        selection.versionId,
        selection.includeOptionalKeys ?? [],
    );
    if (!preview.mainFile) {
        throw new Error(
            `Version ${preview.versionNumber || selection.versionId} has no verifiable file; refusing to install it.`,
        );
    }
    if (preview.failures.length > 0) {
        throw new Error(`Cannot install: ${preview.failures.join(" ")}`);
    }
    const wanted = new Set(selection.includeOptionalKeys ?? []);
    const chosenOptional = preview.optional.filter(
        (o) => o.file && wanted.has(o.key),
    );
    const missingOptional = preview.optional.filter(
        (o) => wanted.has(o.key) && !o.file,
    );
    if (missingOptional.length > 0) {
        throw new Error(
            `Cannot install: ${missingOptional.map(depLabel).join("; ")}.`,
        );
    }

    const installed: InstalledFileSummary[] = [];
    const installOne = async (
        entry:
            | { kind: "main" }
            | { kind: "required" | "optional"; dep: ResolvedDependency },
    ): Promise<void> => {
        if (entry.kind === "main") {
            const res = await downloadAndRecordFile({
                projectId: selection.projectId,
                slug: selection.slug,
                versionNumber: preview.versionNumber,
                title: preview.title,
                iconUrl: selection.iconUrl,
                file: preview.mainFile!,
                record: true,
            });
            installed.push({
                filename: res.filename,
                versionNumber: preview.versionNumber,
                title: preview.title,
                kind: "main",
            });
            return;
        }
        const dep = entry.dep;
        try {
            const res = await downloadAndRecordFile({
                projectId: dep.projectId ?? selection.projectId,
                slug: dep.name,
                versionNumber: dep.versionNumber,
                title: dep.name,
                file: dep.file!,
                record: true,
            });
            installed.push({
                filename: res.filename,
                versionNumber: dep.versionNumber,
                title: dep.name,
                kind: entry.kind,
            });
        } catch (err) {
            throw new Error(
                `Installed ${installed.map((i) => i.filename).join(", ") || "nothing"} but failed on dependency ${depLabel(dep)}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    };

    await installOne({ kind: "main" });
    for (const dep of [...preview.required, ...preview.transitive]) {
        if (!dep.file) continue;
        await installOne({ kind: "required", dep });
    }
    for (const dep of chosenOptional) {
        await installOne({ kind: "optional", dep });
    }
    return installed;
}

// one more level of required deps past the direct ones; deeper trees are
// rare and each hop is a network fetch, so this stays small and bounded
const MAX_DEP_DEPTH = 1;
const MAX_DEP_INSTALLS = 25;

export type PluginUpdateStatus = CoreUpdateStatus | "error";

export interface PluginUpdateCheck {
    filename: string;
    title: string;
    record?: InstalledRecord;
    latest?: ResolvedDownload;
    status: PluginUpdateStatus;
    error?: string;
}

// For every installed plugin, resolve the newest build for this server's
// software + Minecraft version. "incompatible" means no build matches (the
// UI offers to uninstall); "error" means the lookup itself failed.
export async function checkPluginUpdates(): Promise<PluginUpdateCheck[]> {
    const { plugins } = await listInstalledPlugins();
    const results: PluginUpdateCheck[] = [];
    for (const plugin of plugins) {
        const title =
            plugin.record?.title ??
            plugin.record?.slug ??
            plugin.filename.replace(/\.jar$/i, "");
        if (!plugin.record?.projectId) {
            results.push({
                filename: plugin.filename,
                title,
                status: "error",
                error: "No Modrinth record — cannot check for updates.",
            });
            continue;
        }
        try {
            const latest = await resolveLatestFile(plugin.record.projectId);
            const status = classifyPluginUpdate(
                plugin.record.version,
                latest.versionNumber,
                latest.exactMatch,
            );
            results.push({
                filename: plugin.filename,
                title,
                record: plugin.record,
                latest,
                status,
            });
        } catch (err) {
            results.push({
                filename: plugin.filename,
                title,
                record: plugin.record,
                status: "error",
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return results;
}

// Download the new jar (checksum-verified), then trash the old one if the
// filename changed, and retarget the install record. Trash-first keeps an
// interrupted update recoverable.
export async function updatePlugin(check: PluginUpdateCheck): Promise<void> {
    if (check.status !== "update-available" || !check.latest || !check.record) {
        return;
    }
    const file = check.latest;
    const safe = sanitizeFileName(file.filename);
    if (!safe || !safe.toLowerCase().endsWith(".jar")) {
        throw new Error(
            `Can't save Modrinth's file name "${file.filename}" — it contains characters that aren't allowed in a jar name.`,
        );
    }

    await fileApi.download({
        url: file.url,
        targetPath: `${pluginDirName(serverSoftware())}/${safe}`,
        appId: PANEL_ID,
        ...(file.sha1 ? { sha1: file.sha1 } : {}),
        ...(file.sha512 ? { checksum: { algorithm: "sha512", value: file.sha512 } } : {}),
    });

    if (safe !== check.filename) {
        await deletePlugin(check.filename);
    }

    // read after any delete so a service-side record removal is respected
    const records = await getInstallRecords();
    delete records[check.filename];
    records[safe] = {
        projectId: check.record.projectId,
        slug: check.record.slug,
        version: file.versionNumber || "latest",
        title: check.record.title,
        iconUrl: check.record.iconUrl,
    };
    await writeInstallRecords(records);
}

export async function uninstallPlugin(filename: string): Promise<void> {
    await deletePlugin(filename);
    const records = await getInstallRecords();
    if (records[filename]) {
        delete records[filename];
        await writeInstallRecords(records);
    }
}

// trash-first removal of every jar under both plugins/ and mods/, plus the
// install records — used when switching server software invalidates them all
export async function uninstallAllPlugins(): Promise<void> {
    await serverBridge.call(ACTION_IDS.uninstallAllPlugins);
}
