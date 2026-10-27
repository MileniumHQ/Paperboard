// Text conversion and bounds for chat attachments. The UI reads the raw
// file (or the browser hands back a data URL); this module owns what is
// allowed in, how a file becomes model-readable text, and the size caps the
// service re-checks at its own boundary.

import type { Attachment } from "./types";

export const MAX_ATTACHMENTS = 6;
/** converted text kept per file */
export const MAX_ATTACHMENT_TEXT_BYTES = 200_000;
/** bytes of a raw text file read; larger files are refused by the UI */
export const MAX_SOURCE_TEXT_BYTES = 2 * 1024 * 1024;
/** images are downscaled before they get here; this is the hard cap */
export const MAX_ATTACHMENT_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 1600;

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Extensions the lightweight converter understands. Code and data files,
 *  not documents: a PDF or DOCX is refused rather than half-read. */
const TEXT_EXTENSIONS = new Set([
    "txt", "text", "log", "md", "markdown", "json", "jsonc", "ndjson",
    "csv", "tsv", "yaml", "yml", "toml", "ini", "conf", "cfg", "properties",
    "xml", "html", "htm", "css", "scss", "less",
    "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "rb", "php", "lua",
    "rs", "go", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs",
    "sh", "bash", "zsh", "ps1", "bat", "sql", "graphql", "tf", "dockerfile",
]);

export function extensionOf(name: string): string {
    const base = name.toLowerCase().split(/[\\/]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    if (dot <= 0) return base === "dockerfile" ? "dockerfile" : "";
    return base.slice(dot + 1);
}

export function isImageMime(mime: string): boolean {
    return IMAGE_MIMES.has(mime.toLowerCase());
}

export function isSupportedTextFile(name: string, mime: string): boolean {
    if (isImageMime(mime)) return false;
    if (mime.startsWith("text/")) return true;
    if (mime === "application/json" || mime === "application/xml") return true;
    return TEXT_EXTENSIONS.has(extensionOf(name));
}

const ENTITIES: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
};

/** Drops markup but keeps the readable text of an HTML document. */
export function stripHtml(html: string): string {
    return html
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&([a-z#0-9]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

/** Caps text to a UTF-8 byte budget, appending an explicit truncation note. */
export function capText(text: string, maxBytes: number): string {
    const encoder = new TextEncoder();
    if (encoder.encode(text).length <= maxBytes) return text;
    let end = text.length;
    while (end > 0 && encoder.encode(text.slice(0, end)).length > maxBytes) {
        end = Math.floor(end * 0.9);
    }
    return `${text.slice(0, end).trimEnd()}\n[truncated]`;
}

/** The text a model reads for a converted file. */
export function convertToText(name: string, raw: string): string {
    const text = extensionOf(name) === "html" || extensionOf(name) === "htm" ? stripHtml(raw) : raw;
    return capText(text.replace(/\r\n?/g, "\n"), MAX_ATTACHMENT_TEXT_BYTES);
}

/** base64 payload of an image data URL, for providers that send raw bytes. */
export function imageBase64(dataUrl: string): string | null {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
    if (!match || !isImageMime(match[1])) return null;
    return match[2];
}

export interface AttachmentLimits {
    /** the chosen model can see images */
    vision: boolean;
}

/**
 * Re-checks what the UI assembled before it reaches a model: counts, sizes,
 * kinds, and whether the model can see an image at all. Throws with a
 * message the user can act on — a silently dropped attachment is worse than
 * a refused send.
 */
export function validateAttachments(attachments: readonly Attachment[], limits: AttachmentLimits): void {
    if (attachments.length === 0) return;
    if (attachments.length > MAX_ATTACHMENTS) {
        throw new Error(`At most ${MAX_ATTACHMENTS} files can be attached to one message.`);
    }
    for (const a of attachments) {
        if (a.kind === "image") {
            if (!limits.vision) {
                throw new Error(`${a.name} is an image, and this model cannot see images. Pick a vision model or remove it.`);
            }
            if (!a.dataUrl || !imageBase64(a.dataUrl)) {
                throw new Error(`${a.name} is not a readable image.`);
            }
            if (a.sizeBytes > MAX_ATTACHMENT_IMAGE_BYTES) {
                throw new Error(`${a.name} is larger than ${Math.round(MAX_ATTACHMENT_IMAGE_BYTES / 1024 / 1024)} MB.`);
            }
        } else {
            if (typeof a.text !== "string" || !a.text.trim()) {
                throw new Error(`${a.name} has no readable text.`);
            }
        }
    }
}
