import styles from "./index.module.css";
import {
    batch,
    createEffect,
    createMemo,
    createSignal,
    For,
    Match,
    on,
    onMount,
    Show,
    Switch,
} from "solid-js";
import { createStore } from "solid-js/store";
import { PaperButton } from "../../components/PaperButton";
import { PaperContextMenu, PaperContextMenuItem, useContextMenuState } from "../../components/PaperContextMenu";
import { PaperEditor, type PaperEditorPosition } from "../../components/PaperEditor";
import { PaperEmptyState } from "../../components/PaperEmptyState";
import { PaperIcon } from "../../components/PaperIcon";
import { PaperLoader } from "../../components/PaperLoader";
import { PaperModal } from "../../components/PaperModal";
import { PaperSplit } from "../PaperSplit";
import { copyText } from "../../utils/clipboard";
import {
    PAPER_FILE_BROWSER_ICONS as ICONS,
    ancestorPaths,
    baseName,
    paperFileIcon,
    paperFileLanguage,
    parentPath,
} from "./files";

export {
    PAPER_FILE_BROWSER_ICONS,
    paperFileIcon,
    paperFileLanguage,
    ancestorPaths,
    parentPath,
    baseName,
    type PaperFileBrowserIcon,
    type PaperFileLanguage,
} from "./files";

export interface PaperFileEntry {
    name: string;
    /** "/"-joined path from the browser's root ("" is the root itself) */
    path: string;
    kind: "file" | "folder";
    size?: number;
}

export interface PaperFileListing {
    entries: PaperFileEntry[];
    /** shown under the folder's entries, e.g. "Showing the first 500 of 1,204" */
    note?: string;
}

export type PaperFileContent =
    | {
          kind: "text";
          text: string;
          /** opaque token handed back to `write`, so a save can refuse a file that changed */
          version?: string;
          /** Prism language id; defaults to one picked from the extension */
          language?: string;
          /** set to say why this file opens read-only */
          readOnly?: string;
      }
    | { kind: "image"; src: string; alt?: string }
    | { kind: "unavailable"; reason: string };

export interface PaperFileSaveResult {
    version?: string;
    /** shown after saving, e.g. when the change takes effect */
    message?: string;
}

export interface PaperFileReveal {
    path: string;
    kind: "file" | "folder";
}

export interface PaperFileBrowserProps {
    /** names the root folder in the tree and the breadcrumb */
    rootLabel: string;
    list: (path: string) => Promise<PaperFileListing>;
    read: (path: string) => Promise<PaperFileContent>;
    /** omit for a read-only browser */
    write?: (path: string, text: string, version: string | undefined) => Promise<PaperFileSaveResult>;
    /**
     * Opens the tree to this path (and opens it, for a file). A new object
     * reveals again, so callers can repeat the same path.
     */
    reveal?: PaperFileReveal | null;
    /** syntax highlighting in the editor (default true) */
    highlight?: boolean;
    /** the editor's ⋮ file menu (default true) */
    fileMenu?: boolean;
    sideWidth?: number | string;
    class?: string;
}

type FolderState =
    | { status: "loading" }
    | { status: "ready"; entries: PaperFileEntry[]; note?: string }
    | { status: "error"; message: string };

type Row =
    | { type: "entry"; entry: PaperFileEntry; depth: number; setSize: number; position: number }
    | { type: "status"; folder: string; depth: number; state: "loading" | "error" | "empty" | "note"; message: string };

type DocState =
    | { status: "idle" }
    | { status: "loading"; path: string }
    | { status: "error"; path: string; message: string }
    | { status: "ready"; path: string; content: PaperFileContent };

