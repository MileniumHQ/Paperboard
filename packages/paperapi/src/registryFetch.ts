// Bounded registry JSON fetch: no unbounded downloads, no hanging lookups.
// Kept transport-free so the Origami-served panel library can reuse the
// exact same bound as the shell's registry reads.

// the index is screen-printer-sized metadata, never more than 1MB
export const REGISTRY_INDEX_MAX_BYTES = 1024 * 1024;
export const REGISTRY_INDEX_TIMEOUT_MS = 10_000;

export async function fetchRegistryJson(
    url: string,
    timeoutMs = REGISTRY_INDEX_TIMEOUT_MS,
    maxBytes = REGISTRY_INDEX_MAX_BYTES,
): Promise<Record<string, any>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
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
