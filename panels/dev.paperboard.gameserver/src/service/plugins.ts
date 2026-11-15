import { errorMessage } from "@mileniumhq/paperapi";
import * as nodePath from "node:path";
import { minecraftSoftware } from "../games/minecraft/index";
import { MOD_DESCRIPTORS, PLUGIN_DESCRIPTORS, modVersionFrom, pluginDescription } from "./addonConfig";
import { readJarEntries } from "./jarEntries";
import {
    files as fileApi,
    config,
    updateSettings,
    type ServiceContext,
} from "./api";
import { sanitizeFileName, tryListDirectory, listDirectory } from "./filesystem";
import {
    INSTALL_RECORDS_KEY,
    collectInstalledPlugins,
    isInstallRecord,
    parseInstallRecords,
    pluginDirName,
    validatePluginFilename,
} from "../core/plugins";
import { UPLOAD_RECORDS_KEY, parseUploadRecords } from "../core/addonUpload";
import { forgetUploads } from "./uploadRecords";
import { liveUploadDeps } from "./addonUploadDeps";
import { trashRemovePathsWith } from "./trash";
import { SOFTWARE_IDS } from "../software/catalog";
import { makeTrashRemoveDeps } from "./trashDeps";
import { fetchJson } from "../software/http";
import { modrinthVersions } from "./modrinth";
import { SOFTWARE, type ServerSoftwareType } from "../software/catalog";
import {
    MODRINTH_API,
    assertModrinthId,
    parseModrinthProject,
    parseModrinthVersion,
    type ModrinthVersion,
    type RawModrinthProject,
} from "../core/modrinth";
import type { GameServerState, InstalledPlugin, InstalledRecord } from "./types";
import { PANEL_ID } from "./types";

export type { InstalledPlugin, InstalledRecord };
export { INSTALL_RECORDS_KEY, pluginDirName };

async function getInstallRecords(): Promise<Record<string, InstalledRecord>> {
    return parseInstallRecords((await config.get<Record<string, unknown> | null>(PANEL_ID))?.[INSTALL_RECORDS_KEY]);
}

async function writeInstallRecords(records: Record<string, InstalledRecord>): Promise<void> {
    await updateSettings({ [INSTALL_RECORDS_KEY]: records });
}

/**
 * Records installs the Plugins tab made (`set`) and forgets the files they
 * replaced (`remove`), merged here so the service holds the one copy of the
 * records and nothing else's record is written over.
 */
export async function recordPluginInstalls(input: { set?: unknown; remove?: unknown }): Promise<void> {
    const set = input?.set ?? {};
    const remove = input?.remove ?? [];
    if (typeof set !== "object" || set === null || Array.isArray(set)) throw new Error("Install records must be an object of file names");
    if (!Array.isArray(remove)) throw new Error("Files to forget must be a list");
    const records = await getInstallRecords();
    for (const name of remove) delete records[validatePluginFilename(String(name))];
    for (const [name, record] of Object.entries(set)) {
        if (!isInstallRecord(record)) throw new Error(`The install record for ${name} is not one Paperboard writes`);
        records[validatePluginFilename(name)] = record;
    }
    await writeInstallRecords(records);
}

