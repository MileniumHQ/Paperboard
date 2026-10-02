import {
    files as fileApi,
    config,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import { sanitizeFileName, tryListDirectory, listDirectory } from "../lib/filesystem";
import {
    INSTALL_RECORDS_KEY,
    collectInstalledPlugins,
    parseInstallRecords,
    pluginDirName,
    validatePluginFilename,
} from "../core/plugins";
import { trashRemovePathsWith } from "./trash";
import { makeTrashRemoveDeps } from "./trashDeps";
import type { GameServerState, InstalledPlugin, InstalledRecord } from "./types";
import { PANEL_ID } from "./types";

export type { InstalledPlugin, InstalledRecord };
export { INSTALL_RECORDS_KEY, pluginDirName };

async function getInstallRecords(): Promise<Record<string, InstalledRecord>> {
    try {
        const saved = await config.get<Record<string, unknown>>(PANEL_ID);
        return parseInstallRecords(saved?.[INSTALL_RECORDS_KEY]);
    } catch (err) {
        console.debug("[plugins] install records unreadable, starting empty:", String(err));
        return {};
    }
}

async function writeInstallRecords(
    records: Record<string, InstalledRecord>,
): Promise<void> {
    let current: Record<string, unknown> = {};
    try {
        const saved = await config.get<Record<string, unknown>>(PANEL_ID);
        if (saved && typeof saved === "object") current = saved;
    } catch (err) {
        console.debug("[plugins] no saved panel config yet:", String(err));
    }
    await config.set({ ...current, [INSTALL_RECORDS_KEY]: records }, PANEL_ID);
}

export async function listInstalledPlugins(
    ctx: ServiceContext<GameServerState>,
): Promise<{ plugins: InstalledPlugin[]; warning?: string }> {
    const dirName = pluginDirName(ctx.state.serverSoftware);
    // a missing directory means "nothing installed yet", not an error: the
    // folder is only created on first install, and a warning here taught
    // users to ignore the warning bar
    const dirExists = await fileApi.exists(dirName, PANEL_ID).catch(() => false);
    if (!dirExists) return { plugins: [] };
    const records = await getInstallRecords();
    const listing = await tryListDirectory(dirName);
    const plugins = await collectInstalledPlugins({
        records,
        listingEntries: listing.entries,
        exists: (path) => fileApi.exists(path, PANEL_ID),
        sanitize: sanitizeFileName,
        dirName,
    });

    return {
        plugins,
        warning: listing.error,
    };
}

export async function deletePlugin(
    ctx: ServiceContext<GameServerState>,
    filename: string,
): Promise<void> {
    const safe = validatePluginFilename(sanitizeFileName(filename) ?? filename);
    // moved to trash (see service/trash.ts) — a bare fileApi.delete
    // here is irreversible destruction on a single RPC
    await trashRemovePathsWith(
        makeTrashRemoveDeps(),
        [`${pluginDirName(ctx.state.serverSoftware)}/${safe}`],
    );
    const records = await getInstallRecords();
    if (records[safe]) {
        delete records[safe];
        await writeInstallRecords(records);
    }
}

// every plugin dir regardless of software: switching Paper<->Fabric changes
// which folder is "active", so "uninstall everything" must clear both
const ALL_PLUGIN_DIRS = ["plugins", "mods"];

export async function uninstallAllPlugins(
    _ctx: ServiceContext<GameServerState>,
): Promise<number> {
    const paths: string[] = [];
    for (const dir of ALL_PLUGIN_DIRS) {
        // an unanswerable exists is a failure, not an empty folder: "uninstall
        // everything" must not report success over jars it never saw
        if (!(await fileApi.exists(dir, PANEL_ID))) continue;
        for (const entry of await listDirectory(dir)) {
            const safe = sanitizeFileName(entry);
            if (!safe || !safe.toLowerCase().endsWith(".jar")) continue;
            try {
                paths.push(`${dir}/${validatePluginFilename(safe)}`);
            } catch (err) {
                console.debug(`[Service:Plugins] skipping unsafe entry "${entry}":`, String(err));
            }
        }
    }
    if (paths.length > 0) {
        await trashRemovePathsWith(
            makeTrashRemoveDeps(),
            paths,
        );
    }
    await writeInstallRecords({});
    return paths.length;
}
