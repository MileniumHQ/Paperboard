// Replacing something live (a runtime package, a panel release, a panel's
// data) parks the live copy beside it under a dot name, puts the new one in
// place, and drops the parked copy once the new one works. A failure puts the
// parked copy back. A crash in between leaves the parked copy on disk, and
// the next start recovers it (recoverParked): with no live copy it goes back,
// beside one it is a finished swap's leftover and goes.
import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { errorCode, errorMessage } from "@mileniumhq/paperapi/errors";

/** What a parked copy is called: `.<tag>-<stamp>-<name>`, beside the live one. */
function parkedPath(live: string, tag: string, stamp: number): string {
    return path.join(path.dirname(live), `.${tag}-${stamp}-${path.basename(live)}`);
}

/** An operation failed and so did undoing it: one error naming both, caused by the first. */
export function rollbackFailed(err: unknown, rollbackErr: unknown, detail = ""): Error {
    return new Error(`${errorMessage(err)}; then the rollback failed too: ${errorMessage(rollbackErr)}${detail}`, { cause: err });
}

/**
 * Parks every existing `lives` path, then runs `install`, which puts the new
 * copies in place. When install fails, `undo.before` runs (stop what uses the
 * new copies), the new copies are removed and the parked ones put back, then
 * `undo.after` runs (start what uses them again). A rollback that fails too
 * throws one error naming both (rollbackFailed).
 */
export async function swapParked(
    lives: string[],
    tag: string,
    install: () => Promise<void>,
    undo: { before?: () => Promise<void>; after?: () => Promise<void> } = {},
): Promise<void> {
    const stamp = Date.now();
    const parked: Array<{ live: string; copy: string }> = [];
    // a live copy that could not be parked is still the only one: nothing
    // was replaced, so the rollback leaves it alone
    let installing = false;
    try {
        for (const live of lives) {
            if (!fs.existsSync(live)) continue;
            const copy = parkedPath(live, tag, stamp);
            await fs.promises.rename(live, copy);
            parked.push({ live, copy });
        }
        installing = true;
        await install();
    } catch (err) {
        try {
            await undo.before?.();
            if (installing) {
                for (const live of lives) await fs.promises.rm(live, { recursive: true, force: true });
            }
            for (const { live, copy } of parked) await fs.promises.rename(copy, live);
            await undo.after?.();
        } catch (rollbackErr) {
            const left = parked.filter(({ copy }) => fs.existsSync(copy)).map(({ copy }) => copy);
            throw rollbackFailed(err, rollbackErr, left.length ? ` (the previous copy is kept at ${left.join(" and ")})` : "");
        }
        throw err;
    }
    for (const { copy } of parked) {
        await fs.promises.rm(copy, { recursive: true, force: true })
            .catch((err) => logger.warn(`[engine] the previous copy at ${copy} could not be removed:`, err));
    }
}

/**
 * Startup recovery for swaps a crash interrupted in `dir`: a parked copy
 * whose live one is missing is put back, one beside a live copy is removed.
 * Run only by the daemon that owns the data dir, before anything swaps.
 */
export function recoverParked(dir: string, tag: string): void {
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch (err) {
        if (errorCode(err) !== "ENOENT") logger.error(`[engine] could not look for interrupted updates in ${dir}:`, err);
        return;
    }
    const pattern = new RegExp(`^\\.${tag}-\\d+-(.+)$`);
    for (const entry of entries) {
        const name = pattern.exec(entry)?.[1];
        if (!name) continue;
        const copy = path.join(dir, entry);
        const live = path.join(dir, name);
        try {
            if (fs.existsSync(live)) {
                fs.rmSync(copy, { recursive: true, force: true });
            } else {
                fs.renameSync(copy, live);
                logger.warn(`[engine] put ${live} back after an interrupted update`);
            }
        } catch (err) {
            logger.error(`[engine] could not recover ${copy} after an interrupted update:`, err);
        }
    }
}
