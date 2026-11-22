import styles from "./index.module.css";
import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { PaperButton } from "../../components/PaperButton";
import { PaperContextMenu, PaperContextMenuItem, useContextMenuState } from "../../components/PaperContextMenu";
import { PaperEditor } from "../../components/PaperEditor";
import { PaperEmptyState } from "../../components/PaperEmptyState";
import { PaperIcon } from "../../components/PaperIcon";
import { PaperLoader } from "../../components/PaperLoader";
import { PaperModal } from "../../components/PaperModal";
import { PaperText } from "../../components/PaperText";
import { PaperPreview } from "../PaperPreview/PaperPreview";
import { PaperSplit } from "../PaperSplit";
import { copyText } from "../../utils/clipboard";
import { escapeAttributeValue } from "../../utils/selector";
import { createFileDocument } from "./fileDocument";
import {
    PAPER_FILE_BROWSER_ICONS as ICONS,
    ancestorPaths,
    baseName,
    paperFileIcon,
    paperFileLanguage,
    parentPath,
} from "./files";
import { createFolderTree } from "./folderTree";
import type { PaperFileBrowserProps, PaperFileContent, PaperFileEntry, PaperFileReveal } from "./types";
import { cx } from "../../utils/cx";

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

export type {
    PaperFileBrowserProps,
    PaperFileBrowserRef,
    PaperFileContent,
    PaperFileEntry,
    PaperFileListing,
    PaperFileReveal,
    PaperFileSaveResult,
} from "./types";

