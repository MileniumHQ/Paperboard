import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { safePackPath } from "../core/modpack";
import { exists, moveNoClobber, type ActivationFs } from "./activation";
import { trashDirName } from "./trash";

// Placing a modpack's files, as a transaction on the server folder. The
// software install (activation.ts) swaps whole top-level entries; a pack
// writes single files deep inside folders the user also owns (mods/,
// config/), so it moves file by file.
//
// The pack's files are prepared in `.modpack-<id>/files/`. Activation:
//
//   1. writes `.modpack-<id>/journal.json` naming every path it will move
//   2. parks each live path the pack would land on, and each path the pack
//      replaces (the previous pack's leftovers, the mods it supersedes), in
//      `.modpack-<id>/previous/`
//   3. moves the prepared files into place
//
// Any failure moves everything back. Once the caller has recorded the new
// pack, commit() sends every parked file to a `.trash-<ts>` folder (an
// edited config the pack overwrote stays recoverable) and removes the
// staging folder. A crash leaves the journal: recoverStagedPacks() at
// service start commits the staging folder the pack record names and
// rolls back any other.

export const PACK_STAGING_PATTERN = /^\.modpack-[A-Za-z0-9-]+$/;
const FILES_DIR = "files";
const PARKED_DIR = "previous";
const JOURNAL_FILE = "journal.json";

export interface PackFs extends ActivationFs {
    rmdir(path: string): Promise<void>;
}

export interface PackJournal {
    version: 1;
    /** paths moved from files/ into the server folder */
    staged: string[];
    /** server-folder paths parked in previous/ */
    displaced: string[];
    /** folders activation created, removed again on rollback when empty */
    createdDirs: string[];
}

let counter = 0;

export function newPackStagingName(stamp: number = Date.now()): string {
    counter = (counter + 1) % 1_000_000;
    return `.modpack-${stamp}-${counter}`;
}

/** Where a pack's files are prepared, relative to the server folder. */
export function packFilesPath(staging: string): string {
    return `${staging}/${FILES_DIR}`;
}

function assertStaging(staging: string): void {
    if (!PACK_STAGING_PATTERN.test(staging)) {
        throw new Error(`Refusing unsafe modpack staging directory: ${JSON.stringify(staging)}`);
    }
}

function assertPaths(paths: readonly string[], what: string): void {
    for (const path of paths) {
        if (safePackPath(path) === null) throw new Error(`Refusing unsafe ${what} path ${JSON.stringify(path)}`);
    }
}

const inDir = (dir: string, path: string) => nodePath.join(dir, ...path.split("/"));

function errorCode(err: unknown): string | undefined {
    return (err as { code?: string } | null)?.code;
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function ancestors(path: string): string[] {
    const segments = path.split("/");
    return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join("/"));
}

export interface PackActivationRequest {
    root: string;
    staging: string;
    /** paths prepared under files/, to place */
    staged: readonly string[];
    /** live paths the pack replaces; parked even where nothing lands on them */
    replace: readonly string[];
    fs?: PackFs;
}

