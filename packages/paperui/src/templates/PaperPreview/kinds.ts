// What a file previews as, decided once from its media type and its name,
// so the preview, its thumbnail and a host's own icon never disagree.

import { grammarFor } from "../../utils/highlight";

/** How a file is shown: which viewer PaperPreview picks for it. */
export type PaperPreviewKind =
    | "image"
    | "video"
    | "audio"
    | "pdf"
    | "model"
    | "markdown"
    | "code"
    | "text"
    | "table"
    | "font";

/** The 3D formats PaperModel opens, by the extension that names them. */
export type PaperModelFormat = "glb" | "gltf" | "obj" | "stl" | "ply" | "fbx" | "3mf" | "dae" | "usdz";

export const PAPER_MODEL_FORMATS: readonly PaperModelFormat[] = ["glb", "gltf", "obj", "stl", "ply", "fbx", "3mf", "dae", "usdz"];

/** The most of a text file a preview reads; past it, the preview says it's cut. */
export const PAPER_PREVIEW_TEXT_BYTES = 1024 * 1024;

// a file's extension, for the language its code is in: the ids PaperCode
// highlights, or the extension itself, which shows plain when PaperCode
// has no grammar for it
const LANGUAGES: Record<string, string> = {
    ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
    json: "json", jsonc: "json5", json5: "json5", css: "css",
    sh: "bash", bash: "bash", zsh: "bash", yml: "yaml", yaml: "yaml", toml: "toml",
    ini: "ini", cfg: "ini", conf: "ini", properties: "properties",
};
const CODE_EXTENSIONS = new Set([
    ...Object.keys(LANGUAGES),
    "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs",
    "php", "lua", "sql", "html", "htm", "xml", "svelte", "vue", "scss", "less",
    "dockerfile", "makefile", "gradle", "env", "lock", "diff", "patch",
]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);
const TEXT_EXTENSIONS = new Set(["txt", "text", "log"]);
const TABLE_EXTENSIONS = new Set(["csv", "tsv"]);
const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg", "apng", "jfif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "ogv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "weba"]);
// pictures a browser can't decode: a card, not a broken image
const UNDRAWABLE_IMAGES = new Set(["heic", "heif", "tif", "tiff", "psd", "raw", "cr2", "nef", "arw", "dng"]);

const MODEL_TYPES: Record<string, PaperModelFormat> = {
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
    "model/obj": "obj",
    "model/stl": "stl",
    "model/x.stl-binary": "stl",
    "model/x.stl-ascii": "stl",
    "model/3mf": "3mf",
    "model/vnd.collada+xml": "dae",
    "model/vnd.usdz+zip": "usdz",
};

/** A file's extension, lowercased; a dotless name like Dockerfile is its own. */
export function previewExtension(name: string): string {
    const base = name.split(/[\\/]/).pop()!.toLowerCase();
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot + 1) : base;
}

const mediaType = (type: string) => type.toLowerCase().split(";")[0].trim();

/** The 3D format a file is in, from its media type, then its name; null when it isn't a model. */
export function previewModelFormat(name: string, type = ""): PaperModelFormat | null {
    const fromType = MODEL_TYPES[mediaType(type)];
    if (fromType) return fromType;
    const ext = previewExtension(name);
    return (PAPER_MODEL_FORMATS as readonly string[]).includes(ext) ? (ext as PaperModelFormat) : null;
}

/**
 * What a file previews as, from its media type and its name: null when
 * PaperPreview has no viewer for it, which shows it as a card instead. A
 * media type is trusted first, since names lie less often than they're
 * missing; a generic one (application/octet-stream) defers to the name.
 */
export function previewKind(name: string, type = ""): PaperPreviewKind | null {
    const t = mediaType(type);
    const ext = previewExtension(name);
    if (UNDRAWABLE_IMAGES.has(ext) || t === "image/heic" || t === "image/heif" || t === "image/tiff") return null;
    if (t === "application/pdf" || ext === "pdf") return "pdf";
    if (previewModelFormat(name, t)) return "model";
    if (t.startsWith("font/") || FONT_EXTENSIONS.has(ext)) return "font";
    if (t.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) return "image";
    if (t.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) return "video";
    if (t.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) return "audio";
    if (t === "text/markdown" || MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
    if (t === "text/csv" || t === "text/tab-separated-values" || TABLE_EXTENSIONS.has(ext)) return "table";
    if (CODE_EXTENSIONS.has(ext)) return "code";
    if (t.startsWith("text/") || t === "application/json" || TEXT_EXTENSIONS.has(ext)) return "text";
    return null;
}

/** The language PaperCode highlights a file's code in; "text" when it has no grammar for it. */
export function previewLanguage(name: string): string {
    const ext = previewExtension(name);
    const language = LANGUAGES[ext] ?? ext;
    return grammarFor(language) ? language : "text";
}

const ICONS: Record<PaperPreviewKind, string> = {
    image: "image",
    video: "movie",
    audio: "music_note",
    pdf: "picture_as_pdf",
    model: "view_in_ar",
    markdown: "article",
    code: "code",
    text: "description",
    table: "table_view",
    font: "match_case",
};

/** The symbol that stands for a file of this kind; a plain page for one PaperPreview has no viewer for. */
export function previewIcon(kind: PaperPreviewKind | null): string {
    return kind ? ICONS[kind] : "draft";
}

const LABELS: Record<PaperPreviewKind, string> = {
    image: "Image",
    video: "Video",
    audio: "Audio",
    pdf: "PDF document",
    model: "3D model",
    markdown: "Markdown document",
    code: "Code",
    text: "Text",
    table: "Spreadsheet",
    font: "Font",
};

/** What a file of this kind is called in a sentence, such as a card's caption. */
export function previewKindLabel(kind: PaperPreviewKind | null, name = ""): string {
    if (kind) return LABELS[kind];
    const ext = previewExtension(name);
    return ext && ext !== name.toLowerCase() ? `${ext.toUpperCase()} file` : "File";
}
