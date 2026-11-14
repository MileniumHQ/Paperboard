// The folder tree: listings loaded on demand and cached, which folders are
// open, and the rows the tree shows for them.
import { createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { PaperFileEntry, PaperFileListing } from "./types";
import { messageOf } from "./files";

type FolderState =
    | { status: "loading" }
    | { status: "ready"; entries: PaperFileEntry[]; note?: string }
    | { status: "error"; message: string };

export type Row =
    | { type: "entry"; entry: PaperFileEntry; depth: number; setSize: number; position: number }
    | { type: "status"; folder: string; depth: number; state: "loading" | "error" | "empty" | "note"; message: string };

export type EntryRow = Extract<Row, { type: "entry" }>;

const sameRow = (a: Row, b: Row): boolean => {
    if (a.type === "entry" && b.type === "entry") {
        return a.entry === b.entry && a.depth === b.depth && a.setSize === b.setSize && a.position === b.position;
    }
    if (a.type === "status" && b.type === "status") {
        return a.folder === b.folder && a.depth === b.depth && a.state === b.state && a.message === b.message;
    }
    return false;
};

/** `list` reaches whatever owns the files; it is read on every load. */
export function createFolderTree(list: (path: string) => Promise<PaperFileListing>) {
    const [folders, setFolders] = createStore<Record<string, FolderState>>({});
    const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set([""]));

    const inflight = new Map<string, Promise<void>>();
    let listGeneration = 0;

    const loadFolder = (path: string, force = false): Promise<void> => {
        const running = inflight.get(path);
        if (running && !force) return running;
        if (!force && folders[path]?.status === "ready") return Promise.resolve();
        const generation = listGeneration;
        if (folders[path]?.status !== "ready") setFolders(path, { status: "loading" });
        // started on a microtask so `task` exists before its own cleanup runs,
        // even when `list` throws synchronously
        const task: Promise<void> = Promise.resolve().then(async () => {
            try {
                const listing = await list(path);
                if (generation !== listGeneration) return;
                setFolders(path, { status: "ready", entries: listing.entries, note: listing.note });
            } catch (err) {
                if (generation !== listGeneration) return;
                setFolders(path, { status: "error", message: messageOf(err) });
            } finally {
                if (inflight.get(path) === task) inflight.delete(path);
            }
        });
        inflight.set(path, task);
        return task;
    };

    const refresh = () => {
        listGeneration++;
        inflight.clear();
        for (const path of expanded()) void loadFolder(path, true);
    };

    const setFolderOpen = (path: string, open: boolean) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (open) next.add(path);
            else next.delete(path);
            return next;
        });
        if (open) void loadFolder(path);
    };

    // rows keep their identity while they are unchanged, so expanding one
    // folder does not rebuild (and drop focus from) every other row
    let rowCache = new Map<string, Row>();

    const rows = createMemo<Row[]>(() => {
        const out: Row[] = [];
        const next = new Map<string, Row>();
        const push = (key: string, row: Row) => {
            const previous = rowCache.get(key);
            const kept = previous && sameRow(previous, row) ? previous : row;
            next.set(key, kept);
            out.push(kept);
        };
        const open = expanded();
        const walk = (folder: string, depth: number) => {
            const state = folders[folder];
            if (!state || state.status === "loading") {
                push(`loading:${folder}`, { type: "status", folder, depth, state: "loading", message: "Loading…" });
                return;
            }
            if (state.status === "error") {
                push(`error:${folder}`, { type: "status", folder, depth, state: "error", message: state.message });
                return;
            }
            if (state.entries.length === 0) {
                push(`empty:${folder}`, { type: "status", folder, depth, state: "empty", message: "This folder is empty" });
            }
            state.entries.forEach((entry, i) => {
                push(`entry:${entry.path}`, { type: "entry", entry, depth, setSize: state.entries.length, position: i + 1 });
                if (entry.kind === "folder" && open.has(entry.path)) walk(entry.path, depth + 1);
            });
            if (state.note) push(`note:${folder}`, { type: "status", folder, depth, state: "note", message: state.note });
        };
        walk("", 1);
        rowCache = next;
        return out;
    });

    const entryRows = () => rows().filter((row): row is EntryRow => row.type === "entry");

    /** whether `path` is a folder the tree has listed, or is listing */
    const isListed = (path: string) => folders[path] !== undefined;

    return { expanded, loadFolder, refresh, setFolderOpen, rows, entryRows, isListed };
}
