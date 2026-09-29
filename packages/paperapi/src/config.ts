import { invokeIn } from "./ipc";
import {
    REGISTRY_INDEX_MAX_BYTES,
    REGISTRY_INDEX_TIMEOUT_MS,
    fetchRegistryJson,
} from "./registryFetch";

export { fetchRegistryJson };

// registry base URL, override with ORIGAMI_REGISTRY_URL
export const REGISTRY_URL: string =
    (typeof process !== "undefined" && process.env?.ORIGAMI_REGISTRY_URL) ||
    "https://origami.ariapis.com";

// The panel library is a division of the registry origin: Origami serves
// the same /panels/index.json it documents at /library/. Deriving the URL
// from REGISTRY_URL keeps the shell pointed at the same authority the
// daemon installs from.
export const PANEL_LIBRARY_URL: string = `${REGISTRY_URL.replace(/\/+$/, "")}/library/`;

export async function fetchRegistryIndex(
    timeoutMs: number = REGISTRY_INDEX_TIMEOUT_MS,
    maxBytes: number = REGISTRY_INDEX_MAX_BYTES,
): Promise<Record<string, any>> {
    return fetchRegistryJson(`${REGISTRY_URL}/panels/index.json`, timeoutMs, maxBytes);
}

// config ids are panel ids or shell documents (app settings); the daemon
// validates the shape at its boundary, this only refuses a missing id
function requireConfigId(id: unknown): string {
    if (typeof id !== "string" || !id) {
        throw new Error("config calls need an explicit config id (usually your panel id)");
    }
    return id;
}

// panel configuration persistence. The config id is always explicit: an
// omitted id used to fall back to "whoever this document is" (ambient
// identity). Scope omitted = the transport this document was granted.
//
// No path: the panel's config document, stored in configs/<panelId>.json.
// With a panel-relative path (tabs.json, canvas.json): workspace data in
// the panel's own files dir, files/<panelId>/<path>.json. Values are JSON
// and bounded; workspaces are not a blob store.
export const config = {
    get: <T = any>(id: string, path?: string, scope?: string): Promise<T> =>
        invokeIn<T>(scope, "config-get", { id: requireConfigId(id), path }),
    set: (data: any, id: string, path?: string, scope?: string): Promise<void> =>
        invokeIn<void>(scope, "config-set", { id: requireConfigId(id), data, path }),
};

export const configApi = config;
