// Runtime package updates that are staged on paired computers and wait for
// the panels still running the installed release. The update list shows
// them as held, with Stop and update; the daemon installs each update
// itself once those processes stop.
import connectionPool from "./communication/papercrane/ConnectionPool";
import { withTimeout } from "../../papercrane/util";
import { logger } from "../../papercrane/logger";
import type { PackageUpdatesState } from "../shared/packageUpdates";

const QUERY_TIMEOUT_MS = 5_000;
const BATCH = 8;

export async function collectPackageUpdates(): Promise<PackageUpdatesState> {
    const state: PackageUpdatesState = { notices: [], failures: [] };
    const computers = connectionPool.listAll();
    for (let offset = 0; offset < computers.length; offset += BATCH) {
        await Promise.all(computers.slice(offset, offset + BATCH).map(async ({ id, name }) => {
            const client = connectionPool.getClient(id);
            // an offline computer is the rail's to report; it has nothing
            // to say about its packages until it is back
            if (!client.getStatus().connected) return;
            try {
                const updates = await withTimeout(client.pendingPackageUpdates(), QUERY_TIMEOUT_MS);
                if (updates.length === 0) return;
                const names = new Map<string, string>();
                if (updates.some((u) => u.blockedBy.some((b) => b.owner && b.holds))) {
                    for (const panel of await withTimeout(client.listPanels(), QUERY_TIMEOUT_MS)) {
                        names.set(panel.id, panel.name || panel.id);
                    }
                }
                for (const update of updates) {
                    // only important or long-running processes hold it;
                    // with none, the updater stops the rest and updates
                    const panels = [...new Set(update.blockedBy.filter((b) => b.holds).map((b) => (b.owner ? names.get(b.owner) ?? b.owner : "Paperboard")))];
                    state.notices.push({
                        computerId: id,
                        computerName: name,
                        packageName: update.name,
                        version: update.version,
                        panels,
                        ...(update.error ? { error: update.error } : {}),
                    });
                }
            } catch (err) {
                logger.warn(`[PackageUpdates] could not read waiting package updates on ${name}:`, err);
                state.failures.push({ computerId: id, computerName: name, error: err instanceof Error ? err.message : String(err) });
            }
        }));
    }
    return state;
}
