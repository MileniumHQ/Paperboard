import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { isInstallArtifactName } from "../core/installFiles";
import { trashDirName } from "./trash";

// Swapping one server software for another, as a transaction on the server
// folder.
//
// An install never writes into the live folder. Its files are produced in
// a staging directory `.install-<id>/server/` inside the server folder (one
// filesystem, so every move is a rename). Activation then:
//
//   1. writes `.install-<id>/journal.json` naming every entry it will move
//   2. parks the previous install's files, and any live entry a staged one
//      would land on, in `.install-<id>/previous/`
//   3. moves the staged entries into the server folder
//
// Any failure moves everything back. Once the caller has recorded the new
// install, commit() deletes the previous software's own files, sends
// displaced entries the previous install did not own (a runtime `libraries/`
// cache, say) to a `.trash-<ts>` folder, and removes the staging directory.
//
// A crash mid-way leaves the journal behind. recoverStagedInstalls() runs at
// service start: a staging directory whose id the recorded install names is
// committed, any other is rolled back. Rollback and commit are both safe to
// repeat after an interruption.

export const STAGING_PATTERN = /^\.install-[A-Za-z0-9-]+$/;
const STAGED_DIR = "server";
const PARKED_DIR = "previous";
const JOURNAL_FILE = "journal.json";

