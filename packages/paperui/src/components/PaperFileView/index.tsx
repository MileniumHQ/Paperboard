import styles from "./index.module.css";
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { PaperEmptyState } from "../PaperEmptyState";
import { PaperError } from "../PaperError";
import { PaperIcon } from "../PaperIcon";
import { PaperLoader } from "../PaperLoader";
import { cx } from "../../utils/cx";
import { errorMessage } from "../../utils/errorMessage";
import { escapeAttributeValue } from "../../utils/selector";
import { Glyph, type NearScreen } from "./Glyph";
import {
    paperFileViewDate,
    paperFileViewInside,
    paperFileViewKind,
    paperFileViewParent,
    paperFileViewSize,
    sortPaperFileViewEntries,
} from "./files";
import type { PaperFileViewDrop, PaperFileViewEntry, PaperFileViewProps, PaperFileViewSort, PaperFileViewSortKey } from "./types";

export {
    paperFileViewDate,
    paperFileViewExtension,
    paperFileViewInside,
    paperFileViewKind,
    paperFileViewParent,
    paperFileViewSize,
    sortPaperFileViewEntries,
    type PaperFileViewKind,
} from "./files";
export type * from "./types";

// what a drag of entries from a view carries, so a drop can tell them from files
const MIME = "application/x-paper-file-view";
// a drag held over a folder opens it
const SPRING_MS = 900;
// letters typed within this of each other find a name together
const TYPEAHEAD_MS = 900;
// a second click on a chosen name, this long after, renames it
const SLOW_CLICK_MS = 550;
// a listing slower than this shows a loader; a fast one never flashes it
const LOADER_DELAY_MS = 250;
// narrower than this, the list keeps only its names and icons shrink
const NARROW_PX = 560;
const LIST_GLYPH = 28;
const DEFAULT_ICON = 72;
const NARROW_ICON = 56;

// the entries a view on this page is dragging: one drag at a time, read by
// every view and by the host's own drop targets, so they all refuse alike
const [dragging, setDragging] = createSignal<readonly string[] | null>(null);
// a folder can't go into itself, or where it already is
const refusesDrop = (paths: readonly string[], target: string) => paths.some((p) => paperFileViewInside(target, p) || paperFileViewParent(p) === target);

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = (e: KeyboardEvent | MouseEvent) => (isMac() ? e.metaKey : e.ctrlKey);
const rowSelector = (path: string) => `[data-path="${escapeAttributeValue(path)}"]`;

/**
 * Files and folders, the way a desktop shows them: as icons, or as a list
 * whose folders open in place. It owns choosing, the keys that move through
 * entries, dragging onto folders, dropping files from the computer and
 * renaming in place; the host owns where the files live and every command
 * beyond those.
 */