export async function listInstalledPlugins(
    ctx: ServiceContext<GameServerState>,
): Promise<{ plugins: InstalledPlugin[]; warning?: string }> {
    const dirName = pluginDirName(minecraftSoftware(ctx.state.serverSoftware));
    // a missing directory means "nothing installed yet", not an error: the
    // folder is only created on first install, and a warning here taught
    // users to ignore the warning bar
    if (!(await fileApi.exists(dirName, PANEL_ID))) return { plugins: [] };
    const records = await getInstallRecords();
    const listing = await tryListDirectory(dirName);
    const uploads = parseUploadRecords((await config.get<Record<string, unknown>>(PANEL_ID))?.[UPLOAD_RECORDS_KEY]);
    const collected = await collectInstalledPlugins({
        records,
        listingEntries: listing.entries,
        exists: (path) => fileApi.exists(path, PANEL_ID),
        sanitize: sanitizeFileName,
        dirName,
    });

    // an uploaded jar has no record Modrinth describes; saying so beats a bare "Unknown version"
    // (a Modrinth install over it has a record and is no longer the upload)
    const root = await fileApi.getPath("", PANEL_ID);
    const mods = SOFTWARE[minecraftSoftware(ctx.state.serverSoftware)].addons?.kind === "mod";
    const plugins = await Promise.all(collected.map(async (plugin): Promise<InstalledPlugin> => {
        if (plugin.record) return plugin;
        const uploaded = `${dirName}/${plugin.filename}` in uploads ? { uploaded: true as const } : {};
        return { ...plugin, ...uploaded, described: await describeJar(nodePath.join(root, dirName, plugin.filename), mods) };
    }));
    return {
        plugins,
        warning: listing.error,
    };
}

/** what a jar no record describes says of itself; a jar that can't be read says why */
async function describeJar(jarPath: string, mod: boolean): Promise<NonNullable<InstalledPlugin["described"]>> {
    try {
        if (!mod) return await pluginDescription(await readJarEntries(jarPath, PLUGIN_DESCRIPTORS));
        const entries = await readJarEntries(jarPath, MOD_DESCRIPTORS);
        // a mod's id is no better a title than its file's name; its version is news
        return { version: modVersionFrom(entries) ?? undefined };
    } catch (err) {
        return { error: errorMessage(err) };
    }
}

export async function deletePlugin(
    ctx: ServiceContext<GameServerState>,
    filename: string,
): Promise<void> {
    const safe = validatePluginFilename(sanitizeFileName(filename) ?? filename);
    // moved to trash (see service/trash.ts) — a bare fileApi.delete
    // here is irreversible destruction on a single RPC
    await trashRemovePathsWith(
        makeTrashRemoveDeps(),
        [`${pluginDirName(minecraftSoftware(ctx.state.serverSoftware))}/${safe}`],
    );
    const records = await getInstallRecords();
    if (records[safe]) {
        delete records[safe];
        await writeInstallRecords(records);
    }
    await forgetUploads(liveUploadDeps(ctx), [`${pluginDirName(minecraftSoftware(ctx.state.serverSoftware))}/${safe}`]);
}

// every add-on dir regardless of software: switching software changes
// which folder is "active", so "uninstall everything" must clear all of them
const ALL_PLUGIN_DIRS = [...new Set(SOFTWARE_IDS.map((id) => pluginDirName(id)))];

export async function uninstallAllPlugins(
    ctx: ServiceContext<GameServerState>,
): Promise<number> {
    const paths: string[] = [];
    for (const dir of ALL_PLUGIN_DIRS) {
        // an unanswerable exists is a failure, not an empty folder: "uninstall
        // everything" must not report success over jars it never saw
        if (!(await fileApi.exists(dir, PANEL_ID))) continue;
        for (const entry of await listDirectory(dir)) {
            const safe = sanitizeFileName(entry);
            if (!safe || !safe.toLowerCase().endsWith(".jar")) continue;
            try {
                paths.push(`${dir}/${validatePluginFilename(safe)}`);
            } catch (err) {
                console.debug(`[Service:Plugins] skipping unsafe entry "${entry}":`, String(err));
            }
        }
    }
    if (paths.length > 0) {
        await trashRemovePathsWith(
            makeTrashRemoveDeps(),
            paths,
        );
    }
    await writeInstallRecords({});
    await forgetUploads(liveUploadDeps(ctx), paths);
    return paths.length;
}

/** What a plugin install needs of the world: Modrinth's records, and a checked download into the server folder. */
export interface PluginInstallDeps {
    fetchJson<T>(url: string): Promise<T>;
    download(file: { url: string; targetPath: string; sha1?: string; sha512?: string }): Promise<void>;
    /** the install records; a list that can't be read throws, so it is never written over */
    readRecords(): Promise<Record<string, InstalledRecord>>;
    writeRecords(records: Record<string, InstalledRecord>): Promise<void>;
}

