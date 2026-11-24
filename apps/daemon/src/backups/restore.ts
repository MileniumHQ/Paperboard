// Swapping a backup's files into a panel's storage. Each of the backup's
// paths is a unit swapped whole: parked in the daemon's work folder, the
// backup's copy moved in, and what the backup left out (its exclude) moved
// back from the parked copy, so a restore never loses it. A path that is
// the whole storage ("") is swapped one top-level entry at a time, so an
// excluded entry there never moves at all (a running sibling keeps its
// folder).
//
// A journal beside the parked copies names the swap until it is committed,
// and committing deletes it before anything else is. A crash before that is
// rolled back at the next start (recoverRestores), the way a failed restore
// is; a crash after it keeps the restored files, and the swap's folder is
// swept as a leftover.
// Every step is a rename, so the swap and its rollback are quick.
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { logger } from "../core/logger";
import { writeFileAtomicSync } from "../core/storage";
import { errorCode, errorMessage } from "@mileniumhq/paperapi/errors";
import { requirePanelId } from "@mileniumhq/paperapi/panelIdentity";

interface Unit {
    /** a path in the panel's storage, swapped whole */
    path: string;
    /** whether the storage had it before the swap; one it didn't goes on rollback */
    existed: boolean;
}

interface Journal {
    panelId: string;
    units: Unit[];
    exclude: string[];
}

const JOURNAL = "journal.json";
const PARKED = "parked";
/** a swap's folder; one without a journal, and anything else in the work folder, is left over */
const SWAPPING = "restore-";

const under = (child: string, parent: string) => child.startsWith(`${parent}/`);

const at = (root: string, relative: string) => path.join(root, ...relative.split("/"));

function move(from: string, to: string): void {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
}

/** the units a backup's paths swap: each path, or for "" each top-level entry either side has that isn't excluded */
function unitsOf(storageDir: string, stagedFiles: string, contents: { paths: string[]; exclude: string[] }): Unit[] {
    const names = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
    const units = contents.paths.flatMap((named) =>
        named === "" ? [...new Set([...names(storageDir), ...names(stagedFiles)])].filter((name) => !contents.exclude.includes(name)) : [named],
    );
    return units.map((unit) => ({ path: unit, existed: fs.existsSync(at(storageDir, unit)) }));
}

/** puts every unit back as it was, from whatever point the swap reached, last first */
function undo(storageDir: string, dir: string, journal: Journal): void {
    const parked = path.join(dir, PARKED);
    for (const unit of [...journal.units].reverse()) {
        const live = at(storageDir, unit.path);
        if (!unit.existed) {
            fs.rmSync(live, { recursive: true, force: true });
            continue;
        }
        const original = at(parked, unit.path);
        // never parked: the live copy is still the original
        if (!fs.existsSync(original)) continue;
        // what the backup left out went back to live: it returns to the original first
        for (const excluded of journal.exclude.filter((e) => under(e, unit.path))) {
            if (fs.existsSync(at(storageDir, excluded)) && !fs.existsSync(at(parked, excluded))) move(at(storageDir, excluded), at(parked, excluded));
        }
        fs.rmSync(live, { recursive: true, force: true });
        move(original, live);
    }
    fs.rmSync(dir, { recursive: true, force: true });
}

export interface RestoreSwap {
    /**
     * Keeps the backup's files: deletes the journal, so a crash from here on
     * keeps them. Throws when it can't, and the swap still stands then, to be
     * rolled back.
     */
    commit(): void;
    /** after commit, deletes the parked originals; never rejects, as the next start sweeps what is left */
    clear(): Promise<void>;
    /** puts the original files back */
    rollback(): void;
}

/**
 * Swaps `stagedFiles` (a backup's files/ folder) into the panel's storage
 * for each of the backup's paths. Returns once the backup's files are in
 * place; a failure on the way puts the originals back before it throws.
 * The paths and excludes must be as checkBackupPaths allows.
 */
