import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import {
    MAX_MRPACK_BYTES,
    MAX_PACK_FILES,
    MODPACK_LOADER,
    MODPACK_RECORD_KEY,
    MODPACK_STAGING_KEY,
    packPathKey,
    parseModpackRecord,
    parsePackIndex,
    type ModpackRecord,
    type PackDownload,
} from "../core/modpack";
import {
    MODRINTH_API,
    assertModrinthId,
    parseModrinthProject,
    parseModrinthVersion,
    type ModrinthVersion,
    type RawModrinthProject,
    type RawModrinthVersion,
} from "../core/modrinth";
import { INSTALL_RECORDS_KEY, parseInstallRecords } from "../core/plugins";
import type { ModpackProgress } from "../core/state";
import { SOFTWARE, type ServerSoftwareType } from "../software/catalog";
import { extractMrpack } from "./mrpack";
import { activatePack, newPackStagingName, packFilesPath, recoverStagedPacks, type PackFs } from "./packActivation";

// The Modpacks tab's owner. Installing a Modrinth pack:
//
//   1. reads the version record from Modrinth and downloads its .mrpack
//      (sha1 checked by the daemon, sha512 here)
//   2. reads the pack's index and override folders out of the archive
//   3. downloads every server file the index names, each checked the same way
//   4. places the files (packActivation.ts), parking what they replace:
//      the previous pack's files and the mods/ jars the pack supersedes
//   5. switches the server to the pack's Minecraft version and loader build
//      when they differ, and puts the old files back if that fails
//   6. records the pack, then sends the parked files to the trash
//
// The caller holds the install lock (withInstallLock) and has checked the
// server is offline: nothing else writes the server folder meanwhile.

/** downloads at once; the daemon allows eight across every panel */
const DOWNLOAD_CONCURRENCY = 4;

export type { ModpackProgress };

export interface ModpackDeps {
    serverDir(): Promise<string>;
    levelName(): Promise<string>;
    fetchJson<T>(url: string): Promise<T>;
    /** downloads into the server folder, verifying sha1; targetPath is relative to it */
    download(opts: { url: string; targetPath: string; sha1: string }): Promise<unknown>;
    sha512(absolutePath: string): Promise<string>;
    readConfig(): Promise<Record<string, unknown>>;
    writeConfig(patch: Record<string, unknown>): Promise<void>;
    /** the installed software, version and build, from the install record */
    installed(): Promise<{ software: ServerSoftwareType; version: string; build: string | null }>;
    /** installs software under the lock the caller already holds */
    installSoftware(software: ServerSoftwareType, version: string, build: string): Promise<{ warning?: string }>;
    publish(progress: ModpackProgress | null): void;
    fs?: PackFs;
}

export interface ModpackInstallOutcome {
    title: string;
    versionNumber: string;
    mcVersion: string;
    loaderVersion: string;
    /** whether the server software was switched to the pack's versions */
    switchedServer: boolean;
    /** pack paths Paperboard keeps as they are (server.properties, the world) */
    kept: string[];
    warning?: string;
}

