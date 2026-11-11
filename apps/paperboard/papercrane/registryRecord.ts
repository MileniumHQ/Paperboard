// One bounded reader for registry metadata records (panel and package JSON).
// The registry is the authority for what to install and which bytes are
// right; a record that cannot be read in time, or is larger than any real
// record, refuses the install rather than proceeding without it.
import { PAPERBOARD_USER_AGENT } from "./userAgent";

export const RECORD_TIMEOUT_MS = 10_000;
export const RECORD_MAX_BYTES = 256 * 1024;

// The registry names what went wrong in a small {"error": "..."} body (a
// record it can't read, say); carry that reason instead of a bare status.
// Only a declared, small body is read, and only a well-formed JSON string.
const REFUSAL_MAX_BYTES = 4096;
async function registryRefusal(res: Response): Promise<string> {
    const declared = Number(res.headers.get("content-length"));
    if (!Number.isFinite(declared) || declared <= 0 || declared > REFUSAL_MAX_BYTES) return "";
    const match = /"error"\s*:\s*("(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")/.exec(await res.text());
    return match ? `: ${JSON.parse(match[1]) as string}` : "";
}

export async function fetchRegistryRecord(
    url: string,
    fetchFn: typeof fetch = fetch,
): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`timed out after ${RECORD_TIMEOUT_MS}ms`)), RECORD_TIMEOUT_MS);
    try {
        const res = await fetchFn(url, {
            headers: { "User-Agent": PAPERBOARD_USER_AGENT },
            signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`registry answered HTTP ${res.status}${await registryRefusal(res)}`);
        if (!res.body) throw new Error("registry answered with no body");
        // read under the cap: the whole body is never buffered past it
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > RECORD_MAX_BYTES) {
                await reader.cancel();
                throw new Error(`record exceeds ${RECORD_MAX_BYTES} bytes`);
            }
            chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
        clearTimeout(timer);
    }
}
