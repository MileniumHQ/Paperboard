// PaperFileView over a folder tree kept in memory, driven from window.t.
import { createSignal, type JSX } from "solid-js";
import {
    PaperFileView,
    PaperProvider,
    type PaperFileViewEntry,
    type PaperFileViewMode,
    type PaperFileViewRef,
    type PaperFileViewSort,
} from "@mileniumhq/paperui";

const query = new URLSearchParams(location.search);
const shell = (content: () => JSX.Element) => (
    <PaperProvider fullScreen theme={query.get("theme") === "dark" ? "dark" : "light"}>
        {content()}
    </PaperProvider>
);

const DAY = 86_400_000;
const file = (path: string, size: number, age = 1): PaperFileViewEntry => ({
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    kind: "file",
    size,
    modified: Date.UTC(2026, 0, 1) - age * DAY,
});
const folder = (path: string, count: number): PaperFileViewEntry => ({ name: path.slice(path.lastIndexOf("/") + 1), path, kind: "folder", count, modified: Date.UTC(2026, 0, 1) });

const TREE: Record<string, PaperFileViewEntry[]> = {
    "": [file("notes.md", 2_000, 3), folder("Photos", 2), file("budget.csv", 90_000, 1), folder("Archive", 0), file("trip.mp4", 40_000_000, 2)],
    Photos: [file("Photos/beach.png", 5_000), file("Photos/dunes.png", 6_000)],
    Archive: [],
    Many: Array.from({ length: 300 }, (_, i) => file(`Many/photo ${i + 1}.png`, 1_000 + i)),
};

export const scenarios: Record<string, () => JSX.Element> = {
    fileView() {
        const [folderShown, setFolder] = createSignal(query.get("folder") ?? "");
        const [mode, setMode] = createSignal<PaperFileViewMode>((query.get("mode") as PaperFileViewMode) ?? "icons");
        const [selection, setSelection] = createSignal<string[]>([]);
        const [sort, setSort] = createSignal<PaperFileViewSort>({ key: "name", dir: 1 });
        let view: PaperFileViewRef | undefined;
        let failing = query.get("fail") === "1";
        const t = (window.t = {
            opened: [] as string[],
            looked: [] as string[],
            renamed: [] as string[],
            deleted: [] as string[][],
            drops: [] as unknown[],
            menus: [] as (string | null)[],
            thumbnails: [] as string[],
            selection,
            setMode,
            setFolder,
            heal: () => {
                failing = false;
            },
            order: () => view?.entries().map((e) => e.path),
            /** fires a drag of `from` (a path in the view) onto `to`, as the browser does */
            dragOnto: (from: string, to: string) => {
                const data = new DataTransfer();
                const at = (path: string) => document.querySelector(`[data-path="${path}"]`)!;
                at(from).dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }));
                for (const type of ["dragenter", "dragover", "drop"]) at(to).dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
                at(from).dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: data }));
            },
            /** drops a file from the computer onto `to`, a path or "" for the view's empty space */
            dropFile: (to: string) => {
                const data = new DataTransfer();
                data.items.add(new File(["hello"], "hello.txt", { type: "text/plain" }));
                const target = to ? document.querySelector(`[data-path="${to}"]`)! : document.querySelector('[role="listbox"], [role="treegrid"]')!;
                for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
            },
        });
        return shell(() => (
            <div style={{ display: "flex", width: "800px", height: "500px" }}>
                <PaperFileView
                    aria-label="Files"
                    folder={folderShown()}
                    list={async (f) => {
                        if (failing) throw new Error("the disk is asleep");
                        const entries = TREE[f];
                        if (!entries) throw new Error(`no folder ${f}`);
                        return entries;
                    }}
                    mode={mode()}
                    selection={selection()}
                    onSelectionChange={setSelection}
                    onOpen={(entry) => {
                        t.opened.push(entry.path);
                        if (entry.kind === "folder") setFolder(entry.path);
                    }}
                    onQuickLook={(entry) => t.looked.push(entry.path)}
                    onRename={(entry, name) => void t.renamed.push(`${entry.path} -> ${name}`)}
                    onDelete={(entries) => t.deleted.push(entries.map((e) => e.path))}
                    onDrop={(drop) => t.drops.push(drop.kind === "files" ? { kind: "files", folder: drop.folder, names: drop.files.map((f) => f.name) } : drop)}
                    onContextMenu={(_, entry) => t.menus.push(entry?.path ?? null)}
                    thumbnail={async (entry) => {
                        t.thumbnails.push(entry.path);
                        if (!entry.name.endsWith(".png")) return null;
                        return (await fetch("/files/photo.png")).blob();
                    }}
                    sort={sort()}
                    onSortChange={setSort}
                    ref={(v) => (view = v)}
                />
            </div>
        ));
    },
};
