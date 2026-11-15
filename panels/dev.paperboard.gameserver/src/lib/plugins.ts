import { minecraftSoftware } from "../games/minecraft/index";
import semver from "semver";
import { errorMessage, type ServerCalls } from "./api";
import { PANEL_ID } from "../service/types";
import type { ServerPage } from "./server";
import { behaviorVersionOf } from "./versionProfile";
import { SOFTWARE, type ServerSoftwareType } from "./software";
import { sanitizeFileName } from "../core/directoryListing";
import {
    classifyPluginUpdate,
    pickVersionFile,
    pluginDirName,
    type PluginUpdateStatus as CoreUpdateStatus,
} from "../core/plugins";
import type { InstalledPlugin, InstalledRecord } from "../core/plugins";
import { resolveGeyserMCLatest } from "./geysermc";
import type { RawVersionDependency } from "../service/plugins";
import type { GeyserMCSource } from "../core/plugins";
import { SEARCH_LIMIT, getProject, modrinthFetch, parseSearchHits, type ModrinthHit, type ModrinthProject, type RawHit } from "./modrinth";

/** the server a lookup picks builds for: its software and Minecraft version */
type Target = Pick<ServerPage, "serverSoftware" | "serverVersion">;

export type { InstalledPlugin, InstalledRecord, ModrinthHit, ModrinthProject };
export type { InstallPreview, InstallVersionSelection, InstalledFileSummary, ResolvedDependency } from "../service/plugins";
export { getProject, modrinthFetch, pluginDirName };

// Environments with functionality on a dedicated server, per Modrinth.
const SERVER_ENVIRONMENTS = [
    "client_and_server", "server_only", "server_only_client_optional",
    "dedicated_server_only", "client_only_server_optional",
    "client_or_server", "client_or_server_prefers_both",
];

/** Records installed files and forgets replaced ones; the service merges them into its records. */
function recordInstalls(calls: ServerCalls, set: Record<string, InstalledRecord>, remove: string[] = []): Promise<unknown> {
    return calls.recordPluginInstalls({ set, remove });
}

