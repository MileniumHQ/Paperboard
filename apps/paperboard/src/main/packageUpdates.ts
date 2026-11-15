// Runtime package updates that are staged on paired computers and wait for
// the panels still running the installed release. The update list shows
// them as held, with Stop and update; the daemon installs each update
// itself once those processes stop.
import connectionPool from "./communication/papercrane/ConnectionPool";
import { withTimeout } from "../../papercrane/util";
import { logger } from "../../papercrane/logger";
import { errorMessage } from "../../../../packages/paperapi/src/errors";

// a runtime package update that is downloaded and verified on a computer
// but not installed yet: it waits for the panels whose processes still run
// from the installed release, or its install failed and the previous
// release kept working
export interface PackageUpdateNotice {
    computerId: string;
    computerName: string;
    packageName: string;
    version: string;
    // display names of the panels whose important or long-running
    // processes hold the update back ("Paperboard" for processes the app
    // started itself); empty when what uses it can stop for it
    panels: string[];
    error?: string;
}

export interface PackageUpdatesState {
    notices: PackageUpdateNotice[];
    // computers that answered but could not report their waiting updates
    failures: Array<{ computerId: string; computerName: string; error: string }>;
}

const QUERY_TIMEOUT_MS = 5_000;

type PackageHolders = Array<{ owner: string | null; holds: boolean }>;

/** The display names of what holds a package update back: only important
 * or long-running processes hold it, a panel's by its name, the app's own
 * as "Paperboard". Empty when what uses it can stop for it. */
export async function packageHolderNames(computerId: string, blockedBy: PackageHolders): Promise<string[]> {
    const owners = [...new Set(blockedBy.filter((b) => b.holds).map((b) => b.owner))];
    const panels = owners.some((o) => o !== null) ? await withTimeout(connectionPool.getClient(computerId).listPanels(), QUERY_TIMEOUT_MS) : [];
    const names = new Map(panels.map((p) => [p.id, p.name || p.id]));
    return [...new Set(owners.map((o) => (o === null ? "Paperboard" : names.get(o) ?? o)))];
}

export async function collectPackageUpdates(): Promise<PackageUpdatesState> {
    const state: PackageUpdatesState = { notices: [], failures: [] };
    await connectionPool.forEachComputer(async ({ id, name }) => {
        const client = connectionPool.getClient(id);
        // an offline computer is the rail's to report; it has nothing
        // to say about its packages until it is back
        if (!client.getStatus().connected) return;
        try {
            const updates = await withTimeout(client.pendingPackageUpdates(), QUERY_TIMEOUT_MS);
            for (const update of updates) {
                state.notices.push({
                    computerId: id,
                    computerName: name,
                    packageName: update.name,
                    version: update.version,
                    panels: await packageHolderNames(id, update.blockedBy),
                    ...(update.error ? { error: update.error } : {}),
                });
            }
        } catch (err) {
            logger.warn(`[PackageUpdates] could not read waiting package updates on ${name}:`, err);
            state.failures.push({ computerId: id, computerName: name, error: errorMessage(err) });
        }
    });
    return state;
}
