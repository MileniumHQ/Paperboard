// The UI's side of the conversation's files: uploading the user's in chunks
// (one call can't carry 25 MB), and reading any of them back into a blob
// URL to show. Read files are kept in a small cache bounded by count and
// bytes; the oldest are released when it's full.

import { base64ToBytes, createBlobUrlCache, readInPieces, sendInPieces, type ServiceCalls } from "@mileniumhq/paperapi";
import { LIMITS, type Attachment, type agentsContract } from "../contract";

const CACHE_FILES = 32;
const CACHE_BYTES = 160 * 1024 * 1024;
const WEB_IMAGE_BYTES = 64 * 1024 * 1024;

export function createFiles(calls: ServiceCalls<typeof agentsContract>) {
    type Read = { url: string; file: Attachment };
    // files on screen in the preview are held there: their URLs stay alive however full it gets
    const urls = createBlobUrlCache({ files: CACHE_FILES, bytes: CACHE_BYTES });
    // what a file is, without its bytes: a file never changes once it's in the conversation
    const infos = new Map<string, Promise<Attachment>>();
    // web pictures messages show, by address: the service fetches them, never this page
    const webImages = createBlobUrlCache({ files: CACHE_FILES, bytes: WEB_IMAGE_BYTES });

    const info = (id: string): Promise<Attachment> => {
        const hit = infos.get(id);
        if (hit) return hit;
        const asked = calls.attachInfo({ id });
        infos.set(id, asked);
        // a failed look isn't kept: the next one tries again
        asked.catch(() => infos.get(id) === asked && infos.delete(id));
        return asked;
    };

    return {
        /** Upload a file; progress is 0–1. An abort cancels the upload on the service too. */
        async upload(file: File, onProgress: (done: number) => void, signal: AbortSignal): Promise<Attachment> {
            if (file.size > LIMITS.attachments.fileBytes) throw new Error(`${file.name} is over ${LIMITS.attachments.fileBytes / 1024 / 1024} MB`);
            return sendInPieces(file, {
                pieceBytes: LIMITS.attachments.chunkBytes,
                signal,
                onProgress: (sent) => onProgress(sent / file.size),
                begin: async () => {
                    const { id } = await calls.attachBegin({ name: file.name, bytes: file.size });
                    return {
                        put: (offset, data) => calls.attachPut({ id, offset, data }),
                        finish: () => calls.attachFinish({ id }),
                        cancel: () => calls.attachCancel({ id }),
                    };
                },
            });
        },

        /**
         * A file by its id, as a blob URL and what it is: read once and kept while it's among the recent ones.
         * `bytes` (known for a file a message lists) counts it in the cache before it's read.
         */
        async read(id: string, bytes = 0): Promise<Read> {
            const url = await urls.get(
                id,
                async () => {
                    // each piece says what the file is; the last one is kept
                    const seen: { file?: Attachment } = {};
                    const blob = await readInPieces({
                        piece: async (offset) => {
                            const r = await calls.attachRead({ id, offset });
                            seen.file = r.file;
                            return { data: r.data, size: r.file.bytes };
                        },
                    });
                    const read = seen.file!;
                    infos.set(id, Promise.resolve(read));
                    // only media is typed: anything else stays opaque, so opening it can never run it as a page
                    return read.kind === "file" ? blob : new Blob([blob], { type: read.type });
                },
                bytes,
            );
            return { url, file: await info(id) };
        },

        /**
         * Keeps a file's blob URL alive while something reads from it over
         * time (a PDF's pages, a film's seeking), until the returned release.
         */
        hold: (id: string): (() => void) => urls.hold(id),

        /** What a file is, without reading it: for a chip that names it. */
        info,

        /**
         * A web picture a message shows, as a blob URL. The service fetches it under the agent's network rule
         * (public addresses only), so this page never sends a request to a host a message names.
         */
        webImage: (url: string): Promise<string> =>
            webImages.get(url, async () => {
                const r = await calls.webImage({ url });
                return new Blob([base64ToBytes(r.data)], { type: r.type });
            }),

        /** Release every blob (the conversation changed, or the panel closes). */
        clear() {
            infos.clear();
            webImages.clear();
            urls.clear();
        },
    };
}

export type Files = ReturnType<typeof createFiles>;

/** "1.2 MB": a file's size as the chat and the agent are shown it */
export const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
