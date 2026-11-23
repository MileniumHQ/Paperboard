// What PaperFileView says about an entry: its symbol and colour, what kind
// of file it is, its size and when it changed. Pure, so it's tested without
// a DOM. The kinds PaperPreview has a viewer for come from its own helpers,
// so a file's symbol here and in its preview never disagree.

import { formatBytes } from "../../utils/bytes";
import { previewExtension, previewIcon, previewKind, previewKindLabel, type PaperPreviewKind } from "../../templates/PaperPreview/kinds";
import type { PaperFileViewEntry, PaperFileViewSort } from "./types";

export interface PaperFileViewKind {
    /** a Material Symbols name */
    icon: string;
    /** the PaperUI colour the symbol is drawn in */
    tone: string;
    /** what it's called in the Kind column */
    label: string;
}

const TONES: Record<PaperPreviewKind, string> = {
    image: "extra-2",
    video: "extra-1",
    audio: "extra-3",
    pdf: "danger",
    model: "warning",
    markdown: "text-muted",
    code: "primary",
    text: "text-muted",
    table: "success",
    font: "primary",
};

// files PaperPreview shows only as a card, which people still know on sight
const OTHERS: [string[], PaperFileViewKind][] = [
    [["zip", "tar", "gz", "tgz", "7z", "rar", "xz", "bz2"], { icon: "folder_zip", tone: "warning", label: "Archive" }],
    [["doc", "docx", "odt", "pages", "rtf"], { icon: "description", tone: "primary", label: "Document" }],
    [["xls", "xlsx", "ods", "numbers"], { icon: "table_view", tone: "success", label: "Spreadsheet" }],
    [["ppt", "pptx", "odp", "key"], { icon: "slideshow", tone: "warning", label: "Presentation" }],
    [["heic", "heif", "tif", "tiff", "psd", "raw", "cr2", "nef", "arw", "dng"], { icon: "image", tone: "extra-2", label: "Image" }],
];

const FOLDER: PaperFileViewKind = { icon: "folder", tone: "primary", label: "Folder" };

/** The symbol, colour and kind name of an entry. */
export function paperFileViewKind(entry: Pick<PaperFileViewEntry, "name" | "kind">): PaperFileViewKind {
    if (entry.kind === "folder") return FOLDER;
    const kind = previewKind(entry.name);
    if (kind) return { icon: previewIcon(kind), tone: TONES[kind], label: previewKindLabel(kind, entry.name) };
    const ext = previewExtension(entry.name);
    for (const [exts, known] of OTHERS) if (exts.includes(ext)) return known;
    return { icon: previewIcon(null), tone: "text-muted", label: previewKindLabel(null, entry.name) };
}

/** The extension drawn on a file's sheet; "" for a name without one. */
export function paperFileViewExtension(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/** A file's size, or how many items a folder holds; "—" when it isn't known. */
export function paperFileViewSize(entry: PaperFileViewEntry): string {
    if (entry.kind === "folder") return entry.count === undefined ? "—" : `${entry.count} ${entry.count === 1 ? "item" : "items"}`;
    return entry.size === undefined ? "—" : formatBytes(entry.size);
}

/** When an entry changed, the way a person says it: "Today at 4:52 PM", "Nov 3", "Mar 2, 2024". */
export function paperFileViewDate(ms: number | undefined, now = new Date()): string {
    if (ms === undefined) return "—";
    const date = new Date(ms);
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const days = Math.round((day(now) - day(date)) / 86_400_000);
    if (days === 0) return `Today at ${time}`;
    if (days === 1) return `Yesterday at ${time}`;
    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    });
}

const byName = (a: PaperFileViewEntry, b: PaperFileViewEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Entries in the order the view shows them: folders first, then by the sort, then by name. */
export function sortPaperFileViewEntries(entries: readonly PaperFileViewEntry[], sort: PaperFileViewSort): PaperFileViewEntry[] {
    const by = (a: PaperFileViewEntry, b: PaperFileViewEntry): number => {
        if (sort.key === "modified") return (a.modified ?? 0) - (b.modified ?? 0);
        if (sort.key === "size") return (a.size ?? a.count ?? 0) - (b.size ?? b.count ?? 0);
        if (sort.key === "kind") return paperFileViewKind(a).label.localeCompare(paperFileViewKind(b).label);
        return 0;
    };
    return [...entries].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        return sort.dir * (by(a, b) || byName(a, b));
    });
}

/** The folder an entry is in; "" for one at the root. */
export const paperFileViewParent = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Whether `path` is `folder` or anything inside it. */
export const paperFileViewInside = (path: string, folder: string): boolean => folder === "" || path === folder || path.startsWith(`${folder}/`);
