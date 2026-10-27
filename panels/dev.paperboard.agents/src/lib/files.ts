// The UI's side of the conversation's files: uploading the user's in chunks
// (one action can't carry 25 MB), and reading any of them back into a blob
// URL to show. Read files are kept in a small cache bounded by count and
// bytes; the oldest are released when it's full.

import { LIMITS, UI_ACTION_IDS, type Attachment } from "../contract";

type Call = <T>(id: string, inputs?: Record<string, unknown>) => Promise<T>;

const CACHE_FILES = 32;
const CACHE_BYTES = 160 * 1024 * 1024;

const toBase64 = (blob: Blob) =>
    new Promise<string>((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(",") + 1));
        r.onerror = () => fail(r.error ?? new Error("the file couldn't be read"));
        r.readAsDataURL(blob);
    });

const fromBase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

export function createFiles(call: Call) {
    type Read = { url: string; file: Attachment };
    const cache = new Map<string, { read: Promise<Read>; bytes: number }>();
    let cached = 0;

    const evict = () => {
        for (const [id, c] of cache) {
            if (cache.size <= CACHE_FILES && cached <= CACHE_BYTES) break;
            cache.delete(id);
            cached -= c.bytes;
            void c.read.then((r) => URL.revokeObjectURL(r.url), () => undefined);
        }
    };

    return {
        /** Upload a file; progress is 0–1. An abort cancels the upload on the service too. */
        async upload(file: File, onProgress: (done: number) => void, signal: AbortSignal): Promise<Attachment> {
            if (file.size > LIMITS.attachments.fileBytes) throw new Error(`${file.name} is over ${LIMITS.attachments.fileBytes / 1024 / 1024} MB`);
            const { id } = await call<{ id: string }>(UI_ACTION_IDS.attachBegin, { name: file.name, bytes: file.size });
            try {
                for (let offset = 0; offset < file.size; ) {
                    signal.throwIfAborted();
                    const chunk = file.slice(offset, offset + LIMITS.attachments.chunkBytes);
                    await call(UI_ACTION_IDS.attachPut, { id, offset, data: await toBase64(chunk) });
                    offset += chunk.size;
                    onProgress(offset / file.size);
                }
                signal.throwIfAborted();
                return await call<Attachment>(UI_ACTION_IDS.attachFinish, { id });
            } catch (e) {
                // the service drops the half-made file; if even that fails, its idle timer does
                await call(UI_ACTION_IDS.attachCancel, { id }).catch((why) => console.error("[ai] couldn't cancel an upload:", why));
                throw e;
            }
        },

        /**
         * A file by its id, as a blob URL and what it is: read once and kept while it's among the recent ones.
         * `bytes` (known for a file a message lists) counts it in the cache before it's read.
         */
        read(id: string, bytes = 0): Promise<Read> {
            const hit = cache.get(id);
            if (hit) {
                // most recently used goes last
                cache.delete(id);
                cache.set(id, hit);
                return hit.read;
            }
            const entry = { read: null as unknown as Promise<Read>, bytes };
            entry.read = (async () => {
                const parts: Uint8Array<ArrayBuffer>[] = [];
                let file: Attachment | null = null;
                for (let offset = 0, done = false; !done; ) {
                    const r = await call<{ data: string; done: boolean; file: Attachment }>(UI_ACTION_IDS.attachRead, { id, offset });
                    const chunk = fromBase64(r.data);
                    parts.push(chunk);
                    offset += chunk.length;
                    done = r.done;
                    file = r.file;
                    if (!done && chunk.length === 0) throw new Error(`${r.file.name} ended early`);
                }
                // counted at its real size once it's known
                if (cache.get(id) === entry) {
                    cached += file!.bytes - entry.bytes;
                    entry.bytes = file!.bytes;
                    evict();
                }
                // only media is typed: anything else stays opaque, so opening it can never run it as a page
                return { url: URL.createObjectURL(new Blob(parts, { type: file!.kind === "file" ? "application/octet-stream" : file!.type })), file: file! };
            })();
            cache.set(id, entry);
            cached += bytes;
            // a failed read isn't kept: the next look tries again
            entry.read.catch(() => {
                if (cache.get(id) === entry) {
                    cache.delete(id);
                    cached -= entry.bytes;
                }
            });
            evict();
            return entry.read;
        },

        /** Release every blob (the conversation changed, or the panel closes). */
        clear() {
            for (const c of cache.values()) void c.read.then((r) => URL.revokeObjectURL(r.url), () => undefined);
            cache.clear();
            cached = 0;
        },
    };
}

export type Files = ReturnType<typeof createFiles>;

export const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
