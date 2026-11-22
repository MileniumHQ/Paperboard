// The page's side of a file's bytes: read from the service in pieces into a
// Blob, and kept as a blob URL for the preview and for thumbnails. Recent
// files stay, bounded by count and bytes; the oldest are let go when it's
// full, unless something still shows them (a preview holds its file).
//
// Uploads go the other way: a file from the computer, sent in pieces, with
// how far it has got, until it's whole or canceled.

import type { ServiceCalls } from "@mileniumhq/paperapi";
import { CHUNK_BYTES, type DriveEntry, type driveContract } from "./contract";

type Calls = ServiceCalls<typeof driveContract>;

/** Files over this get a symbol, not a thumbnail: making one would read the whole file. */
export const THUMBNAIL_MAX_BYTES = 25 * 1024 * 1024;
/** Files over this open as a card with Download, not read whole into the page. */
export const PREVIEW_MAX_BYTES = 500 * 1024 * 1024;

const CACHE_FILES = 48;
const CACHE_BYTES = 256 * 1024 * 1024;

// media is typed so the browser plays it; anything else stays opaque, so opening it can never run it as a page
const MEDIA_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    jfif: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
    apng: "image/apng",
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogv: "video/ogg",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    flac: "audio/flac",
    weba: "audio/webm",
    pdf: "application/pdf",
};

/** The media type a file is read as: its media type for pictures, films, sound and PDFs; opaque bytes for the rest. */
export function mediaType(name: string): string {
    const dot = name.lastIndexOf(".");
    return (dot > 0 && MEDIA_TYPES[name.slice(dot + 1).toLowerCase()]) || "application/octet-stream";
}

const fromBase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

function toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const url = String(reader.result);
            resolve(url.slice(url.indexOf(",") + 1));
        };
        reader.onerror = () => reject(reader.error ?? new Error("The file couldn't be read from this computer."));
        reader.readAsDataURL(blob);
    });
}

/** What a file is cached by: a change to it is a different file. */
const keyOf = (entry: Pick<DriveEntry, "path" | "modified" | "size">) => `${entry.path}|${entry.modified}|${entry.size}`;

interface Cached {
    url: Promise<string>;
    bytes: number;
    holds: number;
}

export function createFiles(calls: Calls) {
    const cache = new Map<string, Cached>();
    let cached = 0;

    const evict = () => {
        for (const [key, c] of cache) {
            if (cache.size <= CACHE_FILES && cached <= CACHE_BYTES) break;
            // a file something still shows stays, however full the cache is
            if (c.holds > 0) continue;
            cache.delete(key);
            cached -= c.bytes;
            void c.url.then(
                (url) => URL.revokeObjectURL(url),
                // quiet: a read that failed made no URL, and its caller was told
                () => undefined,
            );
        }
    };

    /** A file's bytes, read piece by piece; an abort stops between pieces. */
    async function read(entry: DriveEntry, signal?: AbortSignal, onProgress?: (done: number) => void): Promise<Blob> {
        const parts: Uint8Array<ArrayBuffer>[] = [];
        let offset = 0;
        for (;;) {
            signal?.throwIfAborted();
            const piece = await calls.read({ path: entry.path, offset });
            if (piece.modified !== entry.modified || piece.size !== entry.size) throw new Error(`“${entry.name}” changed while it was being read.`);
            const bytes = fromBase64(piece.data);
            parts.push(bytes);
            offset += bytes.length;
            onProgress?.(offset);
            if (offset >= piece.size) break;
            if (bytes.length === 0) throw new Error(`“${entry.name}” ended before its size.`);
        }
        return new Blob(parts, { type: mediaType(entry.name) });
    }

    return {
        read,

        /**
         * A blob URL of the file, kept until `release` is called: read once,
         * and shared with anything else that holds it.
         */
        hold(entry: DriveEntry, signal?: AbortSignal): { url: Promise<string>; release: () => void } {
            const key = keyOf(entry);
            let c = cache.get(key);
            if (c) {
                // most recently used goes last
                cache.delete(key);
                cache.set(key, c);
            } else {
                const made: Cached = { url: read(entry).then((blob) => URL.createObjectURL(blob)), bytes: entry.size, holds: 0 };
                // a failed read isn't kept: the next look tries again
                made.url.catch(() => {
                    if (cache.get(key) !== made) return;
                    cache.delete(key);
                    cached -= made.bytes;
                });
                cache.set(key, made);
                cached += made.bytes;
                c = made;
            }
            const held = c;
            held.holds++;
            evict();
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                held.holds--;
                evict();
            };
            signal?.addEventListener("abort", release, { once: true });
            return { url: held.url, release };
        },

        /** Sends a file into a folder, in pieces; resolves with where it landed. An abort cancels it on the service too. */
        async upload(file: File, folder: string, onProgress: (sent: number) => void, signal: AbortSignal): Promise<DriveEntry> {
            const { id } = await calls.uploadBegin({ folder, name: file.name, size: file.size });
            try {
                for (let offset = 0; offset < file.size; ) {
                    signal.throwIfAborted();
                    const piece = file.slice(offset, offset + CHUNK_BYTES);
                    await calls.uploadPut({ id, offset, data: await toBase64(piece) });
                    offset += piece.size;
                    onProgress(offset);
                }
                signal.throwIfAborted();
                return await calls.uploadFinish({ id });
            } catch (err) {
                // quiet: the caller hears why it stopped; a part the service can't drop now goes when it next starts
                await calls.uploadCancel({ id }).catch((why) => console.error("[drive] an upload couldn't be canceled:", why));
                throw err;
            }
        },
    };
}

export type DriveFiles = ReturnType<typeof createFiles>;