export interface ActivationFs {
    mkdir(path: string, opts: { recursive: true }): Promise<unknown>;
    rename(from: string, to: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    rm(path: string, opts: { recursive: true; force: true }): Promise<void>;
    writeFile(path: string, data: string): Promise<void>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    lstat(path: string): Promise<unknown>;
}

export { isInstallArtifactName };

export interface ActivationJournal {
    version: 1;
    /** entries moved from staging into the server folder */
    staged: string[];
    /** server-folder entries parked in previous/ */
    displaced: string[];
    /** the displaced entries the previous install owned; deleted on commit */
    replaced: string[];
}

let stagingCounter = 0;

export function newStagingName(stamp: number = Date.now()): string {
    stagingCounter = (stagingCounter + 1) % 1_000_000;
    return `.install-${stamp}-${stagingCounter}`;
}

/** Where an install writes its server files, relative to the server folder. */
export function stagedFilesPath(staging: string): string {
    return `${staging}/${STAGED_DIR}`;
}


function errorCode(err: unknown): string | undefined {
    return (err as { code?: string } | null)?.code;
}

async function exists(fs: ActivationFs, path: string): Promise<boolean> {
    try {
        await fs.lstat(path);
        return true;
    } catch (err) {
        if (errorCode(err) === "ENOENT") return false;
        throw err;
    }
}

// rename overwrites a file target on POSIX; a move here must never clobber
async function moveNoClobber(fs: ActivationFs, from: string, to: string): Promise<void> {
    if (await exists(fs, to)) {
        throw new Error(`Refusing to overwrite ${nodePath.basename(to)} while moving install files`);
    }
    await fs.rename(from, to);
}

function assertStaging(staging: string): void {
    if (!STAGING_PATTERN.test(staging)) {
        throw new Error(`Refusing unsafe staging directory: ${JSON.stringify(staging)}`);
    }
}

export interface ActivationRequest {
    root: string;
    staging: string;
    /** files the current install recorded as its own */
    replaced: readonly string[];
    fs?: ActivationFs;
}

export interface Activation {
    /** the entries now live in the server folder; the new install's own files */
    installed: string[];
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

export async function activateStagedInstall(request: ActivationRequest): Promise<Activation> {
    const fs = request.fs ?? (nodeFs as unknown as ActivationFs);
    const { root, staging } = request;
    assertStaging(staging);
    const stagingDir = nodePath.join(root, staging);
    const stagedDir = nodePath.join(stagingDir, STAGED_DIR);

    const staged = (await fs.readdir(stagedDir)).sort();
    if (staged.length === 0) throw new Error("The install produced no files");
    for (const name of staged) {
        if (!isInstallArtifactName(name)) {
            throw new Error(`The install produced ${JSON.stringify(name)}, which is not an install file; refusing to activate it`);
        }
    }

    const replaced: string[] = [];
    for (const name of new Set(request.replaced)) {
        if (!isInstallArtifactName(name)) {
            throw new Error(`The recorded install claims ${JSON.stringify(name)}; refusing to remove it`);
        }
        if (await exists(fs, nodePath.join(root, name))) replaced.push(name);
    }
    const displaced = [...replaced];
    for (const name of staged) {
        if (!displaced.includes(name) && (await exists(fs, nodePath.join(root, name)))) {
            displaced.push(name);
        }
    }

    const journal: ActivationJournal = { version: 1, staged, displaced, replaced };
    // written whole or not at all: a torn journal would strand the folder,
    // and a missing one correctly means nothing has moved yet
    const journalTmp = nodePath.join(stagingDir, `${JOURNAL_FILE}.tmp`);
    await fs.writeFile(journalTmp, JSON.stringify(journal));
    await fs.rename(journalTmp, nodePath.join(stagingDir, JOURNAL_FILE));

    try {
        await fs.mkdir(nodePath.join(stagingDir, PARKED_DIR), { recursive: true });
        // every displaced entry leaves before any staged entry arrives:
        // rollback relies on that order
        for (const name of displaced) {
            await moveNoClobber(fs, nodePath.join(root, name), nodePath.join(stagingDir, PARKED_DIR, name));
        }
        for (const name of staged) {
            await moveNoClobber(fs, nodePath.join(stagedDir, name), nodePath.join(root, name));
        }
    } catch (err) {
        try {
            await rollbackStaging(root, staging, journal, fs);
        } catch (rollbackErr) {
            throw new Error(
                `Activating the install failed (${messageOf(err)}) and restoring the previous files also failed (${messageOf(rollbackErr)}). ` +
                    `They are kept in ${staging}/${PARKED_DIR}; the panel retries the restore when its service restarts.`,
            );
        }
        throw new Error(`Activating the install failed; the previous files were restored: ${messageOf(err)}`);
    }

    return {
        installed: staged,
        commit: () => commitStaging(root, staging, journal, fs),
        rollback: () => rollbackStaging(root, staging, journal, fs),
    };
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Puts the server folder back the way it was. Safe to repeat: a staged
 * entry is moved back only if it is live and missing from staging, and a
 * parked entry only if it is still parked.
 */
export async function rollbackStaging(
    root: string,
    staging: string,
    journal: ActivationJournal,
    fs: ActivationFs = nodeFs as unknown as ActivationFs,
): Promise<void> {
    assertStaging(staging);
    const stagingDir = nodePath.join(root, staging);
    const stagedDir = nodePath.join(stagingDir, STAGED_DIR);
    const parkedDir = nodePath.join(stagingDir, PARKED_DIR);
    for (const name of [...journal.staged].reverse()) {
        const live = nodePath.join(root, name);
        const home = nodePath.join(stagedDir, name);
        if (!(await exists(fs, home)) && (await exists(fs, live))) {
            await fs.mkdir(stagedDir, { recursive: true });
            await fs.rename(live, home);
        }
    }
    for (const name of [...journal.displaced].reverse()) {
        const parked = nodePath.join(parkedDir, name);
        if (await exists(fs, parked)) {
            await moveNoClobber(fs, parked, nodePath.join(root, name));
        }
    }
    await fs.rm(stagingDir, { recursive: true, force: true });
}

/** Finishes an activation the install record already names. Safe to repeat. */
export async function commitStaging(
    root: string,
    staging: string,
    journal: ActivationJournal,
    fs: ActivationFs = nodeFs as unknown as ActivationFs,
): Promise<void> {
    assertStaging(staging);
    const stagingDir = nodePath.join(root, staging);
    const parkedDir = nodePath.join(stagingDir, PARKED_DIR);
    const replaced = new Set(journal.replaced);
    let trash: string | null = null;
    for (const name of journal.displaced) {
        const parked = nodePath.join(parkedDir, name);
        if (!(await exists(fs, parked))) continue;
        if (replaced.has(name)) {
            // the previous software's own code: uninstalled with it
            await fs.rm(parked, { recursive: true, force: true });
        } else {
            // not the previous install's; keep it recoverable
            trash ??= trashDirName();
            await fs.mkdir(nodePath.join(root, trash), { recursive: true });
            await moveNoClobber(fs, parked, nodePath.join(root, trash, name));
        }
    }
    await fs.rm(stagingDir, { recursive: true, force: true });
}

export function parseJournal(raw: string): ActivationJournal {
    const value = JSON.parse(raw) as Partial<ActivationJournal>;
    const names = (list: unknown): list is string[] =>
        Array.isArray(list) && list.every((name) => isInstallArtifactName(name));
    if (value?.version !== 1 || !names(value.staged) || !names(value.displaced) || !names(value.replaced)) {
        throw new Error("Install journal is not in a format this panel wrote");
    }
    return { version: 1, staged: value.staged, displaced: value.displaced, replaced: value.replaced };
}

export interface RecoveryResult {
    committed: string[];
    rolledBack: string[];
    discarded: string[];
}

/**
 * Settles staging directories an interrupted install left behind. The
 * caller must already have stopped any installer process: a staging
 * directory is only touched once nothing is writing into it.
 */
export async function recoverStagedInstalls(
    root: string,
    committedStaging: string | null,
    fs: ActivationFs = nodeFs as unknown as ActivationFs,
): Promise<RecoveryResult> {
    const result: RecoveryResult = { committed: [], rolledBack: [], discarded: [] };
    for (const entry of await fs.readdir(root)) {
        if (!STAGING_PATTERN.test(entry)) continue;
        const stagingDir = nodePath.join(root, entry);
        let raw: string | null;
        try {
            raw = await fs.readFile(nodePath.join(stagingDir, JOURNAL_FILE), "utf8");
        } catch (err) {
            if (errorCode(err) !== "ENOENT") throw err;
            raw = null;
        }
        if (raw === null) {
            // never activated: it holds only downloads and installer output
            await fs.rm(stagingDir, { recursive: true, force: true });
            result.discarded.push(entry);
            continue;
        }
        // an unreadable journal throws here and the directory stays put:
        // it may be the only copy of the previous install
        const journal = parseJournal(raw);
        if (entry === committedStaging) {
            await commitStaging(root, entry, journal, fs);
            result.committed.push(entry);
        } else {
            await rollbackStaging(root, entry, journal, fs);
            result.rolledBack.push(entry);
        }
    }
    return result;
}