function fsOf(deps: ModpackDeps): PackFs {
    return deps.fs ?? (nodeFs as unknown as PackFs);
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function errorCode(err: unknown): string | undefined {
    return (err as { code?: string } | null)?.code;
}

const inDir = (dir: string, path: string) => nodePath.join(dir, ...path.split("/"));

/** The loader's Modrinth name for a software, or a refusal for one without modpacks. */
export function modpackLoaderFor(software: ServerSoftwareType): { dependency: string; modrinth: string } {
    const loader = MODPACK_LOADER[software];
    if (!loader) throw new Error(`${SOFTWARE[software].name} servers do not run modpacks`);
    return loader;
}

export async function listModpackVersions(
    projectId: unknown,
    software: ServerSoftwareType,
    deps: Pick<ModpackDeps, "fetchJson">,
): Promise<ModrinthVersion[]> {
    const id = assertModrinthId(projectId, "Project");
    const loader = modpackLoaderFor(software);
    const query = new URLSearchParams({ loaders: JSON.stringify([loader.modrinth]), include_changelog: "false" });
    const raw = await deps.fetchJson<RawModrinthVersion[]>(`${MODRINTH_API}/project/${encodeURIComponent(id)}/version?${query}`);
    if (!Array.isArray(raw)) throw new Error("Modrinth returned no version list");
    return raw
        .map(parseModrinthVersion)
        .filter((v): v is ModrinthVersion => v !== null && v.primary !== null && v.primary.filename.endsWith(".mrpack"));
}

/** The pack recorded as installed; null when none. Throws when the record is unreadable. */
export async function readModpack(deps: Pick<ModpackDeps, "readConfig">): Promise<ModpackRecord | null> {
    return parseModpackRecord((await deps.readConfig())[MODPACK_RECORD_KEY]);
}

async function liveModJars(root: string, fs: PackFs): Promise<string[]> {
    let names: string[];
    try {
        names = await fs.readdir(nodePath.join(root, "mods"));
    } catch (err) {
        // no mods/ folder is no mods; anything else stops the install
        if (errorCode(err) === "ENOENT") return [];
        throw err;
    }
    return names.filter((name) => name.toLowerCase().endsWith(".jar")).map((name) => `mods/${name}`);
}

/** Runs `work` over `items`, `limit` at a time; the first failure stops new work and is thrown. */
async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    let failed = false;
    const lane = async () => {
        while (!failed && next < items.length) {
            const item = items[next++]!;
            try {
                await work(item);
            } catch (err) {
                failed = true;
                throw err;
            }
        }
    };
    const results = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, lane));
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (rejected) throw rejected.reason;
}

async function verifyDownload(
    deps: ModpackDeps,
    fs: PackFs,
    absolute: string,
    expected: { sha512: string; size: number | null },
    label: string,
): Promise<void> {
    if (expected.size !== null) {
        const stat = (await fs.lstat(absolute)) as { size?: number };
        if (stat.size !== expected.size) {
            throw new Error(`${label} is ${stat.size} bytes, not the ${expected.size} the pack lists`);
        }
    }
    const digest = await deps.sha512(absolute);
    if (digest !== expected.sha512) throw new Error(`${label} does not match its sha512; refusing it`);
}

