import { invokeIn } from "./ipc";
import { REGISTRY_URL } from "./config";

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
}

// Panel store and lifecycle API; scope omitted = ambient
export const panelsApi = {
    list: (scope?: string): Promise<PanelItem[]> =>
        invokeIn<PanelItem[]>(scope, "panels-list"),

    /** Fetches the registry index and merges it with installed panels. */
    registry: async (scope?: string): Promise<PanelItem[]> => {
        let installed: PanelItem[] = [];
        try {
            installed = await panelsApi.list(scope);
        } catch {
            installed = [];
        }
        const installedMap = new Map(installed.map((p) => [p.id, p]));

        try {
            let res = await fetch(`${REGISTRY_URL}/panels/index.json`);
            if (!res.ok) {
                res = await fetch(`${REGISTRY_URL}/boards/index.json`);
            }
            if (!res.ok) {
                throw new Error(`Registry returned HTTP ${res.status}`);
            }
            const registryData = (await res.json()) as Record<string, any>;

            const panels: PanelItem[] = [];
            for (const [id, record] of Object.entries(registryData)) {
                const localPanel = installedMap.get(id);
                panels.push({
                    id,
                    name: record.name || localPanel?.name || id,
                    description:
                        record.description ||
                        localPanel?.description ||
                        record.manifest?.description,
                    version:
                        record.version ||
                        localPanel?.version ||
                        record.manifest?.version ||
                        "1.0.0",
                    publisher:
                        record.publisher ||
                        record.manifest?.publisher ||
                        record.manifest?.author ||
                        localPanel?.publisher ||
                        "Paperboard",
                    icon: record.icon || localPanel?.icon,
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
                });
            }

            // Include locally installed panels absent from the registry
            for (const local of installed) {
                if (!panels.some((p) => p.id === local.id)) {
                    panels.push(local);
                }
            }

            return panels;
        } catch {
            // Registry unreachable — degrade to the installed set
            return installed;
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
