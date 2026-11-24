// Swapping a backup's files into a panel's storage. Each of the backup's
// paths is parked whole in the daemon's work folder and the backup's copy
// moved in; what the backup left out (its exclude) moves back from the
// parked copy, so a restore never touches it. A journal beside the parked
// copies names the swap until it is committed: a crash in between is rolled
// back at the next start (recoverRestores), the way a failed restore is.
// Every step is a rename, so the swap and its rollback are quick.
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { logger } from "../core/logger";
import { writeFileAtomicSync } from "../core/storage";
import { errorCode, errorMessage } from "@mileniumhq/paperapi/errors";
import { requirePanelId } from "@mileniumhq/paperapi/panelIdentity";

interface Journal {
    panelId: string;
    paths: string[];
    exclude: string[];
}

const JOURNAL = "journal.json";
const PARKED = "parked";

/** the excluded paths under `named` ("" holds them all) */
const under = (named: string, exclude: string[]) => exclude.filter((e) => named === "" || e.startsWith(`${named}/`));

const at = (root: string, relative: string) => (relative === "" ? root : path.join(root, ...relative.split("/")));

function move(from: string, to: string): void {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
}

/** puts every parked path back as it was, from whatever point the swap reached */
function undo(storageDir: string, dir: string, journal: Journal): void {
    const parked = path.join(dir, PARKED);
    for (const named of journal.paths) {
        const original = at(parked, named);
        // never parked: the live copy is still the original
        if (!fs.existsSync(original)) continue;
        // what the backup left out went back to live: it returns to the original first
        for (const excluded of under(named, journal.exclude)) {
            const live = at(storageDir, excluded);
            if (fs.existsSync(live) && !fs.existsSync(at(parked, excluded))) move(live, at(parked, excluded));
        }
        fs.rmSync(at(storageDir, named), { recursive: true, force: true });
        move(original, at(storageDir, named));
    }
    fs.rmSync(dir, { recursive: true, force: true });
}

export interface RestoreSwap {
    /** keeps the backup's files; the parked originals go */
    commit(): Promise<void>;
    /** puts the original files back */
    rollback(): void;
}

/**
 * Swaps `stagedFiles` (a backup's files/ folder) into the panel's storage
 * for each of the backup's paths. Returns once the backup's files are in
 * place; a failure on the way puts the originals back before it throws.
 */
export function swapIn(workDir: string, panelId: string, storageDir: string, stagedFiles: string, contents: { paths: string[]; exclude: string[] }): RestoreSwap {
    const dir = path.join(workDir, `restore-${randomUUID()}`);
    const parked = path.join(dir, PARKED);
    const journal: Journal = { panelId: requirePanelId(panelId), paths: contents.paths, exclude: contents.exclude };
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
        for (const named of contents.paths) {
            const live = at(storageDir, named);
            if (fs.existsSync(live)) move(live, at(parked, named));
            const staged = at(stagedFiles, named);
            if (fs.existsSync(staged)) move(staged, live);
            else if (named === "") fs.mkdirSync(live, { recursive: true });
            for (const excluded of under(named, contents.exclude)) {
                const original = at(parked, excluded);
                if (!fs.existsSync(original)) continue;
                // a backup holds nothing it left out; an archive that does is not trusted with it
                fs.rmSync(at(storageDir, excluded), { recursive: true, force: true });
                move(original, at(storageDir, excluded));
            }
        }
    } catch (err) {
        try {
            rollback();
        } catch (undoErr) {
            throw new Error(`${errorMessage(err)}; then ${errorMessage(undoErr)}`, { cause: err });
        }
        throw err;
    }
    return { commit: () => fs.promises.rm(dir, { recursive: true, force: true }), rollback };
}

/**
 * Startup only, by the daemon that owns the data dir, before panel services
 * start: a restore a crash interrupted is rolled back, its panel's files
 * put back as they were, and what other backups left in the work folder
 * (archives, unpacked copies) goes.
 */
export function recoverRestores(workDir: string, storageOf: (panelId: string) => string): void {
    let entries: string[];
    try {
        entries = fs.readdirSync(workDir);
    } catch (err) {
        if (errorCode(err) === "ENOENT") return;
        throw err;
    }
    for (const name of entries) {
        const dir = path.join(workDir, name);
        if (!name.startsWith("restore-")) {
            fs.rmSync(dir, { recursive: true, force: true });
            continue;
        }
        let journal: Journal;
        try {
            journal = JSON.parse(fs.readFileSync(path.join(dir, JOURNAL), "utf8"));
        } catch (err) {
            // the journal is written before anything is parked: without one, nothing was
            if (errorCode(err) !== "ENOENT") throw err;
            fs.rmSync(dir, { recursive: true, force: true });
            continue;
        }
        undo(storageOf(requirePanelId(journal.panelId)), dir, journal);
        logger.warn(`[backups] put ${journal.panelId}'s files back after an interrupted restore`);
    }
}
