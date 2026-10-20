// Runtime package updates that are staged on paired computers and wait for
// the panels still running the installed release. The shell lists them so
// the user knows which processes to stop; the daemon installs each update
// itself once they have.
import { BrowserWindow } from "electron";
import connectionPool from "./communication/papercrane/ConnectionPool";
import { isShellUrl } from "./communication/shellGuard";
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
                if (updates.some((u) => u.blockedBy.some((b) => b.owner))) {
                    for (const panel of await withTimeout(client.listPanels(), QUERY_TIMEOUT_MS)) {
                        names.set(panel.id, panel.name || panel.id);
                    }
                }
                for (const update of updates) {
                    const panels = [...new Set(update.blockedBy.map((b) => (b.owner ? names.get(b.owner) ?? b.owner : "Paperboard")))];
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

// tells shell windows to read the list again (after an updater run)
export function announcePackageUpdates(): void {
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && isShellUrl(window.webContents.getURL())) {
            window.webContents.send("package-updates-changed");
        }
    }
}
