import type { WidgetDeclaration } from "./widgetManifest";
import { parseStoreListing, type StoreListing } from "./storeListing";

// Panel library merge: the registry's newest release and the installed
// panel are different facts. An installed panel describes itself — its own
// manifest is what runs on this computer — and the registry record only
// adds what the install lacks plus the newest release it offers.
//
// Pure by design: the shell's transport-backed registry() and the
// Origami-served panel library share this ONE implementation, so a card
// cannot render differently depending on who assembled it.

export interface PanelItem {
    id: string;
    name: string;
    version?: string;
    icon?: string;
    iconUrl?: string;
    downloadUrl?: string;
    description?: string;
    publisher?: string;
    /** the registry's release date, formatted for display; absent when the registry gives none */
    updatedAt?: string;
    isInstalled?: boolean;
    // "dev" = symlinked from a working tree; registry installs carry none
    installSource?: "dev";
    isLinked?: boolean;
    installedVersion?: string;
    /** newest release the registry offers; `version` is the installed one when installed */
    latestVersion?: string;
    /** byte size of the registry's newest release archive */
    archiveBytes?: number;
    /** the registry's store listing for the newest release */
    store?: StoreListing;
    /** widgets the installed manifest declares, already validated by the daemon */
    widgets?: WidgetDeclaration[];
    /** the installed manifest's service entry; absent when the panel runs no service */
    service?: string;
}

export interface RegistryPanelRecord {
    name?: string;
    version?: string;
    description?: string;
    publisher?: string;
    icon?: string;
    iconUrl?: string;
    downloadUrl?: string;
    updatedAt?: string;
    sizeBytes?: number;
    store?: unknown;
    manifest?: {
        description?: string;
        version?: string;
        publisher?: string;
        author?: string;
    };
}

// a registry date as a person reads it; an unparseable one is no date
function releaseDate(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Merges a registry index with the installed panels for one computer.
 * `registryBase` is the origin the library addresses archives/icons from
 * when the record itself carries no URL; empty means relative to the
 * document (the Origami-served library runs on the registry origin).
 */
export function mergeRegistryWithInstalled(
    registryData: Record<string, RegistryPanelRecord>,
    installed: PanelItem[],
    registryBase = "",
): PanelItem[] {
    let end = registryBase.length;
    while (end > 0 && registryBase[end - 1] === "/") end--;
    const base = registryBase.slice(0, end);
    const installedMap = new Map(installed.map((p) => [p.id, p]));
    const panels: PanelItem[] = [];

    for (const [id, record] of Object.entries(registryData)) {
        if (!record || typeof record !== "object") continue;
        const localPanel = installedMap.get(id);
        const store = parseStoreListing(record.store);
        const updatedAt = releaseDate(record.updatedAt) ?? localPanel?.updatedAt;
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
            iconUrl: record.iconUrl || `${base}/panel/${id}/icon`,
            downloadUrl:
                record.downloadUrl || `${base}/panel/${id}/download`,
            // facts the registry does not give stay absent: a card shows
            // nothing rather than a made-up "Unknown" or "Recently"
            ...(updatedAt ? { updatedAt } : {}),
            ...(typeof record.sizeBytes === "number" &&
            Number.isFinite(record.sizeBytes) &&
            record.sizeBytes >= 0
                ? { archiveBytes: record.sizeBytes }
                : {}),
            ...(store ? { store } : {}),
            isInstalled: installedMap.has(id),
            installedVersion: localPanel?.version,
            installSource: localPanel?.installSource,
            isLinked: localPanel?.isLinked,
            // what runs here comes from the installed manifest, registry or not
            ...(localPanel?.widgets ? { widgets: localPanel.widgets } : {}),
            ...(localPanel?.service ? { service: localPanel.service } : {}),
        });
    }

    // include installed panels missing from registry
    for (const local of installed) {
        if (!panels.some((p) => p.id === local.id)) {
            panels.push(local);
        }
    }

    return panels;
}
