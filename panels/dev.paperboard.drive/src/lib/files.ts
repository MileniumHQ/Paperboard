// The page's side of a file's bytes: read from the service in pieces into a
// Blob, and kept as a blob URL for the preview and for thumbnails. Recent
// files stay, bounded by count and bytes; the oldest are let go when it's
// full, unless something still shows them (a preview holds its file).
//
// Uploads go the other way: a file from the computer, sent in pieces, with
// how far it has got, until it's whole or canceled.

import { createBlobUrlCache, readInPieces, sendInPieces, type ServiceCalls } from "@mileniumhq/paperapi";
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

/** What a file is cached by: a change to it is a different file. */
const keyOf = (entry: Pick<DriveEntry, "path" | "modified" | "size">) => `${entry.path}|${entry.modified}|${entry.size}`;

/** The files of one place: `place` is its id. */
export function createFiles(calls: Calls, place: string) {
    const urls = createBlobUrlCache({ files: CACHE_FILES, bytes: CACHE_BYTES });

    /** A file's bytes, read piece by piece; an abort stops between pieces. */
    const read = (entry: DriveEntry, signal?: AbortSignal, onProgress?: (done: number) => void): Promise<Blob> =>
        readInPieces({
            name: entry.name,
            type: mediaType(entry.name),
            signal,
            onProgress,
            piece: async (offset) => {
                const piece = await calls.read({ place, path: entry.path, offset });
                if (piece.modified !== entry.modified || piece.size !== entry.size) throw new Error(`“${entry.name}” changed while it was being read.`);
                return piece;
            },
        });

    return {
        read,

        /**
         * A blob URL of the file, kept until `release` is called: read once,
         * and shared with anything else that holds it.
         */
        hold(entry: DriveEntry, signal?: AbortSignal): { url: Promise<string>; release: () => void } {
            const key = keyOf(entry);
            const release = urls.hold(key);
            signal?.addEventListener("abort", release, { once: true });
            return { url: urls.get(key, () => read(entry), entry.size), release };
        },

        /** Sends a file into a folder, in pieces; resolves with where it landed. An abort cancels it on the service too. */
        upload: (file: File, folder: string, onProgress: (sent: number) => void, signal: AbortSignal): Promise<DriveEntry> =>
            sendInPieces(file, {
                pieceBytes: CHUNK_BYTES,
                onProgress,
                signal,
                begin: async () => {
                    const { id } = await calls.uploadBegin({ place, folder, name: file.name, size: file.size });
                    return {
                        put: (offset, data) => calls.uploadPut({ place, id, offset, data }),
                        finish: () => calls.uploadFinish({ place, id }),
                        cancel: () => calls.uploadCancel({ place, id }),
                    };
                },
            }),

        /** Lets go of every file read, held ones too: for when nothing shows them anymore. */
        clear: () => urls.clear(),
    };
}

export type DriveFiles = ReturnType<typeof createFiles>;