export function PaperFileView(props: PaperFileViewProps) {
    let viewRef!: HTMLDivElement;
    let gridRef: HTMLDivElement | undefined;
    let ghostRef!: HTMLDivElement;

    const mode = () => props.mode ?? "icons";
    const sort = (): PaperFileViewSort => props.sort ?? { key: "name", dir: 1 };
    const [narrow, setNarrow] = createSignal(false);
    const iconSize = () => (narrow() ? Math.min(props.iconSize ?? DEFAULT_ICON, NARROW_ICON) : (props.iconSize ?? DEFAULT_ICON));

    // ---------- listings: one per folder on screen, reconciled by path ----------
    const [listings, setListings] = createStore<Record<string, PaperFileViewEntry[] | undefined>>({});
    const [failures, setFailures] = createStore<Record<string, string | undefined>>({});
    const tokens = new Map<string, number>();
    async function load(folder: string) {
        // a newer listing of the same folder wins over an older one still on its way
        const token = (tokens.get(folder) ?? 0) + 1;
        tokens.set(folder, token);
        try {
            const entries = await props.list(folder);
            if (tokens.get(folder) !== token) return;
            batch(() => {
                setListings(folder, reconcile(entries, { key: "path" }));
                setFailures(folder, undefined);
            });
        } catch (err) {
            if (tokens.get(folder) !== token) return;
            // quiet: shown in place of the folder, with Try again
            setFailures(folder, errorMessage(err));
        }
    }

    // ---------- folders opened in place, in the list ----------
    const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
    const toggleExpanded = (folder: string, open?: boolean) => {
        const next = new Set(expanded());
        const willOpen = open ?? !next.has(folder);
        if (willOpen === next.has(folder)) return;
        if (willOpen) {
            next.add(folder);
            if (!listings[folder]) void load(folder);
        } else next.delete(folder);
        setExpanded(next);
    };

    // the folder on screen: the one left behind stays until the next has
    // listed, so moving between folders never flashes an empty view
    const [shown, setShown] = createSignal(untrack(() => props.folder));
    const arrive = (folder: string) => {
        if (folder !== props.folder || folder === shown()) return;
        batch(() => {
            // what was open in place belonged to the folder left behind
            setExpanded(new Set<string>());
            for (const listed of Object.keys(listings)) if (listed !== folder) setListings(listed, undefined);
            setShown(folder);
        });
    };
    createEffect(
        on(
            () => props.folder,
            (folder) => {
                void load(folder).then(() => arrive(folder));
                // a listing that takes a moment shows a loader in its place, once the moment has passed
                const timer = setTimeout(() => arrive(folder), LOADER_DELAY_MS);
                onCleanup(() => clearTimeout(timer));
            },
        ),
    );

    /**
     * What is on screen, in the order arrows and Shift walk it. The entries
     * are the store's own, reconciled by path, so a row keeps its identity
     * (and its thumbnail and rename field) when the listing around it changes.
     */
    const listed = createMemo(() => {
        const order: PaperFileViewEntry[] = [];
        const depths = new Map<string, number>();
        const walk = (folder: string, depth: number) => {
            for (const entry of sortPaperFileViewEntries(listings[folder] ?? [], sort())) {
                order.push(entry);
                depths.set(entry.path, depth);
                if (mode() === "list" && entry.kind === "folder" && expanded().has(entry.path)) walk(entry.path, depth + 1);
            }
        };
        walk(shown(), 0);
        return { order, depths };
    });
    const order = () => listed().order;
    const depthOf = (path: string) => listed().depths.get(path) ?? 0;
    const byPath = createMemo(() => new Map(order().map((e) => [e.path, e])));

    // ---------- choosing ----------
    const chosen = createMemo(() => new Set(props.selection));
    const [lead, setLead] = createSignal<string | null>(null);
    let anchor: string | null = null;
    // a selection the host sets leads from its last entry
    createEffect(
        on(
            () => props.selection,
            (paths) => {
                if (!paths.includes(untrack(lead) ?? "")) setLead(paths.at(-1) ?? null);
            },
        ),
    );
    const select = (paths: string[], leadPath = paths.at(-1) ?? null, anchorPath = leadPath) => {
        setLead(leadPath);
        anchor = anchorPath;
        props.onSelectionChange(paths);
    };
    const rangeTo = (target: string) => {
        const paths = order().map((e) => e.path);
        const from = paths.indexOf(anchor ?? target);
        const to = paths.indexOf(target);
        if (from < 0 || to < 0) return select([target]);
        const [a, b] = from < to ? [from, to] : [to, from];
        select(paths.slice(a, b + 1), target, anchor);
    };

    // ---------- keys ----------
    const columnsInGrid = () => (gridRef ? getComputedStyle(gridRef).gridTemplateColumns.split(" ").length : 1);

    function step(delta: number, extend: boolean, filesOnly = false) {
        const all = order();
        if (!all.length) return;
        const at = all.findIndex((e) => e.path === lead());
        let i = at < 0 ? (delta > 0 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, at + delta));
        // a preview walks files: it passes over folders on its way
        if (filesOnly) {
            while (all[i] && all[i].kind === "folder") i += Math.sign(delta) || 1;
            if (!all[i]) return;
        }
        const next = all[i];
        if (extend) return rangeTo(next.path);
        select([next.path]);
    }

    let typed = "";
    let typedAt = 0;
    function typeahead(char: string) {
        const now = Date.now();
        typed = now - typedAt > TYPEAHEAD_MS ? char : typed + char;
        typedAt = now;
        const hit = order().find((e) => e.name.toLowerCase().startsWith(typed.toLowerCase()));
        if (hit) select([hit.path]);
    }

    const chosenEntries = () => props.selection.map((p) => byPath().get(p)).filter((e): e is PaperFileViewEntry => !!e);

    // keys the view does not use carry on to the host
    function onKeyDown(e: KeyboardEvent) {
        if (renaming() || e.defaultPrevented) return;
        const leadPath = lead();
        const leadEntry = leadPath ? byPath().get(leadPath) : undefined;
        const take = () => e.preventDefault();
        const k = e.key;
        if (mod(e) && k.toLowerCase() === "a") return take(), select(order().map((x) => x.path));
        if (props.onDelete && (k === "Delete" || (isMac() && e.metaKey && k === "Backspace")) && chosenEntries().length) {
            return take(), props.onDelete(chosenEntries());
        }
        if ((mod(e) || e.altKey) && k === "ArrowDown") return take(), leadEntry && props.onOpen(leadEntry);
        if (mod(e) || e.altKey) return;
        if (k === "Enter") return take(), leadEntry && props.onOpen(leadEntry);
        if (k === "F2" && leadEntry && props.onRename) return take(), setRenaming(leadEntry.path);
        if (k === " " && leadEntry && props.onQuickLook) return take(), props.onQuickLook(leadEntry);
        if (k === "Escape" && props.selection.length) return take(), select([]);
        if (k === "ArrowDown" || k === "ArrowUp") {
            take();
            return step((k === "ArrowDown" ? 1 : -1) * (mode() === "icons" ? columnsInGrid() : 1), e.shiftKey);
        }
        if (k === "ArrowRight" || k === "ArrowLeft") {
            take();
            const right = k === "ArrowRight";
            if (mode() === "icons") return step(right ? 1 : -1, e.shiftKey);
            if (!leadEntry) return step(1, false);
            if (leadEntry.kind === "folder" && (right || expanded().has(leadEntry.path))) return toggleExpanded(leadEntry.path, right);
            const parent = paperFileViewParent(leadEntry.path);
            if (!right && parent !== shown() && byPath().get(parent)) select([parent]);
            return;
        }
        if (k.length === 1 && k !== " ") typeahead(k);
    }

    // the lead stays in sight
    createEffect(
        on(lead, (leadPath) => {
            if (!leadPath) return;
            queueMicrotask(() => viewRef?.querySelector(rowSelector(leadPath))?.scrollIntoView({ block: "nearest" }));
        }),
    );

    const [focused, setFocused] = createSignal(false);

    // ---------- renaming ----------
    const [renaming, setRenaming] = createSignal<string | null>(null);
    const commitRename = async (entry: PaperFileViewEntry, name: string) => {
        setRenaming(null);
        viewRef.focus();
        const clean = name.trim();
        if (!clean || clean === entry.name) return;
        await props.onRename?.(entry, clean);
    };

    // ---------- pointer ----------
    let pressedChosen = false;
    let pressedBy = "mouse";
    let dragged = false;
    let renameTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelSlowClick = () => clearTimeout(renameTimer);
    onCleanup(cancelSlowClick);

    const onItemPointerDown = (e: PointerEvent, entry: PaperFileViewEntry) => {
        pressedBy = e.pointerType;
        if (e.button !== 0 || renaming() === entry.path) return;
        dragged = false;
        pressedChosen = chosen().has(entry.path);
        if (e.pointerType !== "touch" && !mod(e) && !e.shiftKey && !pressedChosen) select([entry.path]);
    };
    const onItemClick = (e: MouseEvent, entry: PaperFileViewEntry) => {
        if (renaming() === entry.path) return;
        viewRef.focus({ preventScroll: true });
        // a finger opens what it taps, as a phone's Files does
        if (pressedBy === "touch" && !mod(e) && !e.shiftKey) {
            select([entry.path]);
            return props.onOpen(entry);
        }
        if (mod(e)) {
            const has = chosen().has(entry.path);
            return select(has ? props.selection.filter((p) => p !== entry.path) : [...props.selection, entry.path], entry.path);
        }
        if (e.shiftKey) return rangeTo(entry.path);
        if (dragged) return;
        if (props.selection.length > 1) return select([entry.path]);
        // a second, slow click on a chosen name renames it
        if (pressedChosen && props.onRename && e.detail === 1 && (e.target as HTMLElement).closest("[data-name]")) {
            cancelSlowClick();
            renameTimer = setTimeout(() => setRenaming(entry.path), SLOW_CLICK_MS);
        }
    };

    const [marquee, setMarquee] = createSignal<{ x: number; y: number; w: number; h: number } | null>(null);
    const onViewPointerDown = (e: PointerEvent) => {
        pressedBy = e.pointerType;
        if (e.button !== 0 || (e.target as HTMLElement).closest("[data-path], button, input, textarea, a")) return;
        viewRef.focus({ preventScroll: true });
        if (e.pointerType === "touch") return;
        const keep = e.shiftKey || mod(e) ? [...props.selection] : [];
        if (!keep.length && props.selection.length) select([]);
        // a box dragged over the entries chooses what it touches
        const box = viewRef.getBoundingClientRect();
        const start = { x: e.clientX - box.left + viewRef.scrollLeft, y: e.clientY - box.top + viewRef.scrollTop };
        const items = [...viewRef.querySelectorAll<HTMLElement>("[data-path]")];
        viewRef.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
            const x = ev.clientX - box.left + viewRef.scrollLeft;
            const y = ev.clientY - box.top + viewRef.scrollTop;
            const rect = { x: Math.min(x, start.x), y: Math.min(y, start.y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) };
            if (rect.w < 4 && rect.h < 4) return;
            setMarquee(rect);
            const hits = new Set(keep);
            for (const el of items) {
                const r = el.getBoundingClientRect();
                const ix = r.left - box.left + viewRef.scrollLeft;
                const iy = r.top - box.top + viewRef.scrollTop;
                if (ix < rect.x + rect.w && ix + r.width > rect.x && iy < rect.y + rect.h && iy + r.height > rect.y) hits.add(el.dataset.path!);
            }
            const paths = order().map((entry) => entry.path).filter((p) => hits.has(p));
            if (paths.join("\n") !== props.selection.join("\n")) select(paths, paths.at(-1) ?? null, paths[0] ?? null);
        };
        const up = () => {
            setMarquee(null);
            viewRef.removeEventListener("pointermove", move);
            viewRef.removeEventListener("pointerup", up);
            viewRef.removeEventListener("pointercancel", up);
        };
        viewRef.addEventListener("pointermove", move);
        viewRef.addEventListener("pointerup", up);
        viewRef.addEventListener("pointercancel", up);
    };

    // ---------- dragging ----------
    const [dropAt, setDropAt] = createSignal<string | null>(null);
    let springTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(springTimer));

    const onItemDragStart = (e: DragEvent, entry: PaperFileViewEntry) => {
        cancelSlowClick();
        if (!props.onDrop || !e.dataTransfer) return e.preventDefault();
        dragged = true;
        const paths = chosen().has(entry.path) ? [...props.selection] : [entry.path];
        if (!chosen().has(entry.path)) select(paths);
        setDragging(paths);
        // a folder the drag opened leaves this row behind, and its dragend
        // with it: the drop ends the drag wherever it lands on the page
        window.addEventListener("drop", onDragEnd, { capture: true, once: true });
        e.dataTransfer.setData(MIME, JSON.stringify(paths));
        e.dataTransfer.setData("text/plain", paths.map((p) => p.slice(p.lastIndexOf("/") + 1)).join("\n"));
        e.dataTransfer.effectAllowed = "move";
        ghostRef.textContent = paths.length === 1 ? entry.name : `${entry.name} and ${paths.length - 1} more`;
        e.dataTransfer.setDragImage(ghostRef, 16, 16);
    };
    const onDragEnd = () => {
        window.removeEventListener("drop", onDragEnd, { capture: true });
        clearTimeout(springTimer);
        batch(() => {
            setDragging(null);
            setDropAt(null);
        });
    };

    /** a folder that takes what is let go over it; a folder in the view opens when a drag rests on it */
    const dropTarget = (folder: () => string, entry?: PaperFileViewEntry) => ({
        onDragOver: (e: DragEvent) => {
            const target = folder();
            if (!props.onDrop || !e.dataTransfer) return;
            const ours = e.dataTransfer.types.includes(MIME);
            if (!ours && !e.dataTransfer.types.includes("Files")) return;
            if (ours && refusesDrop(dragging() ?? [], target)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = ours ? "move" : "copy";
            if (dropAt() === target) return;
            setDropAt(target);
            clearTimeout(springTimer);
            if (entry) springTimer = setTimeout(() => props.onOpen(entry), SPRING_MS);
        },
        onDragLeave: (e: DragEvent) => {
            if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
            if (dropAt() !== folder()) return;
            clearTimeout(springTimer);
            setDropAt(null);
        },
        onDrop: (e: DragEvent) => {
            const target = folder();
            if (!props.onDrop || !e.dataTransfer) return;
            e.preventDefault();
            e.stopPropagation();
            clearTimeout(springTimer);
            setDropAt(null);
            const drop = readDrop(e.dataTransfer, target);
            if (!drop || (drop.kind === "entries" && refusesDrop(drop.paths, target))) return;
            props.onDrop(drop);
        },
    });

    // ---------- near the screen: one observer for every glyph ----------
    const nearCallbacks = new Map<Element, () => void>();
    let nearObserver: IntersectionObserver | undefined;
    const near: NearScreen = (el, onNear) => {
        nearObserver ??= new IntersectionObserver(
            (seen) => {
                for (const s of seen) {
                    if (!s.isIntersecting) continue;
                    nearCallbacks.get(s.target)?.();
                    nearCallbacks.delete(s.target);
                    nearObserver?.unobserve(s.target);
                }
            },
            { root: viewRef, rootMargin: "50% 0px" },
        );
        nearCallbacks.set(el, onNear);
        nearObserver.observe(el);
        return () => {
            nearCallbacks.delete(el);
            nearObserver?.unobserve(el);
        };
    };
    onCleanup(() => nearObserver?.disconnect());

    // ---------- the host's handle ----------
    onMount(() => {
        props.ref?.({
            reload: async (folder) => {
                const shown = Object.keys(listings).filter((f) => listings[f] !== undefined || failures[f] !== undefined);
                await Promise.all((folder === undefined ? shown : shown.filter((f) => f === folder)).map((f) => load(f)));
            },
            rename: (path) => setRenaming(path),
            entry: (path) => byPath().get(path),
            entries: order,
            focus: () => viewRef.focus({ preventScroll: true }),
            step: (delta) => step(delta, false, true),
        });
        const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < NARROW_PX));
        observer.observe(viewRef);
        onCleanup(() => observer.disconnect());
    });

    // ---------- pieces ----------
    // where a one-word file name may break before its extension ("Lighthouse"
    // over ".jpg", not "Lighthouse.jp" over "g"), or -1: a name with spaces
    // breaks between its words, and a folder has no extension
    const extensionAt = (entry: PaperFileViewEntry) => (entry.kind === "folder" || /\s/.test(entry.name) ? -1 : entry.name.lastIndexOf("."));
    const Name = (p: { entry: PaperFileViewEntry; class: string; wrap?: boolean }) => (
        <Show
            when={renaming() === p.entry.path}
            fallback={
                <span class={p.class} data-name title={p.entry.name}>
                    {/* a one-word name that wraps breaks before its extension, not inside it */}
                    <Show when={p.wrap && extensionAt(p.entry) > 0} fallback={p.entry.name}>
                        {p.entry.name.slice(0, extensionAt(p.entry))}
                        <wbr />
                        {p.entry.name.slice(extensionAt(p.entry))}
                    </Show>
                </span>
            }
        >
            <RenameField
                entry={p.entry}
                wrap={p.wrap}
                onDone={(name) => void commitRename(p.entry, name)}
                onCancel={() => {
                    setRenaming(null);
                    viewRef.focus({ preventScroll: true });
                }}
            />
        </Show>
    );

    const itemProps = (entry: PaperFileViewEntry) => ({
        "data-path": entry.path,
        draggable: Boolean(props.onDrop) && renaming() !== entry.path,
        role: mode() === "icons" ? ("option" as const) : ("row" as const),
        "aria-selected": chosen().has(entry.path),
        onPointerDown: (e: PointerEvent) => onItemPointerDown(e, entry),
        onClick: (e: MouseEvent) => onItemClick(e, entry),
        onDblClick: () => {
            cancelSlowClick();
            if (pressedBy !== "touch") props.onOpen(entry);
        },
        onContextMenu: (e: MouseEvent) => {
            if (!props.onContextMenu) return;
            e.preventDefault();
            e.stopPropagation();
            cancelSlowClick();
            if (!chosen().has(entry.path)) select([entry.path]);
            props.onContextMenu(e, entry);
        },
        onDragStart: (e: DragEvent) => onItemDragStart(e, entry),
        onDragEnd,
        ...(entry.kind === "folder" ? dropTarget(() => entry.path, entry) : {}),
    });
    const itemClasses = (entry: PaperFileViewEntry) => ({
        [styles.selected]: chosen().has(entry.path),
        [styles.dropHere]: dropAt() === entry.path,
        [styles.moving]: !!dragging()?.includes(entry.path),
    });

    const Fill = () => (
        <Show
            when={failures[shown()]}
            fallback={
                <Show
                    when={listings[shown()]}
                    fallback={
                        <div class={styles.fill}>
                            <PaperLoader loaderStatus="indeterminate" />
                        </div>
                    }
                >
                    <Show when={order().length === 0}>
                        <div class={styles.fill}>{props.empty ?? <PaperEmptyState icon="folder_open" title="This folder is empty" />}</div>
                    </Show>
                </Show>
            }
        >
            {(why) => (
                <div class={styles.fill}>
                    <PaperError fill title="Couldn't open this folder" error={why()} action={{ label: "Try again", onClick: () => void load(shown()) }} />
                </div>
            )}
        </Show>
    );

    // ---------- modes ----------
    const Icons = () => (
        <div class={styles.grid} ref={gridRef} style={{ "--file-view-icon": `${iconSize()}px` }}>
            <For each={order()}>
                {(entry) => (
                    <div class={styles.tile} classList={itemClasses(entry)} {...itemProps(entry)}>
                        <span class={styles.tileGlyph}>
                            <Glyph entry={entry} size={iconSize()} thumbnail={props.thumbnail} near={near} />
                        </span>
                        <Name entry={entry} class={styles.tileName} wrap />
                    </div>
                )}
            </For>
        </div>
    );

    const sortBy = (key: PaperFileViewSortKey) =>
        props.onSortChange?.({ key, dir: sort().key === key ? (sort().dir === 1 ? -1 : 1) : key === "modified" || key === "size" ? -1 : 1 });
    const Head = (p: { key: PaperFileViewSortKey; label: string; wide?: boolean }) => (
        <button
            type="button"
            class={styles.headCell}
            classList={{ [styles.sorted]: sort().key === p.key, [styles.wideOnly]: p.wide }}
            disabled={!props.onSortChange}
            aria-sort={sort().key === p.key ? (sort().dir === 1 ? "ascending" : "descending") : undefined}
            onClick={() => sortBy(p.key)}
        >
            {p.label}
            <Show when={sort().key === p.key}>
                <PaperIcon class={styles.sortIcon}>{sort().dir === 1 ? "arrow_upward" : "arrow_downward"}</PaperIcon>
            </Show>
        </button>
    );

    const List = () => (
        <div class={styles.table}>
            <div class={styles.head} role="row">
                <Head key="name" label="Name" />
                <Head key="modified" label="Modified" wide />
                <Head key="size" label="Size" wide />
                <Head key="kind" label="Kind" wide />
            </div>
            <For each={order()}>
                {(entry) => (
                    <div class={styles.row} classList={itemClasses(entry)} aria-level={depthOf(entry.path) + 1} {...itemProps(entry)}>
                        <span class={styles.nameCell} style={{ "--file-view-depth": depthOf(entry.path) }}>
                            <Show when={entry.kind === "folder"} fallback={<span class={styles.disclosureSpace} />}>
                                <button
                                    type="button"
                                    class={styles.disclosure}
                                    classList={{ [styles.open]: expanded().has(entry.path) }}
                                    aria-label={expanded().has(entry.path) ? `Close ${entry.name}` : `Open ${entry.name} here`}
                                    aria-expanded={expanded().has(entry.path)}
                                    tabIndex={-1}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleExpanded(entry.path);
                                    }}
                                >
                                    <PaperIcon>chevron_right</PaperIcon>
                                </button>
                            </Show>
                            <Glyph entry={entry} size={LIST_GLYPH} thumbnail={props.thumbnail} near={near} />
                            <span class={styles.nameStack}>
                                <Name entry={entry} class={styles.rowName} />
                                <span class={styles.narrowOnly}>
                                    {paperFileViewDate(entry.modified)} · {paperFileViewSize(entry)}
                                </span>
                            </span>
                        </span>
                        <span class={cx(styles.cellMuted, styles.wideOnly)}>{paperFileViewDate(entry.modified)}</span>
                        <span class={cx(styles.cellMuted, styles.wideOnly)}>{paperFileViewSize(entry)}</span>
                        <span class={cx(styles.cellMuted, styles.wideOnly)}>{paperFileViewKind(entry).label}</span>
                    </div>
                )}
            </For>
        </div>
    );

    return (
        <div
            ref={viewRef}
            class={cx(styles.PaperFileView, props.class)}
            classList={{ [styles.focused]: focused(), [styles.narrow]: narrow(), [styles.dropHere]: dropAt() === shown() }}
            tabIndex={0}
            role={mode() === "list" ? "treegrid" : "listbox"}
            aria-label={props["aria-label"]}
            aria-multiselectable="true"
            data-mode={mode()}
            onKeyDown={onKeyDown}
            onFocusIn={() => setFocused(true)}
            onFocusOut={(e) => !viewRef.contains(e.relatedTarget as Node) && setFocused(false)}
            onPointerDown={onViewPointerDown}
            onContextMenu={(e) => {
                if (!props.onContextMenu || (e.target as HTMLElement).closest("[data-path]")) return;
                e.preventDefault();
                if (props.selection.length) select([]);
                props.onContextMenu(e, null);
            }}
            {...dropTarget(shown)}
        >
            <Show when={mode() === "icons"} fallback={<List />}>
                <Icons />
            </Show>
            <Fill />
            <Show when={marquee()}>
                {(m) => <div class={styles.marquee} style={{ left: `${m().x}px`, top: `${m().y}px`, width: `${m().w}px`, height: `${m().h}px` }} />}
            </Show>
            <div ref={ghostRef} class={styles.ghost} aria-hidden="true" />
        </div>
    );
}

