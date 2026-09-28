import { invokeIn } from "./ipc";
import { REGISTRY_URL, fetchRegistryIndex } from "./config";

export interface PanelItem {
    id: string;
    name: string;
    version?: string;
    icon?: string;
    iconUrl?: string;
    downloadUrl?: string;
    description?: string;
    publisher?: string;
    size?: string;
    updatedAt?: string;
    isInstalled?: boolean;
    // daemon-recorded install provenance: "registry" (reviewed), "direct"
    // (checksummed URL, not reviewed), "dev" (symlinked dev build). Absent
    // for panels installed before provenance shipped.
    installSource?: "registry" | "direct" | "dev";
    isLinked?: boolean;
    installedVersion?: string;
    /** newest release the registry offers; `version` is the installed one when installed */
    latestVersion?: string;
}

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
        const installedMap = new Map(installed.map((p) => [p.id, p]));

        try {
            const registryData = await fetchRegistryIndex();

            const panels: PanelItem[] = [];
            for (const [id, record] of Object.entries(registryData)) {
                const localPanel = installedMap.get(id);
                // An installed panel describes itself: its own manifest is
                // what runs on this computer. The registry record only adds
                // what the install lacks and the newest release it offers.
                panels.push({
                    id,
                    name: localPanel?.name || record.name || id,
                    description:
                        localPanel?.description ||
                        record.description ||
                        record.manifest?.description,
                    version: localPanel
                        ? localPanel.version
                        : record.version || record.manifest?.version,
                    latestVersion: record.version || record.manifest?.version,
                    publisher: localPanel
                        ? localPanel.publisher
                        : record.publisher ||
                          record.manifest?.publisher ||
                          record.manifest?.author,
                    icon: localPanel?.icon || record.icon,
                    iconUrl:
                        record.iconUrl ||
                        `${REGISTRY_URL}/panel/${id}/icon`,
                    downloadUrl:
                        record.downloadUrl ||
                        `${REGISTRY_URL}/panel/${id}/download`,
                    size: localPanel?.size || "Unknown",
                    updatedAt: record.updatedAt
                        ? new Date(record.updatedAt).toLocaleDateString(
                              undefined,
                              {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                              },
                          )
                        : localPanel?.updatedAt || "Recently",
                    isInstalled: installedMap.has(id),
                    installedVersion: localPanel?.version,
                    installSource: localPanel?.installSource,
                    isLinked: localPanel?.isLinked,
                });
            }

            // include installed panels missing from registry
            for (const local of installed) {
                if (!panels.some((p) => p.id === local.id)) {
                    panels.push(local);
                }
            }

            return panels;
        } catch (err) {
            // Preserve the error so the shell can retain prior data and
            // display its retry action.
            console.error("[panels] registry unavailable:", err);
            throw err;
        }
    },

    install: (panelId: string, scope?: string): Promise<boolean> =>
        invokeIn<boolean>(scope, "panel-install", panelId),
    uninstall: (panelId: string, scope?: string): Promise<boolean> =>
        invokeIn<boolean>(scope, "panel-uninstall", panelId),
    remove: (panelId: string, scope?: string): Promise<boolean> =>
        invokeIn<boolean>(scope, "panel-uninstall", panelId),
};

export const panels = panelsApi;
