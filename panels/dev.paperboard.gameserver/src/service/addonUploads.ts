import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { SOFTWARE, type ServerSoftwareType } from "../software/catalog";
import {
    MAX_UPLOAD_ARCHIVE_BYTES,
    MAX_UPLOAD_ITEMS,
    addonStageDir,
    archiveProblem,
    type ArchiveKind,
} from "../core/addonUpload";
import { assertDatapackName } from "../core/datapacks";
import { isPluginFilename } from "../core/plugins";
import { datapacksDir } from "./datapacks";
import { installUploadedModpack, type ModpackDeps, type ModpackInstallOutcome } from "./modpacks";
import { zipEntryNames } from "./worldTransfer";
import { assertZipFile } from "./zipFiles";
import { updateUploadRecords, type UploadRecordDeps } from "./uploadRecords";

// Add-ons the user uploaded from disk. The page copied them into a staging
// folder (core/addonUpload addonStageDir); this checks every one, moves them
// into place all together or not at all, remembers they were uploaded, and
// always removes the staging folder. A message names each file it refused.

export interface UploadDeps extends UploadRecordDeps {
    serverDir(): Promise<string>;
    /** server.properties' level-name: the world whose datapacks apply */
    levelName(): Promise<string>;
}

export interface UploadOutcome {
    /** what was added, by file or folder name */
    added: string[];
}

const NOT_THERE = "Nothing was uploaded. Choose the files again.";

interface StagedEntry {
    name: string;
    path: string;
    isFile: boolean;
    isDirectory: boolean;
}

