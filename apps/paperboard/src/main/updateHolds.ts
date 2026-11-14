// Updates held back because something people rely on is using what they
// replace: staged packages each computer's daemon reports, and panels whose
// processes were running. They are looked at again while any are held, and
// Stop and update releases them.
import connectionPool from "./communication/papercrane/ConnectionPool";
import { logger } from "../../papercrane/logger";
import { collectPackageUpdates } from "./packageUpdates";
import { updateQueue } from "./updateQueue";
import { failedItem, heldPanels, inUseJob, taskJob } from "./updateTasks";
import type { UpdateHold, UpdateItem } from "../shared/updateQueue";

const HOLD_REFRESH_MS = 30_000;

let holdTimer: ReturnType<typeof setTimeout> | null = null;
// one look at a time: a call while one runs makes it look once more after
let looking: Promise<void> | null = null;
let lookAgain = false;
// Paperboard is quitting: no look arms the timer again
let stopped = false;

// updates that were stopped for without asking and failed: they are not
// tried that way again, so a failing update can't stop processes over and
// over; they wait for Stop and update instead
const stopFailed = new Set<string>();

export function stopHoldRefresh(): void {
    stopped = true;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
}

export function resumeHoldRefresh(): void {
    stopped = false;
}

/**
 * Reads what holds updates back again: staged packages from each computer's
 * daemon, and held panels whose processes may have stopped (their update
 * then runs). While anything is held it looks again every so often. What
 * could not be read is the update list's holdsError.
 */
export function refreshHolds(): Promise<void> {
    if (looking) {
        lookAgain = true;
        return looking;
    }
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    looking = (async () => {
        do {
            lookAgain = false;
            const problems: string[] = [];
            await readPackageHolds(problems);
            await releaseStoppedPanels(problems);
            updateQueue.setHoldsError(problems.length > 0 ? problems.join(" ") : null);
        } while (lookAgain);
    })().finally(() => {
        looking = null;
        if (stopped || updateQueue.snapshot().holds.length === 0) return;
        holdTimer = setTimeout(() => void refreshHolds(), HOLD_REFRESH_MS);
        holdTimer.unref?.();
    });
    return looking;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function readPackageHolds(problems: string[]): Promise<void> {
    try {
        const packages = await collectPackageUpdates();
        const holds: UpdateHold[] = [];
        const unheld: UpdateHold[] = [];
        for (const notice of packages.notices) {
            const key = `package:${notice.computerId}:${notice.packageName}`;
            const computerName = notice.computerId === "local" ? null : notice.computerName;
            if (notice.error) {
                // the swap failed and the installed release kept working
                updateQueue.report(failedItem(key, "package", notice.computerId, computerName, notice.packageName, notice.version, notice.error));
                continue;
            }
            const hold: UpdateHold = {
                key,
                kind: "package",
                computerId: notice.computerId,
                computerName,
                id: notice.packageName,
                name: notice.packageName,
                version: notice.version,
                sha256: null,
                users: notice.panels,
            };
            // nothing important or long running uses it: it updates now,
            // unless doing that already failed (then it waits to be asked)
            if (notice.panels.length === 0 && !stopFailed.has(`${key}\u0000${notice.version}`)) unheld.push(hold);
            else holds.push(hold);
        }
        // a computer that could not say keeps what it held last time
        const unread = new Set(packages.failures.map((failure) => failure.computerId));
        const kept = updateQueue.snapshot().holds.filter((hold) => hold.kind === "package" && unread.has(hold.computerId));
        updateQueue.setHolds("packages", [...holds, ...kept]);
        for (const failure of packages.failures) {
            problems.push(`${failure.computerId === "local" ? "This computer" : failure.computerName} didn't say which updates wait on it: ${failure.error}.`);
        }
        for (const hold of unheld) {
            void updateQueue.enqueue(inUseJob([hold])).then(([item]) => {
                if (item.status === "failed") stopFailed.add(`${hold.key}\u0000${hold.version}`);
            });
        }
    } catch (err) {
        logger.error("[Updater] could not read held package updates:", err);
        problems.push(`${reason(err)}.`);
    }
}

// a held panel whose processes all stopped updates now
async function releaseStoppedPanels(problems: string[]): Promise<void> {
    for (const [key, { task, processes }] of [...heldPanels]) {
        if (!updateQueue.hold(key)) {
            heldPanels.delete(key);
            continue;
        }
        try {
            const client = connectionPool.getClient(task.computerId);
            if (!client.getStatus().connected) continue;
            const running = await Promise.all(
                processes.map((id) => client.call<{ running?: boolean }>("process:exists", { id }).then((r) => r?.running === true)),
            );
            if (running.some(Boolean)) continue;
            heldPanels.delete(key);
            void updateQueue.enqueue(taskJob(task));
        } catch (err) {
            logger.warn(`[Updater] could not look at what holds ${task.id} back:`, err);
            problems.push(`Couldn't check whether ${task.name}${task.computerName ? ` on ${task.computerName}` : ""} can update now: ${reason(err)}.`);
        }
    }
}

/**
 * Stop and update: the held updates join the queue as one job, which stops
 * what uses them once and starts it again after. They must be on one
 * computer. Resolves with their items once they ran; throws when one of
 * them is no longer held.
 */
export async function releaseHolds(keys: string[]): Promise<UpdateItem[]> {
    if (keys.length === 0) throw new Error("No update was chosen");
    const holds = keys.map((key) => updateQueue.hold(key));
    if (holds.some((hold) => !hold)) throw new Error("That update is no longer waiting");
    const items = await updateQueue.enqueue(inUseJob(holds as UpdateHold[]));
    for (const item of items) {
        if (item.status === "failed") logger.warn(`[Updater] Stop and update of ${item.name} failed: ${item.error}`);
    }
    return items;
}
