import { apiFetch } from "../lib/userAgent";

// Metadata reads for the software providers. Each one checks the status
// (an HTML error page must not be parsed as a version list) and caps the
// body: these are small JSON indexes, and an upstream that streams without
// end must not grow the service's memory with it.

export const METADATA_MAX_BYTES = 8 * 1024 * 1024;
const CHECKSUM_MAX_BYTES = 1024;

// Releases a response we are refusing. The refusal is already the failure
// being thrown; a cancel that itself fails changes nothing about it.
function release(cancel: () => Promise<void>): void {
    cancel().catch((err) => console.debug("[software/http] body cancel failed:", String(err)));
}

async function readCapped(url: string, maxBytes: number): Promise<string> {
    const res = await apiFetch(url);
    if (!res.ok) {
        if (res.body) release(() => res.body!.cancel());
        throw new Error(`${new URL(url).host} answered HTTP ${res.status} for ${url}`);
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
        if (res.body) release(() => res.body!.cancel());
        throw new Error(`${url} is ${declared} bytes, over the ${maxBytes}-byte limit`);
    }
    if (!res.body) return "";
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            release(() => reader.cancel());
            throw new Error(`${url} exceeded the ${maxBytes}-byte limit`);
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

export async function fetchJson<T>(url: string, maxBytes: number = METADATA_MAX_BYTES): Promise<T> {
    const text = await readCapped(url, maxBytes);
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(`${url} did not return JSON`);
    }
}

/**
 * A Maven checksum sidecar (`<artifact>.sha256`). The file holds the hex
 * digest, optionally followed by a filename; anything else is refused so a
 * malformed sidecar never becomes "no checksum".
 */
export async function fetchSha256Sidecar(artifactUrl: string): Promise<string> {
    const text = await readCapped(`${artifactUrl}.sha256`, CHECKSUM_MAX_BYTES);
    const digest = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!/^[0-9a-f]{64}$/.test(digest)) {
        throw new Error(`No usable sha256 published for ${artifactUrl}; refusing to download unverified`);
    }
    return digest;
}