export function swapIn(workDir: string, panelId: string, storageDir: string, stagedFiles: string, contents: { paths: string[]; exclude: string[] }): RestoreSwap {
    const id = randomUUID();
    const dir = path.join(workDir, `${SWAPPING}${id}`);
    const parked = path.join(dir, PARKED);
    const journal: Journal = { panelId: requirePanelId(panelId), units: unitsOf(storageDir, stagedFiles, contents), exclude: contents.exclude };
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomicSync(path.join(dir, JOURNAL), JSON.stringify(journal));
    const rollback = () => {
        try {
            undo(storageDir, dir, journal);
        } catch (err) {
            throw new Error(`Putting the files back failed: ${errorMessage(err)}. The originals are kept at ${parked}`, { cause: err });
        }
    };
    try {
        for (const unit of journal.units) {
            const live = at(storageDir, unit.path);
            if (unit.existed) move(live, at(parked, unit.path));
            const staged = at(stagedFiles, unit.path);
            if (fs.existsSync(staged)) move(staged, live);
            for (const excluded of contents.exclude.filter((e) => under(e, unit.path))) {
                // a backup holds nothing it left out; an archive that does is not trusted with it
                fs.rmSync(at(storageDir, excluded), { recursive: true, force: true });
                const original = at(parked, excluded);
                if (fs.existsSync(original)) move(original, at(storageDir, excluded));
            }
        }
        // the storage itself stays, even when the backup had nothing in it
        fs.mkdirSync(storageDir, { recursive: true });
    } catch (err) {
        try {
            rollback();
        } catch (undoErr) {
            throw new Error(`${errorMessage(err)}; then ${errorMessage(undoErr)}`, { cause: err });
        }
        throw err;
    }
    return {
        commit: () => {
            try {
                fs.unlinkSync(path.join(dir, JOURNAL));
            } catch (err) {
                throw new Error(`The restore couldn't be finished, as its journal couldn't be deleted: ${errorMessage(err)}`, { cause: err });
            }
        },
        clear: () =>
            fs.promises.rm(dir, { recursive: true, force: true }).catch((err) => {
                // quiet: the files are restored; the next start sweeps the parked originals
                logger.warn(`[backups] the originals a restore replaced are left in ${dir} until the next start:`, err);
            }),
        rollback,
    };
}

/** an interrupted restore that could not be rolled back: its panel's files are half swapped */
export interface UnrecoveredRestore {
    /** null when even its journal can't be read */
    panelId: string | null;
    /** where its parked originals are kept */
    kept: string;
    error: string;
}

/**
 * Startup only, by the daemon that owns the data dir, before panel services
 * start: each restore a crash interrupted is rolled back on its own, its
 * panel's files put back as they were, and what other backups left in the
 * work folder (archives, unpacked copies, ended swaps) goes. Resolves with
 * the restores that could not be rolled back, for their panels to say so.
 */
export function recoverRestores(workDir: string, storageOf: (panelId: string) => string): UnrecoveredRestore[] {
    let entries: string[];
    try {
        entries = fs.readdirSync(workDir);
    } catch (err) {
        if (errorCode(err) === "ENOENT") return [];
        throw err;
    }
    const failed: UnrecoveredRestore[] = [];
    const sweep = (dir: string) => {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (err) {
            // quiet: a leftover is only clutter that nothing reads; the next start sweeps it again
            logger.warn(`[backups] couldn't delete ${dir}, left over in the backups' work folder:`, err);
        }
    };
    for (const name of entries) {
        const dir = path.join(workDir, name);
        if (!name.startsWith(SWAPPING)) {
            sweep(dir);
            continue;
        }
        let panelId: string | null = null;
        try {
            let text: string;
            try {
                text = fs.readFileSync(path.join(dir, JOURNAL), "utf8");
            } catch (err) {
                // no journal: nothing was parked yet, or the swap was committed
                if (errorCode(err) !== "ENOENT") throw err;
                sweep(dir);
                continue;
            }
            const journal = JSON.parse(text) as Journal;
            panelId = requirePanelId(journal.panelId);
            undo(storageOf(panelId), dir, journal);
            logger.warn(`[backups] put ${panelId}'s files back after an interrupted restore`);
        } catch (err) {
            failed.push({ panelId, kept: path.join(dir, PARKED), error: errorMessage(err) });
        }
    }
    return failed;
}