/** What is installed on: the server's software and Minecraft version. */
export interface PluginTarget {
    software: ServerSoftwareType;
    mcVersion: string;
}

export const pluginTarget = (state: Pick<GameServerState, "serverSoftware" | "serverVersion">): PluginTarget => ({
    software: minecraftSoftware(state.serverSoftware),
    mcVersion: state.serverVersion,
});

function loaderOf(target: PluginTarget): string {
    const addons = SOFTWARE[target.software].addons;
    if (!addons) throw new Error(`${SOFTWARE[target.software].name} has no plugin or mod system.`);
    return addons.modrinthLoader;
}

export interface RawVersionDependency {
    version_id?: string | null;
    project_id?: string | null;
    file_name?: string | null;
    dependency_type?: string;
}

interface RawVersion {
    id?: string;
    project_id?: string;
    version_number?: string;
    loaders?: string[];
    game_versions?: string[];
    dependencies?: RawVersionDependency[];
    files?: { url?: string; filename?: string; primary?: boolean; hashes?: { sha1?: string; sha512?: string } }[];
}

export type DependencyKind = "required" | "optional" | "incompatible" | "embedded";

export interface ResolvedDependency {
    /** stable key for checkboxes: version_id, else project_id, else file name, else its place in the list */
    key: string;
    name: string;
    kind: DependencyKind;
    versionNumber: string;
    gameVersions: string[];
    projectId?: string;
    versionId?: string;
    /** present when the dep resolves to a verifiable jar */
    file?: VerifiableFile;
    /** set when nothing downloadable could be resolved */
    unresolvableReason?: string;
}

type VerifiableFile = { url: string; filename: string; sha1?: string; sha512?: string };