export interface PackActivation {
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

export async function activatePack(request: PackActivationRequest): Promise<PackActivation> {
    const fs = request.fs ?? (nodeFs as unknown as PackFs);
    const { root, staging } = request;
    assertStaging(staging);
    assertPaths(request.staged, "pack");
    assertPaths(request.replace, "replaced");
    const stagingDir = nodePath.join(root, staging);

    const staged = [...new Set(request.staged)].sort();
    const candidates = [...new Set([...request.replace, ...staged])];
    const present: string[] = [];
    for (const path of candidates) {
        if (await exists(fs, inDir(root, path))) present.push(path);
    }
    // a path inside another parked path leaves with it
    const presentSet = new Set(present);
    const displaced = present.filter((path) => !ancestors(path).some((dir) => presentSet.has(dir))).sort();

    const createdDirs = new Set<string>();
    for (const path of staged) {
        for (const dir of ancestors(path)) {
            if (!createdDirs.has(dir) && !(await exists(fs, inDir(root, dir)))) createdDirs.add(dir);
        }
    }

    const journal: PackJournal = { version: 1, staged, displaced, createdDirs: [...createdDirs].sort() };
    // written whole or not at all; a missing journal means nothing moved
    const journalTmp = nodePath.join(stagingDir, `${JOURNAL_FILE}.tmp`);
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(journalTmp, JSON.stringify(journal));
    await fs.rename(journalTmp, nodePath.join(stagingDir, JOURNAL_FILE));

    try {
        // everything displaced leaves before anything arrives: rollback
        // relies on that order
        for (const path of displaced) {
            const parked = inDir(nodePath.join(stagingDir, PARKED_DIR), path);
            await fs.mkdir(nodePath.dirname(parked), { recursive: true });
            await moveNoClobber(fs, inDir(root, path), parked);
        }
        for (const path of staged) {
            const live = inDir(root, path);
            await fs.mkdir(nodePath.dirname(live), { recursive: true });
            await moveNoClobber(fs, inDir(nodePath.join(stagingDir, FILES_DIR), path), live);
        }
    } catch (err) {
        try {
            await rollbackPack(root, staging, journal, fs);
        } catch (rollbackErr) {
            throw new Error(
                `Placing the modpack failed (${messageOf(err)}) and restoring the previous files also failed (${messageOf(rollbackErr)}). ` +
                    `They are kept in ${staging}/${PARKED_DIR}; the panel retries the restore when its service restarts.`,
            );
        }
        throw new Error(`Placing the modpack failed; the previous files were restored: ${messageOf(err)}`);
    }

    return {
        commit: () => commitPack(root, staging, journal, fs),
        rollback: () => rollbackPack(root, staging, journal, fs),
    };
}

/** Puts the server folder back the way it was. Safe to repeat after an interruption. */
export async function rollbackPack(
    root: string,
    staging: string,
    journal: PackJournal,
    fs: PackFs = nodeFs as unknown as PackFs,
): Promise<void> {
    assertStaging(staging);
    const stagingDir = nodePath.join(root, staging);
    const filesDir = nodePath.join(stagingDir, FILES_DIR);
    const parkedDir = nodePath.join(stagingDir, PARKED_DIR);
    for (const path of [...journal.staged].reverse()) {
        const live = inDir(root, path);
        const home = inDir(filesDir, path);
        if (!(await exists(fs, home)) && (await exists(fs, live))) {
            await fs.mkdir(nodePath.dirname(home), { recursive: true });
            await fs.rename(live, home);
        }
    }
    for (const path of [...journal.displaced].reverse()) {
        const parked = inDir(parkedDir, path);
        if (await exists(fs, parked)) {
            await fs.mkdir(nodePath.dirname(inDir(root, path)), { recursive: true });
            await moveNoClobber(fs, parked, inDir(root, path));
        }
    }
    // deepest first; a folder something else now uses stays
    for (const dir of [...journal.createdDirs].sort((a, b) => b.length - a.length)) {
        try {
            await fs.rmdir(inDir(root, dir));
        } catch (err) {
            const code = errorCode(err);
            if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") throw err;
        }
    }
    await fs.rm(stagingDir, { recursive: true, force: true });
}

/** Finishes an activation the pack record already names. Safe to repeat. */
export async function commitPack(
    root: string,
    staging: string,
    journal: PackJournal,
    fs: PackFs = nodeFs as unknown as PackFs,
): Promise<void> {
    assertStaging(staging);
    const stagingDir = nodePath.join(root, staging);
    const parkedDir = nodePath.join(stagingDir, PARKED_DIR);
    let trash: string | null = null;
    for (const path of journal.displaced) {
        const parked = inDir(parkedDir, path);
        if (!(await exists(fs, parked))) continue;
        trash ??= trashDirName();
        const target = inDir(nodePath.join(root, trash), path);
        await fs.mkdir(nodePath.dirname(target), { recursive: true });
        await moveNoClobber(fs, parked, target);
    }
    await fs.rm(stagingDir, { recursive: true, force: true });
}

export function parsePackJournal(raw: string): PackJournal {
    const value = JSON.parse(raw) as Partial<PackJournal>;
    const paths = (list: unknown): list is string[] =>
        Array.isArray(list) && list.every((path) => safePackPath(path) !== null);
    if (value?.version !== 1 || !paths(value.staged) || !paths(value.displaced) || !paths(value.createdDirs)) {
        throw new Error("Modpack journal is not in a format this panel wrote");
    }
    return { version: 1, staged: value.staged, displaced: value.displaced, createdDirs: value.createdDirs };
}

export interface PackRecoveryResult {
    committed: string[];
    rolledBack: string[];
    discarded: string[];
}

/**
 * Settles staging folders an interrupted modpack install or removal left.
 * Runs at service start, before anything else touches the server folder.
 */
export async function recoverStagedPacks(
    root: string,
    committedStaging: string | null,
    fs: PackFs = nodeFs as unknown as PackFs,
): Promise<PackRecoveryResult> {
    const result: PackRecoveryResult = { committed: [], rolledBack: [], discarded: [] };
    for (const entry of await fs.readdir(root)) {
        if (!PACK_STAGING_PATTERN.test(entry)) continue;
        const stagingDir = nodePath.join(root, entry);
        let raw: string | null;
        try {
            raw = await fs.readFile(nodePath.join(stagingDir, JOURNAL_FILE), "utf8");
        } catch (err) {
            if (errorCode(err) !== "ENOENT") throw err;
            raw = null;
        }
        if (raw === null) {
            // never activated: only downloads and extracted overrides
            await fs.rm(stagingDir, { recursive: true, force: true });
            result.discarded.push(entry);
            continue;
        }
        // an unreadable journal throws and the folder stays: it may hold
        // the only copy of the user's previous files
        const journal = parsePackJournal(raw);
        if (entry === committedStaging) {
            await commitPack(root, entry, journal, fs);
            result.committed.push(entry);
        } else {
            await rollbackPack(root, entry, journal, fs);
            result.rolledBack.push(entry);
        }
    }
    return result;
}