function rowSelector(path: string): string {
    return `[data-path="${escapeAttributeValue(path)}"]`;
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
    const tree = createFolderTree((path) => props.list(path));
    const file = createFileDocument(props);
    const { expanded, loadFolder, setFolderOpen, rows, entryRows } = tree;
    const { openPath, textContent, readOnlyReason, editable, dirty, notice } = file;
    const [selected, setSelected] = createSignal<string | null>(null);
    const [focused, setFocused] = createSignal<string>("");
    const [wrap, setWrap] = createSignal(false);
    const [lineNumbers, setLineNumbers] = createSignal(true);
    const [collapsed, setCollapsed] = createSignal(false);
    const menu = useContextMenuState("below-right");

    onMount(() => void loadFolder(""));

    props.ref?.({ dirty, confirmLeave: file.confirmLeave });
    // taken away while it asks: whoever asked stays where they are
    onCleanup(() => file.pending()?.settle(false));

    /** the open file's state, when it is `status` */
    const docIn = <S extends ReturnType<typeof file.doc>["status"]>(status: S) => {
        const state = file.doc();
        return state.status === status ? (state as Extract<ReturnType<typeof file.doc>, { status: S }>) : undefined;
    };

    const language = () => {
        const path = openPath();
        const fallback = path ? paperFileLanguage(baseName(path)) : { label: "Plain text" };
        const id = textContent()?.language ?? fallback.id;
        return { id, label: fallback.label };
    };

    const openFile = (path: string) => {
        setSelected(path);
        file.open(path);
    };

    const copyPath = async () => {
        const path = openPath();
        if (!path) return;
        const copied = await copyText(path);
        if (openPath() !== path) return;
        file.setNotice(
            copied
                ? { tone: "success", text: "Path copied" }
                : { tone: "danger", text: "Couldn't copy the path: this page may not use the clipboard" },
        );
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

    // a newer reveal replaces one still opening folders on its way
    let revealToken = 0;
    const reveal = async (target: PaperFileReveal) => {
        const token = ++revealToken;
        const folder = target.kind === "folder" ? target.path : parentPath(target.path);
        await loadFolder("");
        for (const path of ancestorPaths(folder)) {
            if (token !== revealToken) return;
            setFolderOpen(path, true);
            await loadFolder(path);
        }
        if (token !== revealToken) return;
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

    const activate = (entry: PaperFileEntry) => {
        if (entry.kind === "folder") {
            setSelected(entry.path);
            setFolderOpen(entry.path, !expanded().has(entry.path));
        } else openFile(entry.path);
    };

    const onTreeKeyDown = (e: KeyboardEvent) => {
        // keys from a control inside the tree (a folder's Retry button) are that control's own
        if (!(e.target instanceof Element) || e.target.getAttribute("role") !== "treeitem") return;
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
    createEffect(
        on([entryRows, focused], ([list, path]) => {
            if (list.length > 0 && !list.some((row) => row.entry.path === path)) {
                setFocused(list[0]!.entry.path);
            }
        }),
    );

    // ─── render ───────────────────────────────────────────────────────

    const crumbs = () => {
        const path = openPath() ?? selected() ?? "";
        return [props.rootLabel, ...(path ? path.split("/") : [])];
    };

    const treePane = (
        <div class={styles.treePane}>
            <div class={styles.treeHeader}>
                <span class={styles.treeTitle}>
                    <Icon name={ICONS.folder} class={styles.treeTitleIcon} />
                    {props.rootLabel}
                </span>
                <PaperButton size="tiny" icon variant="text" aria-label="Refresh files" title="Refresh files" onClick={tree.refresh}>
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
        <section class={styles.viewer} classList={{ [styles.viewerInPage]: collapsed() }} aria-label="File">
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
                        disabled={!dirty() || !editable() || file.saving()}
                        onClick={() => void file.save()}
                    >
                        <Icon name={ICONS.save} />
                        {file.saving() ? "Saving…" : "Save"}
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
                        <Show when={current.reload}>
                            <PaperButton size="tiny" variant="text" onClick={file.reloadFromDisk}>
                                <Icon name={ICONS.reload} />
                                Reload from disk
                            </PaperButton>
                        </Show>
                    </div>
                )}
            </Show>

            <div class={styles.body}>
                <Switch>
                    <Match when={file.doc().status === "idle"}>
                        <PaperEmptyState
                            icon={<Icon name={ICONS.choose} class={styles.emptyIcon} />}
                            title={selected() && tree.isListed(selected()!) ? baseName(selected()!) : "Choose a file"}
                            description="Pick a file on the left to view or edit it."
                        />
                    </Match>
                    <Match when={file.doc().status === "loading"}>
                        <div class={styles.center}>
                            <PaperLoader loaderStatus="indeterminate" label="Opening…" />
                        </div>
                    </Match>
                    <Match when={docIn("error")}>
                        {(state) => (
                            <PaperEmptyState
                                icon={<Icon name={ICONS.error} class={styles.emptyIcon} />}
                                title={`Couldn't open ${baseName(state().path)}`}
                                description={state().message}
                                role="alert"
                            >
                                <PaperButton size="small" onClick={() => void file.load(state().path)}>
                                    <Icon name={ICONS.refresh} />
                                    Try again
                                </PaperButton>
                            </PaperEmptyState>
                        )}
                    </Match>
                    <Match when={textContent()}>
                        <PaperEditor
                            value={file.buffer()}
                            onChange={file.edit}
                            language={language().id}
                            highlight={props.highlight ?? true}
                            lineNumbers={lineNumbers()}
                            wrap={wrap()}
                            readOnly={!editable()}
                            onSave={() => void file.save()}
                            onCursorChange={file.setCursor}
                            aria-label={`Contents of ${baseName(openPath() ?? "")}`}
                        />
                    </Match>
                    <Match when={docIn("ready")?.content}>
                        {(content) => (
                            <Switch>
                                <Match when={content().kind === "preview" && (content() as Extract<PaperFileContent, { kind: "preview" }>)}>
                                    {(preview) => (
                                        <PaperPreview class={styles.preview} src={preview().src} type={preview().type} name={baseName(openPath() ?? "")} />
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
                        Ln {file.cursor().line}, Col {file.cursor().column}
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
                        disabled={!dirty() || !editable() || file.saving()}
                        onClick={() => void file.save()}
                    >
                        Save
                    </PaperContextMenuItem>
                    <PaperContextMenuItem value="revert" icon={<Icon name={ICONS.revert} />} disabled={!dirty()} onClick={file.revert}>
                        Revert changes
                    </PaperContextMenuItem>
                </Show>
                <PaperContextMenuItem value="reload" icon={<Icon name={ICONS.reload} />} onClick={file.reloadFromDisk}>
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
                    onClick={() => void copyPath()}
                >
                    Copy path
                </PaperContextMenuItem>
            </PaperContextMenu>
        </section>
    );

    return (
        <>
            <PaperSplit
                class={cx(styles.PaperFileBrowser, props.class)}
                side={treePane}
                sideWidth={props.sideWidth}
                detailActive={openPath() !== null}
                onBeforeDetailClose={file.confirmLeave}
                onDetailClose={file.close}
                detailTitle={openPath() ? baseName(openPath()!) : undefined}
                onCollapsedChange={setCollapsed}
            >
                {viewer}
            </PaperSplit>

            <PaperModal
                open={file.pending() !== null}
                onClose={() => file.answer(false)}
                title={`Save changes to ${file.pending()?.name ?? "this file"}?`}
                size="small"
                footer={
                    <div class={styles.modalActions}>
                        <PaperButton variant="text" onClick={() => file.answer(false)}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            onClick={() => {
                                file.revert();
                                file.answer(true);
                            }}
                        >
                            Discard
                        </PaperButton>
                        <Show when={editable()}>
                            <PaperButton
                                variant="primary"
                                onClick={async () => {
                                    const request = file.pending();
                                    if (!request) return;
                                    const saved = await file.save();
                                    // canceled, or replaced by another question, while it saved:
                                    // that is the decision now, and this one no longer runs
                                    if (file.pending() !== request) return;
                                    // a failed save stays, its error showing; edits typed
                                    // while it saved are not in the file, so they stay too
                                    file.answer(saved && !dirty());
                                }}
                            >
                                Save
                            </PaperButton>
                        </Show>
                    </div>
                }
            >
                <PaperText color="text-subtle">Your changes will be lost if you don't save them.</PaperText>
            </PaperModal>
        </>
    );
}