interface UploadPlan {
    /** where the entries go, below the server folder */
    targetDir: string;
    /** why this staged entry cannot be added, or null */
    problem(entry: StagedEntry): Promise<string | null>;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function exists(path: string): Promise<boolean> {
    try {
        await nodeFs.lstat(path);
        return true;
    } catch (err) {
        if ((err as { code?: string } | null)?.code === "ENOENT") return false;
        throw err;
    }
}

/** the problem with a staged zip file as an add-on of `kind`, or null */
async function zipProblem(entry: StagedEntry, kind: ArchiveKind): Promise<string | null> {
    if (!entry.isFile) return `${entry.name} is a folder, not a file.`;
    const size = (await nodeFs.lstat(entry.path)).size;
    if (size > MAX_UPLOAD_ARCHIVE_BYTES) return `${entry.name} is over the ${MAX_UPLOAD_ARCHIVE_BYTES / 1024 / 1024} MiB limit.`;
    try {
        await assertZipFile(entry.path, entry.name);
    } catch (err) {
        return `${errorMessage(err)}.`;
    }
    try {
        return archiveProblem(await zipEntryNames(entry.path), kind, entry.name);
    } catch (err) {
        return `${entry.name} could not be read: ${errorMessage(err)}.`;
    }
}

async function commit(deps: UploadDeps, stage: unknown, plan: UploadPlan): Promise<UploadOutcome> {
    const root = await deps.serverDir();
    const stageDir = nodePath.join(root, ...addonStageDir(stage).split("/"));
    try {
        let listed;
        try {
            listed = await nodeFs.readdir(stageDir, { withFileTypes: true });
        } catch (err) {
            if ((err as { code?: string } | null)?.code === "ENOENT") throw new Error(NOT_THERE);
            throw err;
        }
        if (listed.length === 0) throw new Error(NOT_THERE);
        if (listed.length > MAX_UPLOAD_ITEMS) throw new Error(`Add at most ${MAX_UPLOAD_ITEMS} at a time`);

        const entries: StagedEntry[] = listed
            .map((d) => ({ name: d.name, path: nodePath.join(stageDir, d.name), isFile: d.isFile(), isDirectory: d.isDirectory() }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const targetDir = nodePath.join(root, ...plan.targetDir.split("/"));
        const problems: string[] = [];
        for (const entry of entries) {
            if (!entry.isFile && !entry.isDirectory) {
                problems.push(`${entry.name} is neither a file nor a folder.`);
                continue;
            }
            const problem = await plan.problem(entry);
            if (problem) problems.push(problem);
            else if (await exists(nodePath.join(targetDir, entry.name))) {
                problems.push(`${entry.name} is already in ${plan.targetDir}/. Remove it first if you want to replace it.`);
            }
        }
        if (problems.length > 0) {
            throw new Error(`${problems.join(" ")} Nothing was added.`);
        }

        await nodeFs.mkdir(targetDir, { recursive: true });
        const moved: StagedEntry[] = [];
        const putBack = async () => {
            for (const entry of moved) {
                await nodeFs.rename(nodePath.join(targetDir, entry.name), entry.path).catch((err) =>
                    console.error(`[Service:Uploads] could not undo adding ${entry.name}:`, err),
                );
            }
        };
        try {
            for (const entry of entries) {
                await nodeFs.rename(entry.path, nodePath.join(targetDir, entry.name));
                moved.push(entry);
            }
            const at = Date.now();
            await updateUploadRecords(deps, (records) => {
                for (const entry of entries) records[`${plan.targetDir}/${entry.name}`] = { at };
            });
        } catch (err) {
            await putBack();
            throw new Error(`${errorMessage(err)}. Nothing was added.`);
        }
        return { added: entries.map((e) => e.name) };
    } finally {
        await nodeFs.rm(stageDir, { recursive: true, force: true });
    }
}

/** Adds uploaded .jar files to plugins/ or mods/, whichever this software loads. */
export function uploadPlugins(stage: unknown, software: ServerSoftwareType, deps: UploadDeps): Promise<UploadOutcome> {
    const addons = SOFTWARE[software].addons;
    if (!addons) throw new Error(`${SOFTWARE[software].name} servers have no plugins or mods`);
    return commit(deps, stage, {
        targetDir: addons.dir,
        problem: async (entry) => {
            if (!entry.isFile) return `${entry.name} is a folder; upload .jar files.`;
            if (!isPluginFilename(entry.name)) {
                return `${entry.name} cannot be used as a jar name: use letters, digits, spaces and . _ ( ) + - only, and end it in .jar.`;
            }
            return zipProblem(entry, addons.kind);
        },
    });
}

const DATAPACK_MARKER = "pack.mcmeta";
const MAX_PACK_ENTRIES = 5000;

/** a folder that is a datapack: pack.mcmeta at its top, and nothing but files and folders in it */
async function folderProblem(entry: StagedEntry): Promise<string | null> {
    const marker = await nodeFs.lstat(nodePath.join(entry.path, DATAPACK_MARKER)).catch((err) => {
        if ((err as { code?: string } | null)?.code === "ENOENT") return null;
        throw err;
    });
    if (!marker?.isFile()) return `${entry.name} is not a datapack: it has no ${DATAPACK_MARKER} at its top.`;
    let seen = 0;
    const walk = async (dir: string): Promise<string | null> => {
        for (const child of await nodeFs.readdir(dir, { withFileTypes: true })) {
            if (++seen > MAX_PACK_ENTRIES) return `${entry.name} holds over ${MAX_PACK_ENTRIES} files.`;
            if (child.isDirectory()) {
                const inner = await walk(nodePath.join(dir, child.name));
                if (inner) return inner;
            } else if (!child.isFile()) {
                return `${entry.name} holds ${child.name}, which is not a regular file.`;
            }
        }
        return null;
    };
    return walk(entry.path);
}

/** Adds uploaded .zip files and folders to the active world's datapacks/ folder. */
export async function uploadDatapacks(stage: unknown, deps: UploadDeps): Promise<UploadOutcome> {
    const { relative } = await datapacksDir(deps);
    return commit(deps, stage, {
        targetDir: relative,
        problem: async (entry) => {
            try {
                assertDatapackName(entry.name);
            } catch (err) {
                return `${entry.name} cannot be used as a datapack name (${errorMessage(err)}).`;
            }
            if (entry.isDirectory) return folderProblem(entry);
            if (!entry.name.toLowerCase().endsWith(".zip")) return `${entry.name} is not a datapack: upload a .zip or a folder.`;
            return zipProblem(entry, "datapack");
        },
    });
}

/** Removes a staged upload the page gave up on. */
export async function discardUpload(stage: unknown, deps: Pick<UploadDeps, "serverDir">): Promise<void> {
    await nodeFs.rm(nodePath.join(await deps.serverDir(), ...addonStageDir(stage).split("/")), { recursive: true, force: true });
}

/**
 * Installs the uploaded .mrpack as the server's modpack. The page staged it
 * as pack.mrpack; it is consumed or discarded either way.
 */
export async function uploadModpack(stage: unknown, software: ServerSoftwareType, deps: ModpackDeps): Promise<ModpackInstallOutcome> {
    const dir = addonStageDir(stage);
    try {
        return await installUploadedModpack(`${dir}/pack.mrpack`, software, deps);
    } finally {
        await discardUpload(stage, deps);
    }
}
