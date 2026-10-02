import { invokeIn } from "./ipc";
import { REGISTRY_URL, fetchRegistryIndex } from "./config";
import { mergeRegistryWithInstalled, type PanelItem } from "./panelMerge";

export type { PanelItem };

// panel store and lifecycle, scope omitted = ambient
export const panelsApi = {
    list: (scope?: string): Promise<PanelItem[]> =>
        invokeIn<PanelItem[]>(scope, "panels-list"),

    /** merges registry index with installed panels */
    registry: async (scope?: string): Promise<PanelItem[]> => {
        let installed: PanelItem[] = [];
        try {
            installed = await panelsApi.list(scope);
        } catch (err) {
            // The caller needs the failure to show recovery, not an empty
            // installed set that would turn Open buttons into Download.
            console.debug("[panels] installed list unavailable:", err);
            throw err;
        }

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

    install: (panelId: string, scope?: string): Promise<boolean> =>
        invokeIn<boolean>(scope, "panel-install", panelId),
    /**
     * Removes the panel's code. Config, files and saved credentials are
     * kept unless `deleteData` is explicitly true.
     */
    uninstall: (
        panelId: string,
        scope?: string,
        options?: { deleteData?: boolean },
    ): Promise<boolean> =>
        invokeIn<boolean>(scope, "panel-uninstall", panelId, options?.deleteData === true),
    /** Restarts the panel's service; false when it declares none. */
    restartService: (panelId: string, scope?: string): Promise<boolean> =>
        invokeIn<boolean>(scope, "panel-restart-service", panelId),
    remove: (panelId: string, scope?: string): Promise<boolean> =>
        invokeIn<boolean>(scope, "panel-uninstall", panelId),
};

export const panels = panelsApi;
