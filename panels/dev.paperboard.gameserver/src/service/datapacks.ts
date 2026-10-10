import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import {
    DATAPACK_LOADER,
    DATAPACK_RECORDS_KEY,
    assertDatapackName,
    datapackRecordKey,
    parseDatapackRecords,
    pickDatapackBuild,
    type DatapackRecord,
} from "../core/datapacks";
import {
    MODRINTH_API,
    assertModrinthId,
    parseModrinthProject,
    parseModrinthVersion,
    type ModrinthVersion,
    type RawModrinthProject,
    type RawModrinthVersion,
} from "../core/modrinth";
import { isListableDirArg } from "../core/dirs";

// The Datapacks tab's owner: lists the active world's datapacks/ folder,
// installs Modrinth datapack builds into it, and moves removed packs to
// the trash. The page names a Modrinth project (and optionally a version);
// which file lands where is decided here from Modrinth's own record.

/** a folder listing longer than this is cut, and says so */
export const MAX_LISTED_DATAPACKS = 500;

export interface DatapackFs {
    readdir(path: string, opts: { withFileTypes: true }): Promise<{ name: string; isDirectory(): boolean; isFile(): boolean }[]>;
    lstat(path: string): Promise<unknown>;
}

export interface DatapackDeps {
    serverDir(): Promise<string>;
    /** server.properties' level-name: the world whose datapacks apply */
    levelName(): Promise<string>;
    fetchJson<T>(url: string): Promise<T>;
    /** downloads into the server folder, verifying sha1; targetPath is relative to it */
    download(opts: { url: string; targetPath: string; sha1: string }): Promise<unknown>;
    readConfig(): Promise<Record<string, unknown>>;
    writeConfig(patch: Record<string, unknown>): Promise<void>;
    /** recoverable removal of server-folder-relative paths */
    trash(paths: string[]): Promise<void>;
    fs?: DatapackFs;
}

export interface InstalledDatapack {
    name: string;
    kind: "zip" | "folder";
    record?: DatapackRecord;
}

export interface DatapackListing {
    world: string;
    /** false until the server has created the world (level.dat); packs installed now apply when it does */
    worldExists: boolean;
    packs: InstalledDatapack[];
    truncated: boolean;
}

function errorCode(err: unknown): string | undefined {
    return (err as { code?: string } | null)?.code;
}

async function exists(fs: DatapackFs, path: string): Promise<boolean> {
    try {
        await fs.lstat(path);
        return true;
    } catch (err) {
        if (errorCode(err) === "ENOENT") return false;
        throw err;
    }
}

async function datapacksDir(deps: DatapackDeps): Promise<{ world: string; relative: string }> {
    const world = await deps.levelName();
    const relative = `${world}/datapacks`;
    if (!isListableDirArg(relative)) {
        throw new Error(`level-name ${JSON.stringify(world)} is not a folder Paperboard can use`);
    }
    return { world, relative };
}

export async function listDatapacks(deps: DatapackDeps): Promise<DatapackListing> {
    const fs = deps.fs ?? (nodeFs as unknown as DatapackFs);
    const root = await deps.serverDir();
    const { world, relative } = await datapacksDir(deps);
    // level.dat, not the folder: installing a pack creates <world>/datapacks/
    // before the server has generated anything
    const worldExists = await exists(fs, nodePath.join(root, world, "level.dat"));
    let entries: Awaited<ReturnType<DatapackFs["readdir"]>>;
    try {
        entries = await fs.readdir(nodePath.join(root, ...relative.split("/")), { withFileTypes: true });
    } catch (err) {
        // no datapacks/ folder is no datapacks; anything else is a failure
        if (errorCode(err) !== "ENOENT") throw err;
        entries = [];
    }
    const records = parseDatapackRecords((await deps.readConfig())[DATAPACK_RECORDS_KEY]);
    const packs: InstalledDatapack[] = [];
    for (const entry of entries) {
        const isZip = entry.isFile() && entry.name.toLowerCase().endsWith(".zip");
        if (!isZip && !entry.isDirectory()) continue;
        try {
            assertDatapackName(entry.name);
        } catch (err) {
            // a name Paperboard cannot address is left alone, not offered for removal
            console.debug("[Service:Datapacks] skipping", JSON.stringify(entry.name), String(err));
            continue;
        }
        packs.push({
            name: entry.name,
            kind: isZip ? "zip" : "folder",
            record: records[datapackRecordKey(world, entry.name)],
        });
    }
    packs.sort((a, b) => a.name.localeCompare(b.name));
    return {
        world,
        worldExists,
        packs: packs.slice(0, MAX_LISTED_DATAPACKS),
        truncated: packs.length > MAX_LISTED_DATAPACKS,
    };
}

