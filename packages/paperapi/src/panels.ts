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
    // declared capability labels, single-sourced from the panel manifest
    // (registry record manifest, else installed manifest). Surfaced at the
    // moment of trust in the install dialog; enforced at registry-open.
    permissions?: string[];
    // daemon-recorded install provenance: "registry" (reviewed), "direct"
    // (checksummed URL, not reviewed), "dev" (symlinked dev build). Absent
    // for panels installed before provenance shipped.
    installSource?: "registry" | "direct" | "dev";
    isLinked?: boolean;
}

// manifest-declared permission labels or undefined when the record
// carries none — never invented, never widened
function normalizePermissions(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const perms = value
        .filter((p): p is string => typeof p === "string")
        .map((p) => p.slice(0, 64))
        .slice(0, 64);
    return perms.length > 0 ? perms : undefined;
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
            // installed list unavailable — logged, merge continues
            // registry-only instead of silently pretending nothing is installed
            console.debug("[panels] installed list unavailable, registry-only merge:", err);
            installed = [];
        }
        const installedMap = new Map(installed.map((p) => [p.id, p]));

        try {
            const registryData = await fetchRegistryIndex();

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
                        record.manifest?.version,
                    publisher:
                        record.publisher ||
                        record.manifest?.publisher ||
                        record.manifest?.author ||
                        localPanel?.publisher ||
                        "Unsigned",
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
                    permissions:
                        normalizePermissions(record.manifest?.permissions) ??
                        normalizePermissions(localPanel?.permissions),
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
            // registry unreachable: DOWN-grading, not silently — the caller
            // must know the list is installed-only
            console.error("[panels] registry unreachable, installed set only:", err);
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
