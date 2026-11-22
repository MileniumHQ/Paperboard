// Drive: one screen. A thin bar with where you are and what you can do, and
// the files filling the rest. Folders open in place; a file opens in a
// preview over the page, Space looks at it quickly, and arrows move to the
// next one while it's open.
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import {
    ancestorPaths,
    createPaperFileViewDropTarget,
    PaperButton,
    PaperContextMenu,
    PaperContextMenuHeader,
    PaperContextMenuItem,
    PaperEmptyState,
    PaperFileView,
    PaperFlex,
    PaperIcon,
    PaperModal,
    PaperPreviewModal,
    PaperProgress,
    PaperText,
    paperPreviewThumbnail,
    previewKind,
    showError,
    showToast,
    formatByteProgress,
    useContextMenuState,
    type PaperFileViewDrop,
    type PaperFileViewEntry,
    type PaperFileViewMode,
    type PaperFileViewRef,
    type PaperFileViewSort,
    type PaperFileViewThumbnailOptions,
} from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import { fileApi } from "@mileniumhq/paperapi";
import { drive } from "./client";
import { baseOf, DRIVE_FOLDER, PANEL_ID, parentOf, type DriveEntry } from "./lib/contract";
import { createFiles, mediaType, PREVIEW_MAX_BYTES, THUMBNAIL_MAX_BYTES } from "./lib/files";
import { createUploads } from "./lib/uploads";
import styles from "./App.module.css";