function RenameField(props: { entry: PaperFileViewEntry; wrap?: boolean; onDone: (name: string) => void; onCancel: () => void }) {
    let field!: HTMLInputElement | HTMLTextAreaElement;
    let settled = false;
    onMount(() => {
        field.focus();
        // the name is chosen without its extension, so typing keeps the kind
        const dot = props.entry.kind === "file" ? props.entry.name.lastIndexOf(".") : -1;
        field.setSelectionRange(0, dot > 0 ? dot : props.entry.name.length);
        field.scrollLeft = 0;
    });
    const finish = (save: boolean) => {
        if (settled) return;
        settled = true;
        if (save) props.onDone(field.value);
        else props.onCancel();
    };
    const shared = {
        class: styles.rename,
        value: props.entry.name,
        "aria-label": "Name",
        spellcheck: false,
        onPointerDown: (e: PointerEvent) => e.stopPropagation(),
        onClick: (e: MouseEvent) => e.stopPropagation(),
        onDblClick: (e: MouseEvent) => e.stopPropagation(),
        onKeyDown: (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                finish(true);
            }
            if (e.key === "Escape") {
                e.preventDefault();
                finish(false);
            }
        },
        onBlur: () => finish(true),
    };
    return props.wrap ? <textarea ref={(el) => (field = el)} rows={1} {...shared} /> : <input ref={(el) => (field = el)} {...shared} />;
}