export async function installModpack(
    input: { projectId: unknown; versionId: unknown },
    software: ServerSoftwareType,
    deps: ModpackDeps,
): Promise<ModpackInstallOutcome> {
    const projectId = assertModrinthId(input.projectId, "Project");
    const versionId = assertModrinthId(input.versionId, "Version");
    const loader = modpackLoaderFor(software);
    const fs = fsOf(deps);
    let progress: ModpackProgress = { stage: "preparing", done: 0, total: 0 };
    const publish = (next: ModpackProgress) => {
        progress = next;
        deps.publish(next);
    };
    publish(progress);

    const root = await deps.serverDir();
    const staging = newPackStagingName();
    const stagingDir = nodePath.join(root, staging);
    let activated = false;
    try {
        // read first: an unreadable record stops here, before anything moves
        const config = await deps.readConfig();
        const previous = parseModpackRecord(config[MODPACK_RECORD_KEY]);
        const levelName = await deps.levelName();

        const version = parseModrinthVersion(
            await deps.fetchJson<RawModrinthVersion>(`${MODRINTH_API}/version/${encodeURIComponent(versionId)}`),
        );
        if (!version || version.id !== versionId || version.projectId !== projectId) {
            throw new Error("Modrinth answered with a different version than the one chosen");
        }
        if (!version.loaders.includes(loader.modrinth)) {
            throw new Error(`This modpack version is not for ${SOFTWARE[software].name}`);
        }
        const packFile = version.primary;
        if (!packFile || !packFile.filename.endsWith(".mrpack")) {
            throw new Error("This modpack version has no verifiable .mrpack file");
        }
        if (packFile.size !== null && packFile.size > MAX_MRPACK_BYTES) {
            throw new Error("This modpack's archive is over the 256 MiB limit");
        }
        const project = parseModrinthProject(
            await deps.fetchJson<RawModrinthProject>(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`),
        );
        if (project.projectId !== projectId) throw new Error("Modrinth answered with a different project");
        if (project.projectType !== "modpack") throw new Error(`${project.title} is not a modpack`);

        await fs.mkdir(stagingDir, { recursive: true });
        const archiveRel = `${staging}/pack.mrpack`;
        await deps.download({ url: packFile.url, targetPath: archiveRel, sha1: packFile.sha1 });
        const archive = inDir(root, archiveRel);
        const archiveSize = ((await fs.lstat(archive)) as { size?: number }).size ?? 0;
        if (archiveSize > MAX_MRPACK_BYTES) throw new Error("This modpack's archive is over the 256 MiB limit");
        await verifyDownload(deps, fs, archive, { sha512: packFile.sha512, size: null }, "The modpack archive");

        const layersDir = nodePath.join(stagingDir, "layers");
        const extracted = await extractMrpack({ archive, layersDir, levelName });
        const index = parsePackIndex(extracted.index, software, levelName);

        // later layers win: server-overrides over overrides over downloads
        const placed = new Map<string, { path: string; layer: number | null }>();
        for (const download of index.downloads) placed.set(packPathKey(download.path), { path: download.path, layer: null });
        extracted.layers.forEach((layer, i) => {
            for (const [key, path] of layer) placed.set(key, { path, layer: i });
        });
        if (placed.size > MAX_PACK_FILES) throw new Error(`This modpack places over ${MAX_PACK_FILES} files`);
        for (const key of placed.keys()) {
            const segments = key.split("/");
            for (let i = 1; i < segments.length; i++) {
                if (placed.has(segments.slice(0, i).join("/"))) {
                    throw new Error(`This modpack cannot be installed: it uses ${segments.slice(0, i).join("/")} as both a file and a folder`);
                }
            }
        }

        const toDownload: PackDownload[] = index.downloads.filter((d) => placed.get(packPathKey(d.path))!.layer === null);
        const filesRel = packFilesPath(staging);
        let done = 0;
        publish({ stage: "downloading", done, total: toDownload.length });
        await eachLimited(toDownload, DOWNLOAD_CONCURRENCY, async (file) => {
            const targetPath = `${filesRel}/${file.path}`;
            await deps.download({ url: file.url, targetPath, sha1: file.sha1 });
            await verifyDownload(deps, fs, inDir(root, targetPath), file, file.path);
            done += 1;
            publish({ stage: "downloading", done, total: toDownload.length });
        });
        for (const { path, layer } of placed.values()) {
            if (layer === null) continue;
            const target = inDir(nodePath.join(root, filesRel), path);
            await fs.mkdir(nodePath.dirname(target), { recursive: true });
            await fs.rename(inDir(nodePath.join(layersDir, String(layer)), path), target);
        }
        await fs.rm(layersDir, { recursive: true, force: true });
        await fs.rm(archive, { recursive: true, force: true });

        const staged = [...placed.values()].map((p) => p.path);
        const stagedKeys = new Set(placed.keys());
        // the previous pack's files the new one drops, and every mod jar the
        // pack does not bring: a modpack is the whole mod set
        const replace = [...(previous?.files ?? []), ...(await liveModJars(root, fs))].filter(
            (path) => !stagedKeys.has(packPathKey(path)),
        );

        publish({ stage: "placing", done: 0, total: staged.length });
        // Activation can throw after parking originals; recovery owns them.
        activated = true;
        const activation = await activatePack({ root, staging, staged, replace, fs });

        // until the record is written, any failure puts the old files back
        let switchServer = false;
        let switched = false;
        let warning: string | undefined;
        try {
            const installed = await deps.installed();
            switchServer =
                installed.software !== software ||
                installed.version !== index.mcVersion ||
                installed.build !== index.loaderVersion;
            if (switchServer) {
                publish({ stage: "installing-server", done: 0, total: 0 });
                try {
                    warning = (await deps.installSoftware(software, index.mcVersion, index.loaderVersion)).warning;
                    switched = true;
                } catch (err) {
                    throw new Error(
                        `Installing ${SOFTWARE[software].name} ${index.loaderVersion} for Minecraft ${index.mcVersion} failed: ${messageOf(err)}`,
                    );
                }
            }
            const record: ModpackRecord = {
                projectId,
                versionId,
                slug: project.slug,
                title: project.title,
                versionNumber: version.versionNumber,
                ...(project.iconUrl ? { iconUrl: project.iconUrl } : {}),
                mcVersion: index.mcVersion,
                loaderVersion: index.loaderVersion,
                files: staged.sort(),
            };
            // mod records for jars the pack replaced would describe files in the trash
            const modRecords = parseInstallRecords((await deps.readConfig())[INSTALL_RECORDS_KEY]);
            for (const name of Object.keys(modRecords)) {
                if (!stagedKeys.has(packPathKey(`mods/${name}`))) delete modRecords[name];
            }
            await deps.writeConfig({
                [MODPACK_RECORD_KEY]: record,
                [MODPACK_STAGING_KEY]: staging,
                [INSTALL_RECORDS_KEY]: modRecords,
            });
        } catch (err) {
            await activation.rollback();
            throw new Error(
                `${messageOf(err)}. The previous mods were put back${switched ? `; the server software stays on ${SOFTWARE[software].name} ${index.loaderVersion} for Minecraft ${index.mcVersion}` : ""}.`,
            );
        }
        try {
            await activation.commit();
        } catch (err) {
            const cleanup = `${project.title} is installed, but moving the replaced files to the trash failed (${messageOf(err)}). Paperboard retries when the panel service restarts.`;
            warning = warning ? `${warning} ${cleanup}` : cleanup;
            console.error("[Service:Modpacks] commit cleanup failed:", err);
        }
        publish({ stage: "completed", done: staged.length, total: staged.length });
        return {
            title: project.title,
            versionNumber: version.versionNumber,
            mcVersion: index.mcVersion,
            loaderVersion: index.loaderVersion,
            switchedServer: switchServer,
            kept: [...index.kept, ...extracted.kept],
            ...(warning ? { warning } : {}),
        };
    } catch (err) {
        deps.publish({ ...progress, stage: "error" });
        // an activated staging folder is settled by its own rollback (or,
        // if that failed, by recovery); anything earlier is only downloads
        if (!activated) await fs.rm(stagingDir, { recursive: true, force: true });
        throw err;
    }
}

/**
 * Removes the recorded pack's files through the trash, keeping the server
 * software and everything the pack did not place. An unreadable record is
 * forgotten instead: its files stay, and nothing is guessed at.
 */
export async function removeModpack(deps: ModpackDeps): Promise<{ removed: number; forgotten?: true }> {
    const fs = fsOf(deps);
    let record: ModpackRecord | null;
    try {
        record = await readModpack(deps);
    } catch (err) {
        console.warn("[Service:Modpacks] forgetting an unreadable modpack record:", messageOf(err));
        await deps.writeConfig({ [MODPACK_RECORD_KEY]: null });
        return { removed: 0, forgotten: true };
    }
    if (!record) throw new Error("No modpack is installed");
    const root = await deps.serverDir();
    const staging = newPackStagingName();
    const activation = await activatePack({ root, staging, staged: [], replace: record.files, fs });
    try {
        await deps.writeConfig({ [MODPACK_RECORD_KEY]: null, [MODPACK_STAGING_KEY]: staging });
    } catch (err) {
        await activation.rollback();
        throw new Error(`Could not record the removal, so the modpack was put back: ${messageOf(err)}`);
    }
    await activation.commit();
    return { removed: record.files.length };
}

/**
 * Settles what an interrupted pack install or removal left. Runs at service
 * start, after the software install's own recovery.
 */
export async function recoverInterruptedModpack(deps: Pick<ModpackDeps, "serverDir" | "readConfig" | "fs">) {
    const staging = (await deps.readConfig())[MODPACK_STAGING_KEY];
    return recoverStagedPacks(await deps.serverDir(), typeof staging === "string" ? staging : null, deps.fs);
}