export interface InstallPreview {
    title: string;
    versionNumber: string;
    gameVersions: string[];
    matchesServer: boolean;
    mainFile: (VerifiableFile & { versionNumber: string; gameVersions: string[] }) | null;
    required: ResolvedDependency[];
    optional: ResolvedDependency[];
    transitive: ResolvedDependency[];
    incompatible: ResolvedDependency[];
    embedded: ResolvedDependency[];
    /** required entries (direct or transitive) that could not resolve */
    failures: string[];
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

/** how many dependency records one version may pull in (names + files) */
const MAX_DEPENDENCIES = 12;
// one more level of required deps past the direct ones; deeper trees are
// rare and each hop is a network fetch, so this stays small and bounded
const MAX_DEP_DEPTH = 1;
const MAX_DEP_INSTALLS = 25;

function dependencyKindOf(raw: RawVersionDependency): DependencyKind {
    const t = (raw.dependency_type ?? "required").toLowerCase();
    if (t === "optional" || t === "incompatible" || t === "embedded") return t;
    return "required";
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const list = <T = string>(value: unknown): T[] => (Array.isArray(value) ? value : []);

/** A version's primary file when Modrinth gives a hash to check it against. */
function verifiableFile(version: RawVersion | undefined): VerifiableFile | undefined {
    const files = Array.isArray(version?.files) ? version.files : [];
    const primary = files.find((f) => f.primary) ?? files[0];
    const { sha1, sha512 } = primary?.hashes ?? {};
    if (!primary?.url || !primary.filename || (!sha1 && !sha512)) return undefined;
    return { url: primary.url, filename: primary.filename, ...(sha1 ? { sha1 } : {}), ...(sha512 ? { sha512 } : {}) };
}

function depLabel(dep: ResolvedDependency): string {
    const ver = dep.versionNumber ? ` v${dep.versionNumber}` : "";
    const games = dep.gameVersions.length > 0 ? ` (${dep.gameVersions.join(", ")})` : "";
    return `${dep.name}${ver}${games}`;
}

/**
 * Resolves what installing one Modrinth build takes, with no writes: its
 * file, every required dependency, the checked optional ones, and required
 * dependencies of those, each either verifiable or listed in failures, so an
 * install never half-installs on a surprise. Exact (loader + Minecraft
 * version) builds only: a dependency without one is reported, never
 * substituted with a wrong-version jar.
 */
export async function previewPluginInstall(
    input: { projectId: unknown; title?: unknown; versionId: unknown; includeOptionalKeys?: unknown },
    target: PluginTarget,
    deps: Pick<PluginInstallDeps, "fetchJson">,
): Promise<InstallPreview> {
    const projectId = assertModrinthId(input.projectId, "Plugin");
    const versionId = assertModrinthId(input.versionId, "Version");
    const loader = loaderOf(target);
    const { mcVersion } = target;
    const modrinth = <T>(path: string, query?: Record<string, string>) =>
        deps.fetchJson<T>(`${MODRINTH_API}${path}${query ? `?${new URLSearchParams(query)}` : ""}`);
    const named = async (id: string | undefined, raw: RawVersionDependency) => {
        if (id) {
            const project = await modrinth<{ title?: string; slug?: string }>(`/project/${encodeURIComponent(id)}`);
            if (project.title || project.slug) return (project.title || project.slug)!;
        }
        return text(raw.file_name)?.replace(/\.jar$/i, "") ?? text(raw.project_id) ?? "Unknown dependency";
    };
    const fromVersion = (version: RawVersion | undefined, missing: string) => {
        const file = verifiableFile(version);
        return { versionNumber: version?.version_number ?? "", gameVersions: list(version?.game_versions), ...(file ? { file } : { unresolvableReason: missing }) };
    };
    const resolveOne = async (raw: RawVersionDependency, position: number): Promise<ResolvedDependency> => {
        const kind = dependencyKindOf(raw);
        const pinned = text(raw.version_id);
        const project = text(raw.project_id);
        const base = { key: pinned ?? project ?? text(raw.file_name) ?? `dependency-${position}`, kind, versionNumber: "", gameVersions: [] as string[], projectId: project, versionId: pinned };
        if (kind === "incompatible" || kind === "embedded") {
            return { ...base, name: await named(project, raw), unresolvableReason: kind === "incompatible" ? "Must not be installed alongside this version." : "Bundled with the version; nothing to install." };
        }
        // a pinned version id names the exact file the author declared
        if (pinned) {
            let version: RawVersion;
            try {
                version = await modrinth(`/version/${encodeURIComponent(pinned)}`);
            } catch (err) {
                return { ...base, name: await named(undefined, raw), unresolvableReason: `Could not read the pinned version: ${errorMessage(err)}` };
            }
            return { ...base, projectId: text(version.project_id) ?? project, name: await named(text(version.project_id) ?? project, raw), ...fromVersion(version, "The pinned version has no verifiable file; refusing to install it.") };
        }
        // a project-only reference: the newest exact build for this loader + Minecraft version
        if (project) {
            const name = await named(project, raw);
            try {
                const versions = await modrinthVersions<RawVersion>(deps.fetchJson, project, { loaders: [loader], ...(mcVersion ? { gameVersions: [mcVersion] } : {}) });
                return { ...base, name, ...fromVersion(versions[0], mcVersion ? `No verifiable ${loader} build for Minecraft ${mcVersion}.` : "No verifiable build found.") };
            } catch (err) {
                return { ...base, name, unresolvableReason: `Could not resolve a build: ${errorMessage(err)}` };
            }
        }
        return { ...base, name: await named(undefined, raw), unresolvableReason: "No project or version reference." };
    };
    const resolveAll = async (raws: RawVersionDependency[]) => {
        const out: ResolvedDependency[] = [];
        for (const [position, raw] of raws.slice(0, MAX_DEPENDENCIES).entries()) out.push(await resolveOne(raw, position));
        return out;
    };

    const record = await modrinth<RawVersion>(`/version/${encodeURIComponent(versionId)}`);
    const gameVersions = list(record.game_versions);
    const direct = await resolveAll(list<RawVersionDependency>(record.dependencies));
    const required = direct.filter((d) => d.kind === "required");
    const optional = direct.filter((d) => d.kind === "optional");
    const transitive: ResolvedDependency[] = [];
    const failures: string[] = [];
    const seen = new Set<string>([projectId.toLowerCase()]);
    const wanted = new Set(list(input.includeOptionalKeys).map(String));
    const full = () => transitive.length + required.length > MAX_DEP_INSTALLS;
    const consider = async (dep: ResolvedDependency, depth: number) => {
        if (!dep.projectId) return;
        const idKey = dep.projectId.toLowerCase();
        if (seen.has(idKey)) return;
        seen.add(idKey);
        if (!dep.file) {
            failures.push(`${dep.name}: ${dep.unresolvableReason ?? "could not be resolved"}`);
            return;
        }
        if (depth > 0) transitive.push(dep);
        if (depth >= MAX_DEP_DEPTH || full() || !dep.versionId) return;
        let sub: RawVersion;
        try {
            sub = await modrinth(`/version/${encodeURIComponent(dep.versionId)}`);
        } catch (err) {
            // its own dependencies are unknown: the preview says so rather than leave them out
            failures.push(`${dep.name}'s dependencies: ${errorMessage(err)}`);
            return;
        }
        for (const t of await resolveAll(list<RawVersionDependency>(sub.dependencies).filter((r) => dependencyKindOf(r) === "required"))) {
            await consider(t, depth + 1);
            if (full()) return;
        }
    };
    for (const dep of [...required, ...optional.filter((o) => wanted.has(o.key))]) {
        await consider(dep, 0);
        if (full()) break;
    }
    const versionNumber = record.version_number ?? "";
    const mainFile = verifiableFile(record);
    return {
        title: text(input.title) ?? projectId,
        versionNumber,
        gameVersions,
        matchesServer: (record.loaders ?? [loader]).includes(loader) && (!mcVersion || gameVersions.includes(mcVersion)),
        mainFile: mainFile ? { ...mainFile, versionNumber, gameVersions } : null,
        required,
        optional,
        transitive,
        incompatible: direct.filter((d) => d.kind === "incompatible"),
        embedded: direct.filter((d) => d.kind === "embedded"),
        failures,
    };
}

/**
 * Installs one Modrinth build with its required dependencies and the checked
 * optional ones, for the Plugins tab and Blocks alike. Everything resolves
 * before the first write, so a missing dependency fails the install instead
 * of half-installing it; a dependency already installed stays as it is, as
 * a second copy of a mod (another Fabric API version) stops the server.
 */
export async function installPluginVersion(
    selection: { projectId: unknown; slug?: unknown; title?: unknown; iconUrl?: unknown; versionId: unknown; includeOptionalKeys?: unknown },
    target: PluginTarget,
    deps: PluginInstallDeps,
): Promise<InstalledFileSummary[]> {
    const preview = await previewPluginInstall(selection, target, deps);
    const projectId = selection.projectId as string;
    if (!preview.mainFile) throw new Error(`Version ${preview.versionNumber || String(selection.versionId)} has no verifiable file; refusing to install it.`);
    if (preview.failures.length > 0) throw new Error(`Cannot install: ${preview.failures.join(" ")}`);
    const wanted = new Set(list(selection.includeOptionalKeys).map(String));
    const missingOptional = preview.optional.filter((o) => wanted.has(o.key) && !o.file);
    if (missingOptional.length > 0) throw new Error(`Cannot install: ${missingOptional.map(depLabel).join("; ")}.`);
    // read before the first download: a record list that can't be read stops the install
    const records = await deps.readRecords();
    const installedProjects = new Set(Object.values(records).map((r) => r.projectId));
    const iconUrl = text(selection.iconUrl);
    const dependency = (kind: "required" | "optional") => (dep: ResolvedDependency) => ({
        kind, file: dep.file!, title: dep.name, versionNumber: dep.versionNumber,
        record: { projectId: dep.projectId ?? projectId, slug: dep.name, version: dep.versionNumber, title: dep.name },
    });
    const entries: { kind: InstalledFileSummary["kind"]; file: VerifiableFile; record: InstalledRecord; title: string; versionNumber: string }[] = [
        { kind: "main", file: preview.mainFile, title: preview.title, versionNumber: preview.versionNumber, record: { projectId, slug: text(selection.slug) ?? projectId, version: preview.versionNumber, title: preview.title, ...(iconUrl ? { iconUrl } : {}) } },
        ...[...preview.required, ...preview.transitive].filter((dep) => dep.file && !(dep.projectId && installedProjects.has(dep.projectId))).map(dependency("required")),
        ...preview.optional.filter((o) => o.file && wanted.has(o.key)).map(dependency("optional")),
    ];
    const dir = pluginDirName(target.software);
    const installed: InstalledFileSummary[] = [];
    for (const entry of entries) {
        const safe = sanitizeFileName(entry.file.filename);
        try {
            if (!safe || !safe.toLowerCase().endsWith(".jar")) throw new Error(`Can't save Modrinth's file name "${entry.file.filename}" as a plugin`);
            await deps.download({ url: entry.file.url, targetPath: `${dir}/${validatePluginFilename(safe)}`, sha1: entry.file.sha1, sha512: entry.file.sha512 });
            records[safe] = entry.record;
            await deps.writeRecords(records);
        } catch (err) {
            if (entry.kind === "main") throw err;
            throw new Error(`Installed ${installed.map((i) => i.filename).join(", ")} but failed on dependency ${entry.title}: ${errorMessage(err)}`);
        }
        installed.push({ filename: safe, versionNumber: entry.versionNumber, title: entry.title, kind: entry.kind });
    }
    return installed;
}

/**
 * Installs a Modrinth plugin or mod's newest build for the server's software
 * and Minecraft version, with its dependencies, as the Plugins tab does.
 * Only an exact build installs: the tab asks before an install for another
 * version, and nothing here can.
 */
export async function installLatestPlugin(
    project: unknown,
    target: PluginTarget,
    deps: PluginInstallDeps,
): Promise<{ file: string; name: string; version: string }> {
    const id = assertModrinthId(project, "Plugin");
    const loader = loaderOf(target);
    if (!target.mcVersion) throw new Error("Choose a server version before installing plugins.");
    const meta = parseModrinthProject(await deps.fetchJson<RawModrinthProject>(`${MODRINTH_API}/project/${encodeURIComponent(id)}`));
    const build = (await modrinthVersions(deps.fetchJson, meta.projectId, { loaders: [loader], gameVersions: [target.mcVersion] }))
        .map(parseModrinthVersion)
        .find((v): v is ModrinthVersion => v !== null && v.gameVersions.includes(target.mcVersion) && v.loaders.includes(loader));
    if (!build) throw new Error(`${meta.title} has no build for Minecraft ${target.mcVersion} on ${SOFTWARE[target.software].name}`);
    if (build.projectId !== meta.projectId) throw new Error("Modrinth answered with a different project's version");
    const [main] = await installPluginVersion({ projectId: meta.projectId, slug: meta.slug, title: meta.title, iconUrl: meta.iconUrl, versionId: build.id }, target, deps);
    return { file: main!.filename, name: meta.title, version: main!.versionNumber };
}

/** The daemon's Modrinth reads and checked downloads, for a plugin install. */
export const livePluginInstallDeps: PluginInstallDeps = {
    fetchJson,
    download: ({ url, targetPath, sha1, sha512 }) =>
        fileApi.download({ url, targetPath, ...(sha1 ? { sha1 } : {}), ...(sha512 ? { checksum: { algorithm: "sha512", value: sha512 } } : {}), appId: PANEL_ID }).then(() => undefined),
    readRecords: getInstallRecords,
    writeRecords: writeInstallRecords,
};
