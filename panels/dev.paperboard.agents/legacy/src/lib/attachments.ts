// Turning browser Files into chat attachments. Images are downscaled so a
// screenshot does not bloat a conversation; text-like files are converted by
// the core converter. Everything the service will re-check happens here first
// so a bad file fails next to the paperclip, not after a round trip.

import {
    MAX_ATTACHMENT_IMAGE_BYTES,
    MAX_IMAGE_DIMENSION,
    MAX_SOURCE_TEXT_BYTES,
    convertToText,
    isImageMime,
    isSupportedTextFile,
} from "../core/attachments";
import type { Attachment } from "../core/types";

function megabytes(bytes: number): string {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("The image could not be decoded."));
        image.src = url;
    });
}

async function downscaledImage(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
        const image = await loadImage(url);
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("The image could not be processed.");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        // re-encode: a PNG screenshot becomes a much smaller JPEG, and the
        // alpha channel a JPEG cannot carry is worth the size for photos
        const type = file.type === "image/png" && scale >= 1 ? "image/png" : "image/jpeg";
        return canvas.toDataURL(type, 0.85);
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function newAttachmentId(): string {
    return crypto.randomUUID();
}

/** Reads one browser File into an attachment, or throws with a reason. */
export async function attachmentFromFile(file: File): Promise<Attachment> {
    const name = file.name || "attachment";
    const mime = file.type || "";
    if (isImageMime(mime)) {
        if (file.size > MAX_ATTACHMENT_IMAGE_BYTES) {
            throw new Error(`${name} is larger than ${megabytes(MAX_ATTACHMENT_IMAGE_BYTES)}.`);
        }
        return {
            id: newAttachmentId(),
            name,
            kind: "image",
            mime,
            sizeBytes: file.size,
            dataUrl: await downscaledImage(file),
        };
    }
    if (!isSupportedTextFile(name, mime)) {
        throw new Error(`${name} is not a file type the AI can read. Text, data and code files work.`);
    }
    if (file.size > MAX_SOURCE_TEXT_BYTES) {
        throw new Error(`${name} is larger than ${megabytes(MAX_SOURCE_TEXT_BYTES)}.`);
    }
    const text = convertToText(name, await file.text());
    if (!text.trim()) throw new Error(`${name} has no readable text.`);
    return { id: newAttachmentId(), name, kind: "text", mime: mime || "text/plain", sizeBytes: file.size, text };
}

/** Every file in a drop, read in order; the first failure aborts the set. */
export async function attachmentsFromFiles(files: Iterable<File>): Promise<Attachment[]> {
    const out: Attachment[] = [];
    for (const file of files) out.push(await attachmentFromFile(file));
    return out;
}
