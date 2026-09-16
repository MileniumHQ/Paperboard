import { invokeIn, getPanelId } from "./ipc";

// registry base URL, override with ORIGAMI_REGISTRY_URL
export const REGISTRY_URL: string =
    (typeof process !== "undefined" && process.env?.ORIGAMI_REGISTRY_URL) ||
    "https://origami.ariapis.com";

// bounded registry index fetch: no unbounded downloads, no hanging lookups.
// the index is screen-printer-sized metadata, never more than 1MB
const REGISTRY_INDEX_MAX_BYTES = 1024 * 1024;
const REGISTRY_INDEX_TIMEOUT_MS = 10_000;

export async function fetchRegistryIndex(
    timeoutMs: number = REGISTRY_INDEX_TIMEOUT_MS,
    maxBytes: number = REGISTRY_INDEX_MAX_BYTES,
): Promise<Record<string, any>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${REGISTRY_URL}/panels/index.json`, {
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(`Registry returned HTTP ${res.status}`);
        }
        // bound at the stream boundary: a declared Content-Length over the
        // cap is refused before a single byte is buffered
        const declared = Number(res.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > maxBytes) {
            controller.abort();
            throw new Error(
                `Registry index exceeds ${maxBytes} bytes; refusing to parse`,
            );
        }
        let blob: Blob;
        if (res.body) {
            // streamed reads abort the moment the accumulated bytes exceed
            // the cap — a lying Content-Length or missing header cannot
            // balloon memory behind the fetch's back
            const reader = res.body.getReader();
            const chunks: Uint8Array[] = [];
            let received = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                received += value.byteLength;
                if (received > maxBytes) {
                    controller.abort();
                    throw new Error(
                        `Registry index exceeds ${maxBytes} bytes; refusing to parse`,
                    );
                }
                chunks.push(value);
            }
            blob = new Blob(chunks as BlobPart[], { type: "application/json" });
        } else {
            blob = await res.blob();
            if (blob.size > maxBytes) {
                throw new Error(
                    `Registry index exceeds ${maxBytes} bytes; refusing to parse`,
                );
            }
        }
        return JSON.parse(await blob.text()) as Record<string, any>;
    } finally {
        clearTimeout(timer);
    }
}

const getHost = () => getPanelId();

// panel configuration persistence, scope omitted = ambient.
//
// No path: the panel's config document, stored in configs/<panelId>.json.
// With a panel-relative path (tabs.json, canvas.json): workspace data in
// the panel's own files dir, files/<panelId>/<path>.json. Values are JSON
// and bounded; workspaces are not a blob store.
export const config = {
    get: <T = any>(id?: string, path?: string, scope?: string): Promise<T> =>
        invokeIn<T>(scope, "config-get", { id: id || getHost(), path }),
    set: (data: any, id?: string, path?: string, scope?: string): Promise<void> =>
        invokeIn<void>(scope, "config-set", { id: id || getHost(), data, path }),
};

export const configApi = config;