interface Notice {
    tone: "success" | "danger";
    text: string;
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function rowSelector(path: string): string {
    const escaped =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(path)
            : path.replace(/["\\]/g, "\\$&");
    return `[data-path="${escaped}"]`;
}

function Icon(props: { name: string; class?: string }) {
    return (
        <PaperIcon class={props.class} aria-hidden="true">
            {props.name}
        </PaperIcon>
    );
}

/**
 * A small file explorer: a lazy folder tree beside a viewer that edits text
 * files (PaperEditor), previews images, and explains what it cannot show.
 * It owns no data: `list`, `read` and `write` reach whatever owns the files,
 * and that owner validates every path.
 */
export function PaperFileBrowser(props: PaperFileBrowserProps) {
    let treeRef: HTMLDivElement | undefined;
    const [folders, setFolders] = createStore<Record<string, FolderState>>({});
    const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set([""]));
    const [selected, setSelected] = createSignal<string | null>(null);
    const [focused, setFocused] = createSignal<string>("");

    const [doc, setDoc] = createSignal<DocState>({ status: "idle" });
    const [buffer, setBuffer] = createSignal("");
    const [savedText, setSavedText] = createSignal("");
    const [version, setVersion] = createSignal<string | undefined>(undefined);
    const [saving, setSaving] = createSignal(false);
    const [notice, setNotice] = createSignal<Notice | null>(null);
    const [cursor, setCursor] = createSignal<PaperEditorPosition>({ line: 1, column: 1 });
    const [wrap, setWrap] = createSignal(false);
    const [lineNumbers, setLineNumbers] = createSignal(true);
    const [pending, setPending] = createSignal<{ name: string; run: () => void } | null>(null);
    const [collapsed, setCollapsed] = createSignal(false);
    const menu = useContextMenuState("below-right");

    // ─── folders ──────────────────────────────────────────────────────

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
                const listing = await props.list(path);
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

    onMount(() => void loadFolder(""));

    // rows keep their identity while they are unchanged, so expanding one
    // folder does not rebuild (and drop focus from) every other row
    let rowCache = new Map<string, Row>();
    const sameRow = (a: Row, b: Row): boolean => {
        if (a.type === "entry" && b.type === "entry") {
            return a.entry === b.entry && a.depth === b.depth && a.setSize === b.setSize && a.position === b.position;
        }
        if (a.type === "status" && b.type === "status") {
            return a.folder === b.folder && a.depth === b.depth && a.state === b.state && a.message === b.message;
        }
        return false;
    };

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

    // ─── the open file ────────────────────────────────────────────────

    const openPath = () => {
        const state = doc();
        return state.status === "idle" ? null : state.path;
    };
    const textContent = () => {
        const state = doc();
        return state.status === "ready" && state.content.kind === "text" ? state.content : null;
    };
    const readOnlyReason = () => {
        const content = textContent();
        if (!content) return null;
        if (content.readOnly) return content.readOnly;
        if (!props.write) return "This browser is read-only";
        return null;
    };
    const editable = () => textContent() !== null && readOnlyReason() === null;
    const dirty = () => textContent() !== null && buffer() !== savedText();
    const language = () => {
        const path = openPath();
        const fallback = path ? paperFileLanguage(baseName(path)) : { label: "Plain text" };
        const id = textContent()?.language ?? fallback.id;
        return { id, label: fallback.label };
    };

    let readToken = 0;
    const load = async (path: string) => {
        const token = ++readToken;
        batch(() => {
            setDoc({ status: "loading", path });
            setNotice(null);
        });
        try {
            const content = await props.read(path);
            if (token !== readToken) return;
            batch(() => {
                setDoc({ status: "ready", path, content });
                const text = content.kind === "text" ? content.text : "";
                setBuffer(text);
                setSavedText(text);
                setVersion(content.kind === "text" ? content.version : undefined);
                setCursor({ line: 1, column: 1 });
            });
        } catch (err) {
            if (token !== readToken) return;
            setDoc({ status: "error", path, message: messageOf(err) });
        }
    };

    /** runs `action` now, or after the user decides what happens to unsaved edits */
    const guard = (action: () => void) => {
        const path = openPath();
        if (!dirty() || !path) return action();
        setPending({ name: baseName(path), run: action });
    };

    const openFile = (path: string) => {
        setSelected(path);
        if (openPath() === path && doc().status !== "error") return;
        guard(() => void load(path));
    };

    const closeFile = () =>
        guard(() => {
            readToken++;
            setDoc({ status: "idle" });
            setNotice(null);
        });

    const save = async (): Promise<boolean> => {
        const path = openPath();
        if (!path || !props.write || !editable() || saving()) return false;
        const text = buffer();
        setSaving(true);
        setNotice(null);
        try {
            const result = await props.write(path, text, version());
            if (openPath() !== path) return true;
            batch(() => {
                setSavedText(text);
                setVersion(result.version);
                setNotice({ tone: "success", text: result.message ?? "Saved" });
            });
            return true;
        } catch (err) {
            if (openPath() === path) setNotice({ tone: "danger", text: messageOf(err) });
            return false;
        } finally {
            setSaving(false);
        }
    };

    const revert = () => {
        setBuffer(savedText());
        setNotice(null);
    };

    const reloadFromDisk = () => {
        const path = openPath();
        if (path) guard(() => void load(path));
    };

    // ─── reveal ───────────────────────────────────────────────────────

    const focusRow = (path: string) => {
        setFocused(path);
        requestAnimationFrame(() => {
            const row = treeRef?.querySelector<HTMLElement>(rowSelector(path));
            row?.focus({ preventScroll: true });
            row?.scrollIntoView?.({ block: "nearest" });
        });
    };

    const reveal = async (target: PaperFileReveal) => {
        const folder = target.kind === "folder" ? target.path : parentPath(target.path);
        await loadFolder("");
        for (const path of ancestorPaths(folder)) {
            setFolderOpen(path, true);
            await loadFolder(path);
        }
        setSelected(target.path);
        setFocused(target.path);
        requestAnimationFrame(() => {
            treeRef
                ?.querySelector<HTMLElement>(rowSelector(target.path))
                ?.scrollIntoView?.({ block: "nearest" });
        });
        if (target.kind === "file") openFile(target.path);
    };

    createEffect(
        on(
            () => props.reveal,
            (target) => {
                if (target) void reveal(target);
            },
        ),
    );

    // ─── tree keyboard ────────────────────────────────────────────────

    const entryRows = () => rows().filter((row): row is Extract<Row, { type: "entry" }> => row.type === "entry");

    const activate = (entry: PaperFileEntry) => {
        if (entry.kind === "folder") {
            setSelected(entry.path);
            setFolderOpen(entry.path, !expanded().has(entry.path));
        } else openFile(entry.path);
    };

    const onTreeKeyDown = (e: KeyboardEvent) => {
        const list = entryRows();
        if (list.length === 0) return;
        const index = Math.max(0, list.findIndex((row) => row.entry.path === focused()));
        const current = list[index]!;
        const move = (to: number) => {
            e.preventDefault();
            const row = list[Math.min(Math.max(to, 0), list.length - 1)];
            if (row) focusRow(row.entry.path);
        };
        switch (e.key) {
            case "ArrowDown":
                return move(index + 1);
            case "ArrowUp":
                return move(index - 1);
            case "Home":
                return move(0);
            case "End":
                return move(list.length - 1);
            case "ArrowRight":
                e.preventDefault();
                if (current.entry.kind !== "folder") return;
                if (!expanded().has(current.entry.path)) setFolderOpen(current.entry.path, true);
                else if (list[index + 1]?.depth === current.depth + 1) move(index + 1);
                return;
            case "ArrowLeft": {
                e.preventDefault();
                if (current.entry.kind === "folder" && expanded().has(current.entry.path)) {
                    setFolderOpen(current.entry.path, false);
                    return;
                }
                const parent = parentPath(current.entry.path);
                if (parent) focusRow(parent);
                return;
            }
            case "Enter":
            case " ":
                e.preventDefault();
                activate(current.entry);
                return;
        }
    };

    // the roving tab stop must sit on a row that exists
    createEffect(() => {
        const list = entryRows();
        if (list.length > 0 && !list.some((row) => row.entry.path === focused())) {
            setFocused(list[0]!.entry.path);
        }
    });

    // ─── render ───────────────────────────────────────────────────────

    const crumbs = () => {
        const path = openPath() ?? selected() ?? "";
        return [props.rootLabel, ...(path ? path.split("/") : [])];
    };

    const tree = (
        <div class={styles.treePane}>
            <div class={styles.treeHeader}>
                <span class={styles.treeTitle}>
                    <Icon name={ICONS.folder} class={styles.treeTitleIcon} />
                    {props.rootLabel}
                </span>
                <PaperButton size="tiny" icon variant="text" aria-label="Refresh files" title="Refresh files" onClick={refresh}>
                    <Icon name={ICONS.refresh} />
                </PaperButton>
            </div>
            <div
                ref={treeRef}
                class={styles.tree}
                role="tree"
                aria-label={`${props.rootLabel} files`}
                onKeyDown={onTreeKeyDown}
            >
                <For each={rows()}>
                    {(row) => (
                        <Switch>
                            <Match when={row.type === "entry" && row}>
                                {(entryRow) => {
                                    const entry = () => entryRow().entry;
                                    const isFolder = () => entry().kind === "folder";
                                    const isOpen = () => isFolder() && expanded().has(entry().path);
                                    return (
                                        <div
                                            class={styles.row}
                                            classList={{ [styles.selected]: selected() === entry().path }}
                                            role="treeitem"
                                            data-path={entry().path}
                                            aria-level={entryRow().depth}
                                            aria-setsize={entryRow().setSize}
                                            aria-posinset={entryRow().position}
                                            aria-expanded={isFolder() ? isOpen() : undefined}
                                            aria-selected={selected() === entry().path}
                                            tabIndex={focused() === entry().path ? 0 : -1}
                                            style={{ "--paper-file-depth": String(entryRow().depth - 1) }}
                                            onClick={() => {
                                                setFocused(entry().path);
                                                activate(entry());
                                            }}
                                            onFocus={() => setFocused(entry().path)}
                                        >
                                            <span class={styles.chevron} classList={{ [styles.chevronOpen]: isOpen() }}>
                                                <Show when={isFolder()}>
                                                    <Icon name={ICONS.expand} />
                                                </Show>
                                            </span>
                                            <Icon
                                                name={paperFileIcon(entry().name, entry().kind, isOpen())}
                                                class={isFolder() ? styles.folderIcon : styles.fileIcon}
                                            />
                                            <span class={styles.rowName}>{entry().name}</span>
                                            <Show when={openPath() === entry().path && dirty()}>
                                                <span class={styles.dirtyDot} aria-label="Unsaved changes" role="img" />
                                            </Show>
                                        </div>
                                    );
                                }}
                            </Match>
                            <Match when={row.type === "status" && row}>
                                {(statusRow) => (
                                    <div
                                        class={styles.statusRow}
                                        classList={{ [styles.statusError]: statusRow().state === "error" }}
                                        role="none"
                                        style={{ "--paper-file-depth": String(statusRow().depth - 1) }}
                                    >
                                        <Show when={statusRow().state === "loading"}>
                                            <PaperLoader size="small" loaderStatus="indeterminate" />
                                        </Show>
                                        <Show when={statusRow().state === "error"}>
                                            <Icon name={ICONS.error} />
                                        </Show>
                                        <Show when={statusRow().state === "empty"}>
                                            <Icon name={ICONS.emptyFolder} />
                                        </Show>
                                        <span class={styles.statusText} role={statusRow().state === "error" ? "alert" : undefined}>
                                            {statusRow().message}
                                        </span>
                                        <Show when={statusRow().state === "error"}>
                                            <PaperButton size="tiny" variant="text" onClick={() => void loadFolder(statusRow().folder, true)}>
                                                Retry
                                            </PaperButton>
                                        </Show>
                                    </div>
                                )}
                            </Match>
                        </Switch>
                    )}
                </For>
            </div>
        </div>
    );

    const viewer = (
        <section class={styles.viewer} classList={{ [styles.viewerInModal]: collapsed() }} aria-label="File">
            <header class={styles.toolbar}>
                <nav class={styles.crumbs} aria-label="Path">
                    <For each={crumbs()}>
                        {(crumb, i) => (
                            <>
                                <Show when={i() > 0}>
                                    <span class={styles.crumbSeparator} aria-hidden="true">
                                        /
                                    </span>
                                </Show>
                                <span
                                    class={styles.crumb}
                                    aria-current={i() === crumbs().length - 1 ? "location" : undefined}
                                >
                                    {crumb}
                                </span>
                            </>
                        )}
                    </For>
                    <Show when={dirty()}>
                        <span class={styles.dirtyDot} aria-label="Unsaved changes" role="img" />
                    </Show>
                </nav>
                <Show when={props.write && textContent()}>
                    <PaperButton
                        size="small"
                        variant="primary"
                        disabled={!dirty() || !editable() || saving()}
                        onClick={() => void save()}
                    >
                        <Icon name={ICONS.save} />
                        {saving() ? "Saving…" : "Save"}
                    </PaperButton>
                </Show>
                <Show when={(props.fileMenu ?? true) && openPath()}>
                    <PaperButton
                        size="small"
                        icon
                        variant="text"
                        aria-label="File actions"
                        title="File actions"
                        aria-haspopup="menu"
                        aria-expanded={menu.isOpen()}
                        onClick={(e) => (menu.isOpen() ? menu.close() : menu.openBelow(e.currentTarget, { align: "right" }))}
                    >
                        <Icon name={ICONS.menu} />
                    </PaperButton>
                </Show>
            </header>

            <Show when={notice()} keyed>
                {(current) => (
                    <div
                        class={styles.notice}
                        classList={{ [styles.noticeDanger]: current.tone === "danger" }}
                        role={current.tone === "danger" ? "alert" : "status"}
                    >
                        <Icon name={current.tone === "danger" ? ICONS.warning : ICONS.saved} />
                        <span class={styles.noticeText}>{current.text}</span>
                        <Show when={current.tone === "danger"}>
                            <PaperButton size="tiny" variant="text" onClick={reloadFromDisk}>
                                <Icon name={ICONS.reload} />
                                Reload from disk
                            </PaperButton>
                        </Show>
                    </div>
                )}
            </Show>

            <div class={styles.body}>
                <Switch>
                    <Match when={doc().status === "idle"}>
                        <PaperEmptyState
                            icon={<Icon name={ICONS.choose} class={styles.emptyIcon} />}
                            title={selected() && folders[selected()!] ? baseName(selected()!) : "Choose a file"}
                            description="Pick a file on the left to view or edit it."
                        />
                    </Match>
                    <Match when={doc().status === "loading"}>
                        <div class={styles.center}>
                            <PaperLoader loaderStatus="indeterminate" label="Opening…" />
                        </div>
                    </Match>
                    <Match when={doc().status === "error" && (doc() as Extract<DocState, { status: "error" }>)}>
                        {(state) => (
                            <PaperEmptyState
                                icon={<Icon name={ICONS.error} class={styles.emptyIcon} />}
                                title={`Couldn't open ${baseName(state().path)}`}
                                description={state().message}
                                role="alert"
                            >
                                <PaperButton size="small" onClick={() => void load(state().path)}>
                                    <Icon name={ICONS.refresh} />
                                    Try again
                                </PaperButton>
                            </PaperEmptyState>
                        )}
                    </Match>
                    <Match when={textContent()}>
                        <PaperEditor
                            value={buffer()}
                            onChange={(value) => {
                                setBuffer(value);
                                if (notice()?.tone === "success") setNotice(null);
                            }}
                            language={language().id}
                            highlight={props.highlight ?? true}
                            lineNumbers={lineNumbers()}
                            wrap={wrap()}
                            readOnly={!editable()}
                            onSave={() => void save()}
                            onCursorChange={setCursor}
                            aria-label={`Contents of ${baseName(openPath() ?? "")}`}
                        />
                    </Match>
                    <Match when={doc().status === "ready" && (doc() as Extract<DocState, { status: "ready" }>).content}>
                        {(content) => (
                            <Switch>
                                <Match when={content().kind === "image" && (content() as Extract<PaperFileContent, { kind: "image" }>)}>
                                    {(image) => (
                                        <div class={styles.imagePreview}>
                                            <img src={image().src} alt={image().alt ?? baseName(openPath() ?? "")} />
                                        </div>
                                    )}
                                </Match>
                                <Match when={content().kind === "unavailable" && (content() as Extract<PaperFileContent, { kind: "unavailable" }>)}>
                                    {(unavailable) => (
                                        <PaperEmptyState
                                            icon={<Icon name={ICONS.unavailable} class={styles.emptyIcon} />}
                                            title="This file can't be shown here"
                                            description={unavailable().reason}
                                        />
                                    )}
                                </Match>
                            </Switch>
                        )}
                    </Match>
                </Switch>
            </div>

            <Show when={textContent()}>
                <footer class={styles.statusBar}>
                    <Show when={readOnlyReason()}>
                        <span class={styles.statusItem}>
                            <Icon name={ICONS.readOnly} />
                            {readOnlyReason()}
                        </span>
                    </Show>
                    <span class={styles.statusSpacer} />
                    <span class={styles.statusItem}>
                        Ln {cursor().line}, Col {cursor().column}
                    </span>
                    <span class={styles.statusItem}>{language().label}</span>
                </footer>
            </Show>

            <PaperContextMenu open={menu.isOpen()} target={menu.target()} placement={menu.placement()} onClose={menu.close}>
                <Show when={props.write}>
                    <PaperContextMenuItem
                        value="save"
                        icon={<Icon name={ICONS.save} />}
                        shortcut="Ctrl+S"
                        disabled={!dirty() || !editable() || saving()}
                        onClick={() => void save()}
                    >
                        Save
                    </PaperContextMenuItem>
                    <PaperContextMenuItem value="revert" icon={<Icon name={ICONS.revert} />} disabled={!dirty()} onClick={revert}>
                        Revert changes
                    </PaperContextMenuItem>
                </Show>
                <PaperContextMenuItem value="reload" icon={<Icon name={ICONS.reload} />} onClick={reloadFromDisk}>
                    Reload from disk
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    value="wrap"
                    icon={<Icon name={ICONS.wrap} />}
                    checked={wrap()}
                    disabled={!textContent()}
                    onClick={() => setWrap((on) => !on)}
                >
                    Word wrap
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    value="line-numbers"
                    icon={<Icon name={ICONS.lineNumbers} />}
                    checked={lineNumbers()}
                    disabled={!textContent()}
                    onClick={() => setLineNumbers((on) => !on)}
                >
                    Line numbers
                </PaperContextMenuItem>
                <PaperContextMenuItem
                    value="copy-path"
                    icon={<Icon name={ICONS.copy} />}
                    onClick={() => {
                        const path = openPath();
                        if (path) void copyText(path);
                    }}
                >
                    Copy path
                </PaperContextMenuItem>
            </PaperContextMenu>
        </section>
    );

    return (
        <>
            <PaperSplit
                class={[styles.PaperFileBrowser, props.class].filter(Boolean).join(" ")}
                side={tree}
                sideWidth={props.sideWidth}
                detailActive={openPath() !== null}
                onDetailClose={closeFile}
                detailTitle={openPath() ? baseName(openPath()!) : undefined}
                onCollapsedChange={setCollapsed}
            >
                {viewer}
            </PaperSplit>

            <PaperModal
                open={pending() !== null}
                onClose={() => setPending(null)}
                title={`Save changes to ${pending()?.name ?? "this file"}?`}
                size="small"
                footer={
                    <div class={styles.modalActions}>
                        <PaperButton variant="text" onClick={() => setPending(null)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            onClick={() => {
                                const action = pending()?.run;
                                setPending(null);
                                revert();
                                action?.();
                            }}
                        >
                            Discard
                        </PaperButton>
                        <Show when={editable()}>
                            <PaperButton
                                variant="primary"
                                onClick={async () => {
                                    const action = pending()?.run;
                                    if (await save()) {
                                        setPending(null);
                                        action?.();
                                    } else setPending(null);
                                }}
                            >
                                Save
                            </PaperButton>
                        </Show>
                    </div>
                }
            >
                <p class={styles.modalText}>Your changes will be lost if you don't save them.</p>
            </PaperModal>
        </>
    );
}
