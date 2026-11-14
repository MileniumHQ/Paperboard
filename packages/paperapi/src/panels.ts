import { invokeIn } from "./ipc";
import { REGISTRY_URL, fetchRegistryIndex } from "./config";
import { mergeRegistryWithInstalled, type PanelItem } from "./panelMerge";

export type { PanelItem };

/** what an uninstall that worked left behind */
export interface UninstallResult {
    /** the packages only this panel used that could not be removed, each with why */
    packagesWarning?: string;
}

/** an installed panel that isn't listed, because its manifest is unreadable or invalid */
export interface InvalidPanel {
    /** the panel's folder name */
    id: string;
    /** what is wrong with its manifest */
    error: string;
}

// panel store and lifecycle; an omitted scope is the computer initPaperApi
// bound, else the one this context was granted (identity.ts)
export const panelsApi = {
    list: (scope?: string): Promise<PanelItem[]> =>
        invokeIn<PanelItem[]>(scope, "panels-list"),
    /** every installed panel: the ones that load, and the ones whose manifest is broken, with why */
    listInstalled: (scope?: string): Promise<{ panels: PanelItem[]; invalid: InvalidPanel[] }> =>
        invokeIn(scope, "panels-list-installed"),

    /** merges registry index with installed panels */
    registry: async (scope?: string): Promise<PanelItem[]> => {
        // a failure here reaches the caller, which shows recovery rather
        // than an empty installed set that turns Open buttons into Download
        const installed = await panelsApi.list(scope);

        try {
            const registryData = await fetchRegistryIndex();
            // An installed panel describes itself: its own manifest is
            // what runs on this computer. The registry record only adds
            // what the install lacks and the newest release it offers.
            return mergeRegistryWithInstalled(
                registryData,
                installed,
                REGISTRY_URL,
            );
        } catch (err) {
            // Preserve the error so the shell can retain prior data and
            // display its retry action.
            console.error("[panels] registry unavailable:", err);
            throw err;
        }
    },

    /** resolves with the installed panel's manifest */
    install: (panelId: string, scope?: string): Promise<PanelItem> =>
        invokeIn<PanelItem>(scope, "panel-install", panelId),
    /**
     * Removes the panel's code. Config, files and saved credentials are
     * kept unless `deleteData` is explicitly true. Rejects when the panel
     * couldn't be uninstalled; resolves with `packagesWarning` when it is
     * gone but packages only it used could not be removed, which the person
     * who asked must be shown.
     */
    uninstall: (
        panelId: string,
        scope?: string,
        options?: { deleteData?: boolean },
    ): Promise<UninstallResult> =>
        invokeIn<UninstallResult>(scope, "panel-uninstall", panelId, options?.deleteData === true),
    /** Restarts the panel's service; false when it declares none. */
    restartService: (panelId: string, scope?: string): Promise<boolean> =>
        invokeIn<boolean>(scope, "panel-restart-service", panelId),
};

export const panels = panelsApi;
