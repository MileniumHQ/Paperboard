import * as nodePath from "node:path";
import { minecraftSoftware } from "../games/minecraft/index";
import { MOD_DESCRIPTORS, PLUGIN_DESCRIPTORS, modVersionFrom, pluginDescription } from "./addonConfig";
import { readJarEntries } from "./jarEntries";
import {
    files as fileApi,
    config,
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
import { SOFTWARE, type ServerSoftwareType } from "../software/catalog";
import {
    MODRINTH_API,
    assertModrinthId,
    parseModrinthProject,
    parseModrinthVersion,
    type ModrinthVersion,
    type RawModrinthProject,
    type RawModrinthVersion,
} from "../core/modrinth";
import type { GameServerState, InstalledPlugin, InstalledRecord } from "./types";
import { PANEL_ID } from "./types";

export type { InstalledPlugin, InstalledRecord };
export { INSTALL_RECORDS_KEY, pluginDirName };

async function getInstallRecords(): Promise<Record<string, InstalledRecord>> {
    return parseInstallRecords((await config.get<Record<string, unknown> | null>(PANEL_ID))?.[INSTALL_RECORDS_KEY]);
}

async function writeInstallRecords(records: Record<string, InstalledRecord>): Promise<void> {
    await config.set({ ...(await config.get<Record<string, unknown> | null>(PANEL_ID)), [INSTALL_RECORDS_KEY]: records }, PANEL_ID);
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
        return { error: err instanceof Error ? err.message : String(err) };
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
    download(file: { url: string; targetPath: string; sha1: string; sha512: string }): Promise<void>;
    exists(path: string): Promise<boolean>;
    /** the install records; a list that can't be read throws, so it is never written over */
    readRecords(): Promise<Record<string, InstalledRecord>>;
    writeRecords(records: Record<string, InstalledRecord>): Promise<void>;
}

/**
 * Installs a Modrinth plugin or mod's newest build for the server's
 * software and Minecraft version. Only an exact build installs: the Plugins
 * tab asks before an install for another version, and nothing here can.
 */
export async function installPlugin(
    project: unknown,
    software: ServerSoftwareType,
    mcVersion: string,
    deps: PluginInstallDeps,
): Promise<{ file: string; name: string; version: string }> {
    const id = assertModrinthId(project, "Plugin");
    const addons = SOFTWARE[software].addons;
    if (!addons) throw new Error(`${SOFTWARE[software].name} has no plugin or mod system.`);
    if (!mcVersion) throw new Error("Choose a server version before installing plugins.");
    const meta = parseModrinthProject(await deps.fetchJson<RawModrinthProject>(`${MODRINTH_API}/project/${encodeURIComponent(id)}`));
    const query = new URLSearchParams({
        loaders: JSON.stringify([addons.modrinthLoader]),
        game_versions: JSON.stringify([mcVersion]),
        include_changelog: "false",
    });
    const raw = await deps.fetchJson<RawModrinthVersion[]>(`${MODRINTH_API}/project/${encodeURIComponent(meta.projectId)}/version?${query}`);
    if (!Array.isArray(raw)) throw new Error("Modrinth returned no version list");
    const build = raw
        .map(parseModrinthVersion)
        .find((v): v is ModrinthVersion => v !== null && v.gameVersions.includes(mcVersion) && v.loaders.includes(addons.modrinthLoader));
    if (!build) throw new Error(`${meta.title} has no build for Minecraft ${mcVersion} on ${SOFTWARE[software].name}`);
    if (build.projectId !== meta.projectId) throw new Error("Modrinth answered with a different project's version");
    if (!build.primary) throw new Error(`${meta.title} ${build.versionNumber} has no file Paperboard can verify`);
    const safe = sanitizeFileName(build.primary.filename);
    if (!safe || !safe.toLowerCase().endsWith(".jar")) throw new Error(`Can't save Modrinth's file name "${build.primary.filename}" as a plugin`);
    const targetPath = `${pluginDirName(software)}/${validatePluginFilename(safe)}`;
    if (await deps.exists(targetPath)) throw new Error(`${safe} is already installed`);
    // read before the download: a record list that can't be read stops the install
    const records = await deps.readRecords();
    await deps.download({ url: build.primary.url, targetPath, sha1: build.primary.sha1, sha512: build.primary.sha512 });
    records[safe] = {
        projectId: meta.projectId,
        slug: meta.slug,
        version: build.versionNumber || "latest",
        title: meta.title,
        ...(meta.iconUrl ? { iconUrl: meta.iconUrl } : {}),
    };
    await deps.writeRecords(records);
    return { file: safe, name: meta.title, version: build.versionNumber };
}

/** The daemon's Modrinth reads and checked downloads, for a plugin install. */
export const livePluginInstallDeps: PluginInstallDeps = {
    fetchJson,
    download: ({ url, targetPath, sha1, sha512 }) => fileApi.download({ url, targetPath, sha1, checksum: { algorithm: "sha512", value: sha512 }, appId: PANEL_ID }).then(() => undefined),
    exists: (path) => fileApi.exists(path, PANEL_ID),
    readRecords: getInstallRecords,
    writeRecords: writeInstallRecords,
};
