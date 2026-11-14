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

// updates that were stopped for without asking and failed: they are not
// tried that way again, so a failing update can't stop processes over and
// over; they wait for Stop and update instead
const stopFailed = new Set<string>();

export function stopHoldRefresh(): void {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
}

/**
 * Reads what holds updates back again: staged packages from each computer's
 * daemon, and held panels whose processes may have stopped (their update
 * then runs). While anything is held it looks again every so often.
 */
export async function refreshHolds(): Promise<void> {
    stopHoldRefresh();
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
        updateQueue.setHolds("packages", holds);
        for (const hold of unheld) {
            void updateQueue.enqueue(inUseJob([hold])).then(([item]) => {
                if (item.status === "failed") stopFailed.add(`${hold.key}\u0000${hold.version}`);
            });
        }
        for (const failure of packages.failures) {
            logger.warn(`[Updater] could not read held updates on ${failure.computerName}: ${failure.error}`);
        }
    } catch (err) {
        logger.error("[Updater] could not read held package updates:", err);
    }
    // a held panel whose processes all stopped updates now
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
        }
    }
    if (updateQueue.snapshot().holds.length > 0) {
        holdTimer = setTimeout(() => void refreshHolds(), HOLD_REFRESH_MS);
        holdTimer.unref?.();
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
