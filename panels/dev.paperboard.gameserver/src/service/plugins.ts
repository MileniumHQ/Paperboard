import {
    files as fileApi,
    config,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import { sanitizeFileName, tryListDirectory } from "../lib/filesystem";
import {
    INSTALL_RECORDS_KEY,
    collectInstalledPlugins,
    parseInstallRecords,
    pluginDirName,
    validatePluginFilename,
} from "../core/plugins";
import type { GameServerState, InstalledPlugin, InstalledRecord } from "./types";
import { PANEL_ID } from "./types";

export type { InstalledPlugin, InstalledRecord };
export { INSTALL_RECORDS_KEY, pluginDirName };

async function getInstallRecords(): Promise<Record<string, InstalledRecord>> {
    try {
        const saved = await config.get<Record<string, unknown>>(PANEL_ID);
        return parseInstallRecords(saved?.[INSTALL_RECORDS_KEY]);
    } catch {
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
    } catch {}
    await config.set({ ...current, [INSTALL_RECORDS_KEY]: records }, PANEL_ID);
}

export async function listInstalledPlugins(
    ctx: ServiceContext<GameServerState>,
): Promise<{ plugins: InstalledPlugin[]; warning?: string }> {
    const dirName = pluginDirName(ctx.state.serverSoftware);
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
    await fileApi.delete(`${pluginDirName(ctx.state.serverSoftware)}/${safe}`, PANEL_ID);
    const records = await getInstallRecords();
    if (records[safe]) {
        delete records[safe];
        await writeInstallRecords(records);
    }
}