const ROOT = "Drive";
const MODE_KEY = "drive:view";
// a thumbnail this small (in CSS pixels) is a list row's
const SMALL_THUMBNAIL = 40;
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const mod = (e: KeyboardEvent) => (isMac() ? e.metaKey : e.ctrlKey);
const keyName = (key: string) => (isMac() ? `⌘${key}` : `Ctrl+${key}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// the view lists what the service gave it, so its entries are the service's
const asDrive = (entry: PaperFileViewEntry) => entry as DriveEntry;

function savedMode(): PaperFileViewMode {
    try {
        return localStorage.getItem(MODE_KEY) === "list" ? "list" : "icons";
    } catch (err) {
        // quiet: a page without storage starts in icons, as a new one does
        console.warn("[drive] the view mode couldn't be read:", err);
        return "icons";
    }
}

export default function App() {
    const files = createFiles(drive.calls);
    let view: PaperFileViewRef | undefined;
    let uploadInput!: HTMLInputElement;

    // ---------- where, and how ----------
    const [folder, setFolder] = createSignal("");
    const [mode, setMode] = createSignal<PaperFileViewMode>(savedMode());
    const [sort, setSort] = createSignal<PaperFileViewSort>({ key: "name", dir: 1 });
    const [selection, setSelection] = createSignal<string[]>([]);
    createEffect(
        on(mode, (m) => {
            try {
                localStorage.setItem(MODE_KEY, m);
            } catch (err) {
                // quiet: the view still switches; only the next visit forgets it
                console.warn("[drive] the view mode couldn't be saved:", err);
            }
        }, { defer: true }),
    );

    function go(to: string, select: string[] = []) {
        batch(() => {
            setFolder(to);
            setSelection(select);
        });
    }
    const goUp = () => {
        if (folder() === "") return;
        go(parentOf(folder()), [folder()]);
    };

    const chosen = () => selection().map((p) => view?.entry(p)).filter((e): e is PaperFileViewEntry => !!e);

    // ---------- other windows and flows change files too ----------
    onMount(() => {
        const off = drive.events.changed(({ folders }) => {
            for (const f of folders) void view?.reload(f);
        });
        onCleanup(off);
    });

    // ---------- the preview ----------
    type Look = { entry: DriveEntry; src?: string; error?: string; tooBig: boolean };
    const [look, setLook] = createSignal<Look | null>(null);
    let lookToken = 0;
    let releaseLook = () => {};
    async function preview(entry: DriveEntry) {
        const token = ++lookToken;
        releaseLook();
        releaseLook = () => {};
        const tooBig = entry.size > PREVIEW_MAX_BYTES;
        setLook({ entry, tooBig });
        // a file this big is a card with Download: reading it whole would fill the page's memory
        if (tooBig || !previewKind(entry.name)) return;
        const held = files.hold(entry);
        releaseLook = held.release;
        try {
            const src = await held.url;
            if (token === lookToken) setLook({ entry, src, tooBig });
        } catch (err) {
            if (token === lookToken) setLook({ entry, error: `“${entry.name}” couldn't be read: ${err instanceof Error ? err.message : String(err)}`, tooBig });
        }
    }
    // a closed preview still shows its file while it fades: that file is let go once it has left
    let releaseLeaving = () => {};
    const closeLook = () => {
        lookToken++;
        releaseLeaving();
        releaseLeaving = releaseLook;
        releaseLook = () => {};
        setLook(null);
        view?.focus();
    };
    onCleanup(() => {
        releaseLook();
        releaseLeaving();
    });
    // the preview follows the choice as arrows move it
    createEffect(
        on(selection, (paths) => {
            const shown = look();
            if (!shown || paths.length !== 1 || paths[0] === shown.entry.path) return;
            const entry = view?.entry(paths[0]);
            if (entry?.kind === "file") void preview(asDrive(entry));
        }),
    );
    // arrows under the preview walk the files beside it; Space closes it, as it opened it
    const onLookKeys = (e: KeyboardEvent) => {
        if (!look() || e.defaultPrevented) return;
        if (e.key === " " && !(e.target as HTMLElement).closest("input, textarea, video, audio")) {
            e.preventDefault();
            e.stopPropagation();
            return closeLook();
        }
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        if ((e.target as HTMLElement).closest("input, textarea, video, audio, [role=slider]")) return;
        e.preventDefault();
        e.stopPropagation();
        view?.step(e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1);
    };
    window.addEventListener("keydown", onLookKeys, true);
    onCleanup(() => window.removeEventListener("keydown", onLookKeys, true));

    const open = (entry: PaperFileViewEntry) => (entry.kind === "folder" ? go(entry.path) : void preview(asDrive(entry)));

    // ---------- thumbnails, for files near the screen ----------
    async function thumbnail(entry: PaperFileViewEntry, options: PaperFileViewThumbnailOptions): Promise<Blob | null> {
        const kind = previewKind(entry.name);
        const size = entry.size ?? 0;
        if (!kind || size === 0 || size > THUMBNAIL_MAX_BYTES) return null;
        // a page of text, shrunk to a list row's icon, is a blank square: its symbol says more
        if (options.edge <= SMALL_THUMBNAIL && kind !== "image" && kind !== "video" && kind !== "model") return null;
        const held = files.hold(asDrive(entry), options.signal);
        try {
            const src = await held.url;
            return await paperPreviewThumbnail({ src, name: entry.name, type: mediaType(entry.name), kind }, { size: options.size, signal: options.signal });
        } finally {
            held.release();
        }
    }

    // ---------- changing files ----------
    async function download(entry: PaperFileViewEntry) {
        try {
            const result = await fileApi.exportFile(`${DRIVE_FOLDER}/${entry.path}`, PANEL_ID, { suggestedName: entry.name });
            if (result.status === "exported") showToast({ title: `Downloaded “${entry.name}”`, icon: "download", variant: "success" });
        } catch (err) {
            showError(`Couldn't download “${entry.name}”`, err);
        }
    }

    async function rename(entry: PaperFileViewEntry, name: string) {
        try {
            const renamed = await drive.calls.rename({ path: entry.path, name });
            await view?.reload(parentOf(entry.path));
            setSelection([renamed.path]);
        } catch (err) {
            showError(`Couldn't rename “${entry.name}”`, err);
        }
    }

    async function newFolder() {
        const taken = new Set((view?.entries() ?? []).filter((e) => parentOf(e.path) === folder()).map((e) => e.name));
        let name = "New folder";
        for (let n = 2; taken.has(name); n++) name = `New folder ${n}`;
        try {
            const made = await drive.calls.createFolder({ folder: folder(), name });
            await view?.reload(folder());
            setSelection([made.path]);
            view?.rename(made.path);
        } catch (err) {
            showError("Couldn't make a folder", err);
        }
    }

    // deleting is for good, so it's asked first
    const [deleting, setDeleting] = createSignal<PaperFileViewEntry[]>([]);
    const askDelete = (entries: PaperFileViewEntry[]) => entries.length && setDeleting(entries);
    async function confirmDelete() {
        const entries = deleting();
        setDeleting([]);
        try {
            await drive.calls.delete({ paths: entries.map((e) => e.path) });
            setSelection([]);
            await Promise.all([...new Set(entries.map((e) => parentOf(e.path)))].map((f) => view?.reload(f)));
        } catch (err) {
            showError(entries.length === 1 ? `Couldn't delete “${entries[0].name}”` : `Couldn't delete ${entries.length} items`, err);
            await view?.reload();
        }
        view?.focus();
    }
    const deleteTitle = () => (deleting().length === 1 ? `Delete “${deleting()[0].name}”?` : `Delete ${deleting().length} items?`);
    const deleteText = () => {
        const entries = deleting();
        const folders = entries.filter((e) => e.kind === "folder").length;
        const what = entries.length === 1 ? (folders ? "This folder and everything in it" : "This file") : folders ? "These items, and everything in their folders," : "These files";
        return `${what} will be deleted for good. This can't be undone.`;
    };

    // ---------- uploads ----------
    const uploads = createUploads(files, {
        landed: (entry) => void view?.reload(parentOf(entry.path)),
        failed: (name, err) => showError(`Couldn't upload “${name}”`, err),
        finished: (landed) => {
            if (landed > 0) showToast({ title: landed === 1 ? "Uploaded 1 file" : `Uploaded ${landed} files`, icon: "cloud_done", variant: "success" });
        },
    });
    const uploadTotals = createMemo(() => {
        const jobs = uploads.jobs();
        return { count: jobs.length, sent: jobs.reduce((n, j) => n + j.sent, 0), size: jobs.reduce((n, j) => n + j.size, 0), first: jobs[0]?.name ?? "" };
    });

    async function drop(d: PaperFileViewDrop) {
        if (d.kind === "files") return uploads.add(d.files, d.folder);
        try {
            const moved = await drive.calls.move({ paths: d.paths, folder: d.folder });
            await Promise.all([d.folder, ...d.paths.map(parentOf)].filter((f, i, all) => all.indexOf(f) === i).map((f) => view?.reload(f)));
            if (d.folder === folder()) setSelection(moved.map((e) => e.path));
        } catch (err) {
            showError(d.paths.length === 1 ? `Couldn't move “${baseOf(d.paths[0])}”` : `Couldn't move ${d.paths.length} items`, err);
        }
    }
    const crumbDrop = createPaperFileViewDropTarget((d) => void drop(d));

    // ---------- keys the panel keeps: the view takes the ones that move through files ----------
    function onKeyDown(e: KeyboardEvent) {
        if (e.defaultPrevented || (e.target as HTMLElement).closest("input, textarea")) return;
        if (mod(e) && e.shiftKey && e.key.toLowerCase() === "n") {
            e.preventDefault();
            return void newFolder();
        }
        if ((e.key === "ArrowUp" && (mod(e) || e.altKey)) || (e.key === "Backspace" && !e.metaKey && !e.ctrlKey)) {
            e.preventDefault();
            goUp();
        }
    }

    // ---------- the context menu ----------
    const menu = useContextMenuState();
    const [menuOn, setMenuOn] = createSignal<PaperFileViewEntry[]>([]);
    const menuEntry = () => (menuOn().length === 1 ? menuOn()[0] : null);

    const crumbs = createMemo(() => ["", ...ancestorPaths(folder())]);
    const title = () => (folder() === "" ? ROOT : baseOf(folder()));

    return (
        <PaperFlex direction="column" fullWidth fullHeight minHeight={0} class={styles.app} onKeyDown={onKeyDown}>
            <PaperFlex direction="row" align="center" gap="half" class={styles.bar}>
                <PaperButton icon variant="text" size="small" class={styles.up} aria-label="Enclosing folder" title="Enclosing folder" disabled={folder() === ""} onClick={goUp}>
                    chevron_left
                </PaperButton>
                <nav class={styles.crumbs} aria-label="Folder path">
                    <For each={crumbs()}>
                        {(crumb, i) => (
                            <>
                                <Show when={i() > 0}>
                                    <PaperIcon class={styles.crumbSep} aria-hidden="true">
                                        chevron_right
                                    </PaperIcon>
                                </Show>
                                <PaperButton
                                    variant="text"
                                    size="small"
                                    class={styles.crumb}
                                    classList={{ [styles.current]: crumb === folder(), [styles.dropHere]: crumbDrop.over() === crumb }}
                                    aria-current={crumb === folder() ? "location" : undefined}
                                    onClick={() => crumb !== folder() && go(crumb, folder().startsWith(`${crumb}/`) || crumb === "" ? [crumbs()[i() + 1]] : [])}
                                    {...crumbDrop.handlers(crumb)}
                                >
                                    {crumb === "" ? ROOT : baseOf(crumb)}
                                </PaperButton>
                            </>
                        )}
                    </For>
                </nav>
                <PaperText preset="label" truncate class={styles.title}>
                    {title()}
                </PaperText>
                <PaperFlex direction="row" align="center" gap="none" class={styles.modes} role="group" aria-label="View">
                    <PaperButton
                        icon
                        size="small"
                        variant={mode() === "icons" ? undefined : "text"}
                        aria-pressed={mode() === "icons"}
                        aria-label="As icons"
                        title="As icons"
                        onClick={() => setMode("icons")}
                    >
                        grid_view
                    </PaperButton>
                    <PaperButton
                        icon
                        size="small"
                        variant={mode() === "list" ? undefined : "text"}
                        aria-pressed={mode() === "list"}
                        aria-label="As list"
                        title="As list"
                        onClick={() => setMode("list")}
                    >
                        view_list
                    </PaperButton>
                </PaperFlex>
                <PaperButton icon variant="text" size="small" aria-label="New folder" title={`New folder (${keyName("Shift+N")})`} onClick={() => void newFolder()}>
                    create_new_folder
                </PaperButton>
                <PaperButton variant="primary" size="small" aria-label="Upload" onClick={() => uploadInput.click()}>
                    <PaperIcon zeroHeight>upload</PaperIcon>
                    <span class={styles.wideOnly}>Upload</span>
                </PaperButton>
            </PaperFlex>

            <PaperFlex direction="column" flex minHeight={0}>
                <PaperFileView
                    aria-label={title()}
                    folder={folder()}
                    list={(f) => drive.calls.list({ folder: f })}
                    mode={mode()}
                    selection={selection()}
                    onSelectionChange={setSelection}
                    onOpen={open}
                    onQuickLook={(entry) => (look() ? closeLook() : entry.kind === "file" ? void preview(asDrive(entry)) : undefined)}
                    onRename={rename}
                    onDelete={askDelete}
                    onDrop={(d) => void drop(d)}
                    onContextMenu={(e, entry) => {
                        setMenuOn(entry ? chosen() : []);
                        menu.openAtMouse(e);
                    }}
                    thumbnail={thumbnail}
                    sort={sort()}
                    onSortChange={setSort}
                    empty={
                        <PaperEmptyState
                            icon="cloud_upload"
                            title={folder() === "" ? "Your drive is empty" : "This folder is empty"}
                            description="Drop files here, or press Upload."
                        >
                            <PaperButton variant="primary" onClick={() => uploadInput.click()}>
                                <PaperIcon zeroHeight>upload</PaperIcon>
                                Upload
                            </PaperButton>
                        </PaperEmptyState>
                    }
                    ref={(v) => (view = v)}
                />
            </PaperFlex>

            <Show when={uploadTotals().count > 0}>
                <PaperFlex direction="row" align="center" gap="full" class={styles.uploads} role="status">
                    <PaperIcon class={styles.uploadsIcon}>upload</PaperIcon>
                    <PaperFlex direction="column" gap="onefourth" flex minWidth={0}>
                        <PaperText preset="label" truncate>
                            {uploadTotals().count === 1 ? `Uploading “${uploadTotals().first}”` : `Uploading ${plural(uploadTotals().count, "file", "files")}`}
                        </PaperText>
                        <PaperProgress value={uploadTotals().size ? uploadTotals().sent : undefined} max={uploadTotals().size || undefined} />
                    </PaperFlex>
                    <Show when={uploadTotals().size > 0}>
                        <PaperText preset="caption" color="text-muted" class={styles.wideOnly}>
                            {formatByteProgress(uploadTotals().sent, uploadTotals().size)}
                        </PaperText>
                    </Show>
                    <PaperButton size="small" variant="text" onClick={() => uploads.cancel()}>
                        Cancel
                    </PaperButton>
                </PaperFlex>
            </Show>

            <input
                ref={uploadInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                    uploads.add([...(e.currentTarget.files ?? [])], folder());
                    e.currentTarget.value = "";
                }}
            />

            <PaperContextMenu open={menu.isOpen()} target={menu.target()} placement={menu.placement()} onClose={menu.close}>
                <Show
                    when={menuOn().length}
                    fallback={
                        <>
                            <PaperContextMenuItem icon="create_new_folder" keybind={keyName("Shift+N")} onClick={() => void newFolder()}>
                                New folder
                            </PaperContextMenuItem>
                            <PaperContextMenuItem icon="upload" onClick={() => uploadInput.click()}>
                                Upload files…
                            </PaperContextMenuItem>
                        </>
                    }
                >
                    <PaperContextMenuHeader>{menuEntry()?.name ?? `${menuOn().length} items`}</PaperContextMenuHeader>
                    <Show when={menuEntry()}>
                        {(entry) => (
                            <>
                                <PaperContextMenuItem icon={entry().kind === "folder" ? "folder_open" : "visibility"} keybind="Enter" onClick={() => open(entry())}>
                                    Open
                                </PaperContextMenuItem>
                                <Show when={entry().kind === "file"}>
                                    <PaperContextMenuItem icon="download" onClick={() => void download(entry())}>
                                        Download
                                    </PaperContextMenuItem>
                                </Show>
                                <PaperContextMenuItem icon="edit" keybind="F2" onClick={() => view?.rename(entry().path)}>
                                    Rename
                                </PaperContextMenuItem>
                            </>
                        )}
                    </Show>
                    <PaperContextMenuItem icon="delete" danger keybind={isMac() ? "⌘⌫" : "Delete"} onClick={() => askDelete(menuOn())}>
                        Delete
                    </PaperContextMenuItem>
                </Show>
            </PaperContextMenu>

            <PaperModal
                open={deleting().length > 0}
                onClose={() => setDeleting([])}
                title={deleteTitle()}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => setDeleting([])}>
                            Cancel
                        </PaperButton>
                        <PaperButton variant="danger" autofocus onClick={() => void confirmDelete()}>
                            Delete
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="body">{deleteText()}</PaperText>
            </PaperModal>

            <PaperPreviewModal
                open={look() !== null}
                name={look()?.entry.name ?? ""}
                src={look()?.src}
                type={look() ? mediaType(look()!.entry.name) : undefined}
                kind={look()?.tooBig ? null : undefined}
                size={look()?.entry.size}
                error={look()?.error}
                onClose={closeLook}
                onExited={() => {
                    releaseLeaving();
                    releaseLeaving = () => {};
                }}
                actions={
                    <PaperButton size="small" onClick={() => look() && void download(look()!.entry)}>
                        <PaperIcon zeroHeight>download</PaperIcon>
                        Download
                    </PaperButton>
                }
            />
        </PaperFlex>
    );
}