export interface ResolvedDownload {
    url: string;
    filename: string;
    versionNumber: string;
    /** Modrinth file hashes, passed through to fileApi.download (vanilla/Paper already do) */
    sha1?: string;
    sha512?: string;
    /** GeyserMC's hash; Modrinth gives sha1 and sha512 */
    sha256?: string;
    /** MC versions the picked build targets; empty when the API omits them */
    gameVersions: string[];
    /** false when the version-filtered lookup had no match and this is a cross-version fallback */
    exactMatch: boolean;
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

export interface EcosystemInfo {
    projectType: "plugin" | "mod";
    loaderCategory: string;
    kind: "plugin" | "mod";
}

export function getEcosystem(software: ServerSoftwareType): EcosystemInfo | null {
    const addons = SOFTWARE[software].addons;
    return addons
        ? { projectType: addons.projectType, loaderCategory: addons.modrinthLoader, kind: addons.kind }
        : null;
}

/** the Modrinth loader id of the installed software; it must have add-ons */
function currentModrinthLoader(server: Target): string {
    const software = minecraftSoftware(server.serverSoftware());
    const addons = SOFTWARE[software].addons;
    if (!addons) throw new Error(`${SOFTWARE[software].name} has no plugin or mod system.`);
    return addons.modrinthLoader;
}

export async function searchModrinth(server: Target, query: string, signal?: AbortSignal): Promise<ModrinthHit[]> {
    const eco = getEcosystem(minecraftSoftware(server.serverSoftware()));
    if (!eco) return [];
    const mcVersion = server.serverVersion();
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

    const hits = parseSearchHits(data.hits);
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


// newest file matching the game version, else any loader build.
// The fallback pick is returned with exactMatch:false — callers must surface
// the explicit confirm state, never install it silently.
export async function resolveLatestFile(server: Target, projectId: string): Promise<ResolvedDownload> {
    const loader = currentModrinthLoader(server);
    const mcVersion = server.serverVersion();

    const loaders = JSON.stringify([loader]);
    let exactVersions: RawVersion[] = [];
    let fallbackVersions: RawVersion[] = [];

    // a failed exact lookup throws: answering with another version's build would call the plugin incompatible
    if (mcVersion) {
        exactVersions = await modrinthFetch<RawVersion[]>(
            `/project/${encodeURIComponent(projectId)}/version`,
            { loaders, game_versions: JSON.stringify([mcVersion]) },
        );
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
type TargetVersionSide = "older" | "newer" | "mixed" | "unknown";

function targetVersionSide(
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
// what each one pulls in. The service resolves and installs (service/plugins.ts):
// required dependencies install automatically, optional ones are opt-in, and
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

export async function listProjectVersions(server: Target, projectId: string): Promise<ProjectVersionOption[]> {
    const loader = currentModrinthLoader(server);
    const mcVersion = server.serverVersion();
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

/** "unchecked": no Modrinth record says what it is (uploaded, or added by hand), so nothing could be looked up */
export type PluginUpdateStatus = CoreUpdateStatus | "error" | "unchecked";

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
// UI offers to uninstall); "error" means the lookup itself failed;
// "unchecked" means there was nothing to look up.
export async function checkPluginUpdates(server: Target & Pick<ServerPage, "calls">): Promise<PluginUpdateCheck[]> {
    const { plugins } = await server.calls.listInstalledPlugins();
    const results: PluginUpdateCheck[] = [];
    for (const plugin of plugins) {
        const title =
            plugin.record?.title ??
            plugin.record?.slug ??
            plugin.described?.name ??
            plugin.filename.replace(/\.jar$/i, "");
        if (!plugin.record?.projectId) {
            results.push({
                filename: plugin.filename,
                title,
                status: "unchecked",
            });
            continue;
        }
        try {
            const latest = plugin.record.source
                ? await resolveGeyserMCLatest(plugin.record.source, plugin.filename)
                : await resolveLatestFile(server, plugin.record.projectId);
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
                error: errorMessage(err),
            });
        }
    }
    return results;
}

// Download the new jar (checksum-verified), then trash the old one if the
// filename changed, and retarget the install record. Trash-first keeps an
// interrupted update recoverable.
export async function updatePlugin(server: ServerPage, check: PluginUpdateCheck): Promise<void> {
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

    await server.files.download({
        url: file.url,
        targetPath: `${pluginDirName(minecraftSoftware(server.serverSoftware()))}/${safe}`,
        appId: PANEL_ID,
        ...(file.sha1 ? { sha1: file.sha1 } : {}),
        ...(file.sha256 ? { sha256: file.sha256 } : {}),
        ...(file.sha512 ? { checksum: { algorithm: "sha512", value: file.sha512 } } : {}),
    });

    // service-owned: trash-first delete, never a bare fileApi.delete
    if (safe !== check.filename) await server.calls.deletePlugin({ filename: check.filename });

    await recordInstalls(server.calls, {
        [safe]: {
            projectId: check.record.projectId,
            slug: check.record.slug,
            version: file.versionNumber,
            title: check.record.title,
            iconUrl: check.record.iconUrl,
            ...(check.record.source ? { source: check.record.source } : {}),
        },
    }, [check.filename]);
}

/** Installs the newest build GeyserMC publishes for `source`, checked against its sha256, and records it. */
export async function installGeyserMCProject(server: ServerPage, source: GeyserMCSource, filename: string, title: string): Promise<void> {
    const latest = await resolveGeyserMCLatest(source, filename);
    await server.files.download({
        url: latest.url,
        targetPath: `${pluginDirName(minecraftSoftware(server.serverSoftware()))}/${latest.filename}`,
        appId: PANEL_ID,
        sha256: latest.sha256,
    });
    await recordInstalls(server.calls, { [latest.filename]: { projectId: source.project, slug: source.project, version: latest.versionNumber, title, source } });
}
