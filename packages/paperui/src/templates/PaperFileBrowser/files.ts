// What PaperFileBrowser shows for a file: its icon and its language. Pure,
// so the mapping is tested without a DOM.

/**
 * Every Material Symbols ligature the file browser renders. The component
 * takes its icons only from here, so the browser test that checks each
 * name draws as a real glyph covers all of them.
 */
export const PAPER_FILE_BROWSER_ICONS = {
    folder: "folder",
    folderOpen: "folder_open",
    expand: "chevron_right",
    file: "draft",
    text: "description",
    config: "settings",
    data: "data_object",
    code: "code",
    markup: "html",
    image: "image",
    archive: "folder_zip",
    database: "database",
    terminal: "terminal",
    log: "article",
    lockFile: "lock",
    readOnly: "edit_off",
    save: "save",
    menu: "more_vert",
    refresh: "refresh",
    revert: "undo",
    reload: "sync",
    wrap: "wrap_text",
    lineNumbers: "format_list_numbered",
    copy: "content_copy",
    error: "error",
    emptyFolder: "folder_off",
    unavailable: "visibility_off",
    choose: "draft",
    saved: "check_circle",
    warning: "warning",
} as const;

export type PaperFileBrowserIcon = keyof typeof PAPER_FILE_BROWSER_ICONS;

export interface PaperFileLanguage {
    /** Prism language id, or undefined for plain text */
    id?: string;
    label: string;
}

const ICONS = PAPER_FILE_BROWSER_ICONS;

function extensionOf(name: string): string {
    const lower = name.toLowerCase();
    // multi-part extensions that mean something on their own
    for (const ext of [".mv.db", ".tar.gz"]) if (lower.endsWith(ext)) return ext.slice(1);
    const dot = lower.lastIndexOf(".");
    return dot > 0 ? lower.slice(dot + 1) : "";
}

const ICON_BY_EXTENSION: Record<string, string> = {
    yml: ICONS.config,
    yaml: ICONS.config,
    toml: ICONS.config,
    properties: ICONS.config,
    conf: ICONS.config,
    cfg: ICONS.config,
    ini: ICONS.config,
    hocon: ICONS.config,
    json: ICONS.data,
    json5: ICONS.data,
    mcmeta: ICONS.data,
    txt: ICONS.text,
    md: ICONS.text,
    log: ICONS.log,
    js: ICONS.code,
    mjs: ICONS.code,
    ts: ICONS.code,
    java: ICONS.code,
    kt: ICONS.code,
    py: ICONS.code,
    lua: ICONS.code,
    sk: ICONS.code,
    html: ICONS.markup,
    xml: ICONS.markup,
    png: ICONS.image,
    jpg: ICONS.image,
    jpeg: ICONS.image,
    gif: ICONS.image,
    webp: ICONS.image,
    svg: ICONS.image,
    jar: ICONS.archive,
    zip: ICONS.archive,
    gz: ICONS.archive,
    "tar.gz": ICONS.archive,
    mrpack: ICONS.archive,
    db: ICONS.database,
    "mv.db": ICONS.database,
    sqlite: ICONS.database,
    dat: ICONS.database,
    nbt: ICONS.database,
    mca: ICONS.database,
    mcr: ICONS.database,
    sh: ICONS.terminal,
    bat: ICONS.terminal,
    cmd: ICONS.terminal,
    ps1: ICONS.terminal,
    lock: ICONS.lockFile,
};

export function paperFileIcon(name: string, kind: "file" | "folder", expanded = false): string {
    if (kind === "folder") return expanded ? ICONS.folderOpen : ICONS.folder;
    return ICON_BY_EXTENSION[extensionOf(name)] ?? ICONS.file;
}

const LANGUAGE_BY_EXTENSION: Record<string, PaperFileLanguage> = {
    yml: { id: "yaml", label: "YAML" },
    yaml: { id: "yaml", label: "YAML" },
    toml: { id: "toml", label: "TOML" },
    properties: { id: "properties", label: "Properties" },
    ini: { id: "ini", label: "INI" },
    json: { id: "json", label: "JSON" },
    mcmeta: { id: "json", label: "JSON" },
    json5: { id: "json5", label: "JSON5" },
    md: { id: "markdown", label: "Markdown" },
    js: { id: "javascript", label: "JavaScript" },
    mjs: { id: "javascript", label: "JavaScript" },
    ts: { id: "typescript", label: "TypeScript" },
    sh: { id: "bash", label: "Shell" },
    html: { id: "markup", label: "HTML" },
    xml: { id: "markup", label: "XML" },
    svg: { id: "markup", label: "SVG" },
    css: { id: "css", label: "CSS" },
    // formats PaperUI has no grammar for still get a truthful name
    conf: { label: "Config" },
    cfg: { label: "Config" },
    sk: { label: "Skript" },
    log: { label: "Log" },
};

export function paperFileLanguage(name: string): PaperFileLanguage {
    return LANGUAGE_BY_EXTENSION[extensionOf(name)] ?? { label: "Plain text" };
}

/** "a/b/c" → ["a", "a/b", "a/b/c"]; "" → [] */
export function ancestorPaths(path: string): string[] {
    if (!path) return [];
    const parts = path.split("/");
    return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function parentPath(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "" : path.slice(0, slash);
}

export function baseName(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}
