import type { JSX } from "solid-js";

/** One file or folder, as the host lists it. */
export interface PaperFileViewEntry {
    name: string;
    /** "/"-joined from the host's root; "" is the root itself */
    path: string;
    kind: "file" | "folder";
    /** a file's size in bytes */
    size?: number;
    /** when it last changed, in ms since the epoch */
    modified?: number;
    /** a folder's item count, shown in place of a size */
    count?: number;
}

export type PaperFileViewMode = "icons" | "list";
export type PaperFileViewSortKey = "name" | "modified" | "size" | "kind";

export interface PaperFileViewSort {
    key: PaperFileViewSortKey;
    /** 1 ascending, -1 descending; folders come first either way */
    dir: 1 | -1;
}

/** What was let go over a folder: entries dragged inside the view, or files from the computer. */
export type PaperFileViewDrop =
    | { kind: "entries"; paths: string[]; folder: string }
    | { kind: "files"; files: File[]; folder: string };

export interface PaperFileViewThumbnailOptions {
    /** the picture's longer edge, in device pixels */
    size: number;
    /** the box it's drawn in, in CSS pixels: a list row's is small, an icon's large */
    edge: number;
    /** aborted when the entry leaves the view or changes */
    signal: AbortSignal;
}

export interface PaperFileViewRef {
    /** lists the folder again, or every folder the view has open */
    reload: (folder?: string) => Promise<void>;
    /** starts renaming an entry in place */
    rename: (path: string) => void;
    /** an entry the view has listed */
    entry: (path: string) => PaperFileViewEntry | undefined;
    /** the entries on screen, in the order the arrows walk them */
    entries: () => PaperFileViewEntry[];
    focus: () => void;
    /** moves the choice by one file, for keys the host keeps, such as arrows under a preview */
    step: (delta: 1 | -1) => void;
}

export interface PaperFileViewProps {
    /** the folder shown */
    folder: string;
    /** lists a folder; a rejection is shown in place, with Try again */
    list: (folder: string) => Promise<PaperFileViewEntry[]>;
    mode?: PaperFileViewMode;
    /** paths, in the order they were chosen */
    selection: readonly string[];
    onSelectionChange: (paths: string[]) => void;
    /** Enter, a double click, a tap, or a drag held over a folder */
    onOpen: (entry: PaperFileViewEntry) => void;
    /** Space */
    onQuickLook?: (entry: PaperFileViewEntry) => void;
    /** turns on F2 and the slow second click on a chosen name */
    onRename?: (entry: PaperFileViewEntry, name: string) => void | Promise<void>;
    /** Delete, or ⌘⌫ on a Mac, with the chosen entries */
    onDelete?: (entries: PaperFileViewEntry[]) => void;
    /** turns on dragging entries onto folders, and dropping files from the computer */
    onDrop?: (drop: PaperFileViewDrop) => void;
    /** a right click or a long press; entry is null for the empty space */
    onContextMenu?: (event: MouseEvent, entry: PaperFileViewEntry | null) => void;
    /**
     * A small picture of a file, drawn in place of its symbol: asked only
     * once the entry is near the screen, and resolving null for a file with
     * none. A rejection is shown on the entry's symbol.
     */
    thumbnail?: (entry: PaperFileViewEntry, options: PaperFileViewThumbnailOptions) => Promise<Blob | null>;
    sort?: PaperFileViewSort;
    onSortChange?: (sort: PaperFileViewSort) => void;
    /** the icon's edge in px, in icons; 72 by default */
    iconSize?: number;
    /** what an empty folder shows; a quiet "This folder is empty" by default */
    empty?: JSX.Element;
    "aria-label": string;
    ref?: (view: PaperFileViewRef) => void;
    class?: string;
}
