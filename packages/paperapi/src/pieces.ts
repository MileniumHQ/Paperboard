// Files over contract calls: one call can't carry a big file, so it goes in
// pieces, each as base64, and comes back the same way into a Blob. A page
// shows what it read as blob URLs, kept in a cache bounded by count and
// bytes, where something still showing one keeps it alive.

/** A Blob's bytes as base64, the way a call carries them. */
export async function blobToBase64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    // in runs: one String.fromCharCode of a whole piece overflows the stack
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

/** Bytes a call carried as base64. */
export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** One upload a service has begun: where its pieces go, and how it ends. */
export interface PieceUpload<T> {
    /** sends the piece at `offset`, base64; the next piece waits for it */
    put(offset: number, data: string): Promise<unknown>;
    /** the file is whole: what the service made of it */
    finish(): Promise<T>;
    /** drops the upload and what it had written */
    cancel(): Promise<unknown>;
}

export interface SendInPiecesOptions<T> {
    /** the most bytes one piece holds */
    pieceBytes: number;
    /** asks the service for an upload; called once, before the first piece */
    begin(): Promise<PieceUpload<T>>;
    /** how many bytes have been sent, after each piece */
    onProgress?: (sent: number) => void;
    /** stops between pieces, and cancels the upload on the service */
    signal?: AbortSignal;
}

/**
 * Sends a Blob to a service in pieces, in order, and resolves with what
 * `finish` gave. Any failure, or an abort, cancels the upload on the service
 * and rejects with why it stopped.
 */
export async function sendInPieces<T>(blob: Blob, options: SendInPiecesOptions<T>): Promise<T> {
    if (!(options.pieceBytes > 0)) throw new Error("A piece holds at least one byte.");
    options.signal?.throwIfAborted();
    const upload = await options.begin();
    try {
        for (let offset = 0; offset < blob.size; ) {
            options.signal?.throwIfAborted();
            const piece = blob.slice(offset, offset + options.pieceBytes);
            await upload.put(offset, await blobToBase64(piece));
            offset += piece.size;
            options.onProgress?.(offset);
        }
        options.signal?.throwIfAborted();
        return await upload.finish();
    } catch (err) {
        // quiet: the caller hears why it stopped; a service drops an upload it can't cancel now on its own
        await upload.cancel().catch((why: unknown) => console.error("[paperapi] an upload couldn't be canceled:", why));
        throw err;
    }
}

export interface ReadInPiecesOptions {
    /** reads the piece at `offset`: its bytes as base64, and the whole file's size */
    piece(offset: number): Promise<{ data: string; size: number }>;
    /** the Blob's media type; leave it out to keep the bytes opaque */
    type?: string;
    /** what a failure names, such as the file's name */
    name?: string;
    /** how many bytes have been read, after each piece */
    onProgress?: (read: number) => void;
    /** stops between pieces */
    signal?: AbortSignal;
}

/** Reads a file from a service in pieces into a Blob, until it has the size the pieces report. */
export async function readInPieces(options: ReadInPiecesOptions): Promise<Blob> {
    const name = options.name ? `“${options.name}”` : "The file";
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let offset = 0;
    for (;;) {
        options.signal?.throwIfAborted();
        const piece = await options.piece(offset);
        const bytes = base64ToBytes(piece.data);
        parts.push(bytes);
        offset += bytes.length;
        if (offset > piece.size) throw new Error(`${name} came back longer than its size.`);
        options.onProgress?.(offset);
        if (offset === piece.size) break;
        if (bytes.length === 0) throw new Error(`${name} ended before its size.`);
    }
    return new Blob(parts, options.type ? { type: options.type } : undefined);
}

export interface BlobUrlCacheLimits {
    /** the most URLs kept that nothing holds */
    files: number;
    /** the most bytes those keep */
    bytes: number;
}

export interface BlobUrlCache {
    /**
     * `key`'s blob URL: made once by `make`, and shared with every other
     * caller until the cache lets it go. The most recently asked for stay.
     * `bytes` counts it before it's made, such as a size a listing gave;
     * once made it counts as its Blob's size. A make that fails isn't
     * kept, so the next ask tries again.
     */
    get(key: string, make: () => Promise<Blob>, bytes?: number): Promise<string>;
    /**
     * Keeps `key`'s URL alive however full the cache gets, while something
     * reads from it over time (a film seeking, a PDF's pages), until the
     * returned release. A hold can start before the URL is asked for.
     */
    hold(key: string): () => void;
    /** Revokes every URL, held ones too: for when what they showed has gone. */
    clear(): void;
}

interface Entry {
    url: Promise<string>;
    bytes: number;
    /** its URL exists: one still being made has a caller waiting for it */
    made: boolean;
}

const revoke = (url: Promise<string>) =>
    void url.then(
        (u) => URL.revokeObjectURL(u),
        // quiet: a make that failed made no URL, and its caller was told
        () => undefined,
    );

/** Blob URLs of what a page read, kept by key: the recent ones, and the held ones. */
export function createBlobUrlCache(limits: BlobUrlCacheLimits): BlobUrlCache {
    const entries = new Map<string, Entry>();
    const holds = new Map<string, number>();
    let bytes = 0;

    // `spare` is the one just made: the caller waiting for it gets it alive
    const evict = (spare?: string) => {
        for (const [key, entry] of entries) {
            if (entries.size <= limits.files && bytes <= limits.bytes) break;
            if (holds.has(key) || !entry.made || key === spare) continue;
            entries.delete(key);
            bytes -= entry.bytes;
            revoke(entry.url);
        }
    };

    return {
        get(key, make, expected = 0) {
            const hit = entries.get(key);
            if (hit) {
                // most recently used goes last
                entries.delete(key);
                entries.set(key, hit);
                return hit.url;
            }
            const entry: Entry = { url: null as unknown as Promise<string>, bytes: expected, made: false };
            // eviction waits for an entry to be made; only clear lets one go
            // while it's made, and revokes it once it is
            entry.url = make().then((blob) => {
                const url = URL.createObjectURL(blob);
                if (entries.get(key) === entry) {
                    bytes += blob.size - entry.bytes;
                    entry.bytes = blob.size;
                    entry.made = true;
                    evict(key);
                }
                return url;
            });
            entry.url.catch(() => {
                if (entries.get(key) !== entry) return;
                entries.delete(key);
                bytes -= entry.bytes;
            });
            entries.set(key, entry);
            bytes += expected;
            evict();
            return entry.url;
        },

        hold(key) {
            holds.set(key, (holds.get(key) ?? 0) + 1);
            let released = false;
            return () => {
                if (released) return;
                released = true;
                const left = (holds.get(key) ?? 1) - 1;
                if (left > 0) holds.set(key, left);
                else holds.delete(key);
                evict();
            };
        },

        clear() {
            for (const entry of entries.values()) revoke(entry.url);
            entries.clear();
            bytes = 0;
        },
    };
}