// one records write at a time: two quick installs must not both read the
// old records and the second drop the first's entry
let recordsQueue: Promise<unknown> = Promise.resolve();

function updateRecords(deps: DatapackDeps, change: (records: Record<string, DatapackRecord>) => void): Promise<void> {
    const run = recordsQueue.then(async () => {
        const records = parseDatapackRecords((await deps.readConfig())[DATAPACK_RECORDS_KEY]);
        change(records);
        await deps.writeConfig({ [DATAPACK_RECORDS_KEY]: records });
    });
    recordsQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

export async function listDatapackVersions(
    projectId: unknown,
    mcVersion: string,
    deps: Pick<DatapackDeps, "fetchJson">,
): Promise<ModrinthVersion[]> {
    const id = assertModrinthId(projectId, "Project");
    if (!mcVersion) throw new Error("Choose a server version before installing datapacks.");
    const query = new URLSearchParams({
        loaders: JSON.stringify([DATAPACK_LOADER]),
        game_versions: JSON.stringify([mcVersion]),
        include_changelog: "false",
    });
    const raw = await deps.fetchJson<RawModrinthVersion[]>(
        `${MODRINTH_API}/project/${encodeURIComponent(id)}/version?${query}`,
    );
    if (!Array.isArray(raw)) throw new Error("Modrinth returned no version list");
    return raw.map(parseModrinthVersion).filter((v): v is ModrinthVersion => v !== null);
}

export async function installDatapack(
    input: { projectId: unknown; versionId?: unknown },
    mcVersion: string,
    deps: DatapackDeps,
): Promise<{ name: string; world: string; version: string }> {
    const projectId = assertModrinthId(input.projectId, "Project");
    const versionId =
        input.versionId === undefined || input.versionId === "" ? undefined : assertModrinthId(input.versionId, "Version");
    const fs = deps.fs ?? (nodeFs as unknown as DatapackFs);

    const versions = await listDatapackVersions(projectId, mcVersion, deps);
    const { version, file } = pickDatapackBuild(versions, mcVersion, versionId);
    if (version.projectId !== projectId) {
        throw new Error("Modrinth answered with a different project's version");
    }
    const project = parseModrinthProject(
        await deps.fetchJson<RawModrinthProject>(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`),
    );
    if (project.projectId !== projectId) throw new Error("Modrinth answered with a different project");

    const root = await deps.serverDir();
    const { world, relative } = await datapacksDir(deps);
    const target = `${relative}/${file.filename}`;
    if (await exists(fs, nodePath.join(root, ...target.split("/")))) {
        throw new Error(`${file.filename} is already in ${relative}/`);
    }
    await deps.download({ url: file.url, targetPath: target, sha1: file.sha1 });
    await updateRecords(deps, (records) => {
        records[datapackRecordKey(world, file.filename)] = {
            projectId,
            slug: project.slug,
            title: project.title,
            version: version.versionNumber,
            ...(project.iconUrl ? { iconUrl: project.iconUrl } : {}),
        };
    });
    return { name: file.filename, world, version: version.versionNumber };
}

export async function removeDatapack(name: unknown, deps: DatapackDeps): Promise<void> {
    const safe = assertDatapackName(name);
    const { world, relative } = await datapacksDir(deps);
    await deps.trash([`${relative}/${safe}`]);
    await updateRecords(deps, (records) => {
        delete records[datapackRecordKey(world, safe)];
    });
}