/** What a drop carried: entries from a file view, or files from the computer; null for anything else. */
function readDrop(data: DataTransfer, folder: string): PaperFileViewDrop | null {
    const raw = data.getData(MIME);
    if (raw) {
        const paths: unknown = JSON.parse(raw);
        if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) throw new Error("A dropped file view entry list isn't a list of paths");
        return { kind: "entries", paths, folder };
    }
    const files = [...data.files];
    return files.length ? { kind: "files", files, folder } : null;
}

/**
 * Makes the host's own places take drops the way the view's folders do,
 * such as the parts of a path above the view. `over` is the folder a drag
 * is over now.
 */
export function createPaperFileViewDropTarget(onDrop: (drop: PaperFileViewDrop) => void) {
    const [over, setOver] = createSignal<string | null>(null);
    const handlers = (folder: string) => ({
        onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer) return;
            const ours = e.dataTransfer.types.includes(MIME);
            if (!ours && !e.dataTransfer.types.includes("Files")) return;
            if (ours && refusesDrop(dragging() ?? [], folder)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = ours ? "move" : "copy";
            setOver(folder);
        },
        onDragLeave: (e: DragEvent) => {
            if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
            if (over() === folder) setOver(null);
        },
        onDrop: (e: DragEvent) => {
            if (!e.dataTransfer) return;
            e.preventDefault();
            setOver(null);
            const drop = readDrop(e.dataTransfer, folder);
            if (drop && !(drop.kind === "entries" && refusesDrop(drop.paths, folder))) onDrop(drop);
        },
    });
    return { over, handlers };
}
