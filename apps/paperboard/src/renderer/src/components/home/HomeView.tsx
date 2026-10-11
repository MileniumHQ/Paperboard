import { PaperButton, PaperText } from "@mileniumhq/paperui";
import {
    type Component,
    createEffect,
    createMemo,
    createSignal,
    For,
    onCleanup,
    onMount,
    Show,
    untrack,
} from "solid-js";
import { config, parseWidgetSize, type PanelItem, type WidgetSize } from "@mileniumhq/paperapi";
import { logToMain, type ComputerInfo } from "../../lib/shell";
import {
    bandRows,
    canPlace,
    columnOrigin,
    COLUMN_CELLS,
    computeGeometry,
    findFreeSpot,
    HOME_LAYOUT_COMPUTER,
    HOME_LAYOUT_ID,
    MAX_HOME_ITEMS,
    parseHomeLayout,
    placementOf,
    serializeHomeLayout,
    sizeOf,
    snapToGrid,
    stepPlacement,
    type HomeItem,
    type Placement,
} from "../../lib/homeLayout";
import { createLoadQueue } from "../../lib/loadQueue";
import WidgetTile, { type TileStatus } from "./WidgetTile";
import WidgetLibrary, { sizeLabel, type LibraryEntry } from "./WidgetLibrary";
import styles from "./Home.module.css";

// Loading more than this many frames at once stalled the shell's own
// frames in measurement; four was smooth and finished sooner.
const CONCURRENT_LOADS = 4;
// A tile scrolled out of view keeps its frame this long, so scrolling back
// is instant; after it, the frame (and its process, if it was the panel's
// last) is released.
const OFFSCREEN_UNLOAD_MS = 30_000;
// Hidden Home keeps its frames (≈0 CPU while hidden) this long, then
// releases them until Home is shown again.
const HIDDEN_SUSPEND_MS = 5 * 60_000;
const SAVE_DEBOUNCE_MS = 250;
const DRAG_THRESHOLD_PX = 4;
const AUTOSCROLL_EDGE_PX = 48;
const AUTOSCROLL_STEP_PX = 16;

type DragSource =
    | { kind: "new"; entry: LibraryEntry }
    | { kind: "move"; itemId: string };

interface DragState {
    source: DragSource;
    name: string;
    size: WidgetSize;
    /** pointer offset inside the ghost, in cells, so it survives a cell-size change */
    grab: { x: number; y: number };
    start: { x: number; y: number };
    pointer: { x: number; y: number };
    started: boolean;
}

export interface HomeViewProps {
    visible: boolean;
    computers: ComputerInfo[];
    panelsByComputer: Record<string, PanelItem[]>;
    panelsLoadFailed: Record<string, boolean>;
    onRefreshPanels: (computerId: string) => void;
    onOpenPanel: (computerId: string, panelId: string) => void;
}

const HomeView: Component<HomeViewProps> = (props) => {
    const [items, setItems] = createSignal<HomeItem[]>([]);
    const itemsById = createMemo(() => new Map(items().map((item) => [item.id, item])));
    const itemIds = createMemo(
        () => items().map((item) => item.id),
        [],
        { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
    );
    const [loadState, setLoadState] = createSignal<"loading" | "ready" | { error: string }>("loading");
    const [saveError, setSaveError] = createSignal<string | null>(null);
    const [editing, setEditing] = createSignal(false);
    const [selectedId, setSelectedId] = createSignal<string | null>(null);
    const [drag, setDrag] = createSignal<DragState | null>(null);
    const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
    const [inView, setInView] = createSignal<Record<string, boolean>>({});
    const [suspended, setSuspended] = createSignal(false);
    const queue = createLoadQueue(CONCURRENT_LOADS);

    let scroller: HTMLDivElement | undefined;
    let grid: HTMLDivElement | undefined;
    const tileElements = new Map<string, HTMLDivElement>();

    // ── persistence ──────────────────────────────────────────────────────
    // The layout lives in the local daemon's shell document. An unreadable
    // layout is shown as an error and never saved over by accident.
    const load = async () => {
        setLoadState("loading");
        try {
            setItems(parseHomeLayout(await config.get(HOME_LAYOUT_ID, undefined, HOME_LAYOUT_COMPUTER)));
            setLoadState("ready");
        } catch (err) {
            logToMain("error", "Failed to load the Home layout:", err);
            setLoadState({ error: err instanceof Error ? err.message : String(err) });
        }
    };

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let saving = false;
    let dirty = false;
    const flush = async () => {
        clearTimeout(saveTimer);
        if (saving || !dirty || loadState() !== "ready") return;
        saving = true;
        dirty = false;
        try {
            await config.set(serializeHomeLayout(items()), HOME_LAYOUT_ID, undefined, HOME_LAYOUT_COMPUTER);
            setSaveError(null);
        } catch (err) {
            logToMain("error", "Failed to save the Home layout:", err);
            dirty = true;
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            saving = false;
        }
        // a change made while the save was in flight gets its own save
        if (dirty && !saveError()) saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    };
    const commit = (next: HomeItem[]) => {
        setItems(next);
        dirty = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    };
    const startOver = async () => {
        // explicit, user-chosen replacement of a layout that can't be read
        try {
            await config.set(serializeHomeLayout([]), HOME_LAYOUT_ID, undefined, HOME_LAYOUT_COMPUTER);
            setItems([]);
            setLoadState("ready");
        } catch (err) {
            logToMain("error", "Failed to reset the Home layout:", err);
            setLoadState({ error: err instanceof Error ? err.message : String(err) });
        }
    };

    // ── geometry ─────────────────────────────────────────────────────────
    const geometry = createMemo(() => computeGeometry(viewport().width, items()));
    const rows = createMemo(() => {
        const g = geometry();
        const r = bandRows(items(), g, editing() ? 1 : 0);
        // the last band runs to the bottom of the window so the dots do too
        const above = r.slice(0, -1).reduce((sum, n) => sum + n, 0);
        const fill = Math.floor(viewport().height / g.cell) - above;
        r[r.length - 1] = Math.max(r[r.length - 1], fill);
        return r;
    });
    const gridWidth = () => geometry().fit * COLUMN_CELLS * geometry().cell;
    const gridHeight = () => rows().reduce((sum, n) => sum + n, 0) * geometry().cell;
    const inset = () => Math.round(geometry().cell * 0.06);

    const rectOf = (p: Placement) => {
        const g = geometry();
        const origin = columnOrigin(p.column, g, rows());
        return {
            left: origin.left + p.x * g.cell + inset(),
            top: origin.top + p.y * g.cell + inset(),
            width: p.w * g.cell - inset() * 2,
            height: p.h * g.cell - inset() * 2,
        };
    };
    const px = (r: { left: number; top: number; width: number; height: number }) => ({
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
    });

    // ── what each placed widget can show ─────────────────────────────────
    const statusOf = (item: HomeItem): TileStatus => {
        const comp = props.computers.find((c) => c.id === item.computerId);
        if (!comp) return { kind: "unavailable", message: "This widget's computer was removed from Paperboard." };
        const retry = () => props.onRefreshPanels(item.computerId);
        if (!comp.isLocal && comp.status?.connected === false) {
            return { kind: "unavailable", message: `${comp.name} is offline.`, retry };
        }
        const panels = props.panelsByComputer[item.computerId];
        if (!panels) {
            if (props.panelsLoadFailed[item.computerId]) {
                return { kind: "unavailable", message: `Couldn't load panels from ${comp.name}.`, retry };
            }
            return { kind: "waiting", message: "Loading widget…" };
        }
        const panel = panels.find((p) => p.id === item.panelId);
        if (!panel) return { kind: "unavailable", message: `${item.panelId} isn't installed on ${comp.name}.`, retry };
        const widget = panel.widgets?.find((w) => w.id === item.widgetId);
        if (!widget) return { kind: "unavailable", message: `${panel.name} no longer offers this widget.`, retry };
        if (!widget.sizes.includes(item.size)) {
            return { kind: "unavailable", message: `${panel.name} no longer offers this widget at ${sizeLabel(item.size)}.` };
        }
        return { kind: "ok", panelName: panel.name, widgetName: widget.name };
    };
    const declarationOf = (item: HomeItem) =>
        props.panelsByComputer[item.computerId]?.find((p) => p.id === item.panelId)?.widgets?.find((w) => w.id === item.widgetId);
    const labelOf = (item: HomeItem) => {
        const status = statusOf(item);
        return status.kind === "ok" ? `${status.widgetName} (${status.panelName})` : item.widgetId;
    };

    // ── panel lists for every computer ───────────────────────────────────
    // Home spans every paired computer, so it asks each one for its panels
    // once; a failure is shown with a retry on the tile and in the library.
    const requested = new Set<string>();
    createEffect(() => {
        const ids = new Set(props.computers.map((c) => c.id));
        for (const id of [...requested]) if (!ids.has(id)) requested.delete(id);
        for (const id of ids) {
            if (requested.has(id) || props.panelsByComputer[id]) continue;
            requested.add(id);
            props.onRefreshPanels(id);
        }
    });

    // ── live frames ──────────────────────────────────────────────────────
    let observer: IntersectionObserver | undefined;
    const observe = (id: string, el: HTMLDivElement) => {
        const previous = tileElements.get(id);
        if (previous === el) return;
        if (previous) observer?.unobserve(previous);
        tileElements.set(id, el);
        observer?.observe(el);
    };
    const offscreenTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const [recentlyInView, setRecentlyInView] = createSignal<Record<string, boolean>>({});
    createEffect(() => {
        // a tile that leaves the view keeps its frame for a while, then lets go
        const now = inView();
        const ids = new Set(items().map((i) => i.id));
        for (const [id, timer] of offscreenTimers) {
            if (now[id] || !ids.has(id)) {
                clearTimeout(timer);
                offscreenTimers.delete(id);
            }
        }
        const recent = untrack(recentlyInView);
        const next: Record<string, boolean> = {};
        for (const id of ids) {
            if (now[id]) next[id] = true;
            else if (recent[id]) {
                next[id] = true;
                if (!offscreenTimers.has(id)) {
                    offscreenTimers.set(id, setTimeout(() => {
                        offscreenTimers.delete(id);
                        setRecentlyInView((prev) => {
                            const copy = { ...prev };
                            delete copy[id];
                            return copy;
                        });
                    }, OFFSCREEN_UNLOAD_MS));
                }
            }
        }
        setRecentlyInView(next);
    });

    let suspendTimer: ReturnType<typeof setTimeout> | undefined;
    createEffect(() => {
        clearTimeout(suspendTimer);
        if (props.visible) setSuspended(false);
        else suspendTimer = setTimeout(() => setSuspended(true), HIDDEN_SUSPEND_MS);
    });

    onMount(() => {
        void load();
        if (!scroller) return;
        const resize = new ResizeObserver(() => {
            // a hidden Home measures 0; keep the last real size
            if (!scroller || scroller.clientWidth === 0) return;
            const style = getComputedStyle(scroller);
            setViewport({
                width: scroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
                height: scroller.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
            });
        });
        resize.observe(scroller);
        observer = new IntersectionObserver(
            (entries) => {
                // a hidden Home reports every tile as out of view; that is
                // the suspend timer's business, not the scroll unloader's
                if (!props.visible) return;
                setInView((prev) => {
                    const next = { ...prev };
                    for (const entry of entries) {
                        const id = (entry.target as HTMLElement).dataset.homeItem;
                        if (id) next[id] = entry.isIntersecting;
                    }
                    return next;
                });
            },
            { root: scroller, rootMargin: "50% 0px" },
        );
        for (const el of tileElements.values()) observer.observe(el);
        onCleanup(() => {
            resize.disconnect();
            observer?.disconnect();
        });
    });

    // forget tiles that are gone, so the maps stay as big as the layout
    createEffect(() => {
        const ids = new Set(items().map((i) => i.id));
        for (const [id, el] of tileElements) {
            if (!ids.has(id)) {
                observer?.unobserve(el);
                tileElements.delete(id);
            }
        }
        setInView((prev) => {
            const next: Record<string, boolean> = {};
            for (const id of ids) if (prev[id]) next[id] = true;
            return next;
        });
    });

    onCleanup(() => {
        clearTimeout(saveTimer);
        clearTimeout(suspendTimer);
        for (const timer of offscreenTimers.values()) clearTimeout(timer);
        offscreenTimers.clear();
        tileElements.clear();
        endDrag();
        void flush();
    });

    // ── editing ──────────────────────────────────────────────────────────
    const addAt = (entry: LibraryEntry, p: Placement) => {
        if (items().length >= MAX_HOME_ITEMS || !canPlace(items(), p)) return;
        const id = crypto.randomUUID();
        commit([
            ...items(),
            {
                id,
                computerId: entry.computerId,
                panelId: entry.panelId,
                widgetId: entry.widget.id,
                size: `${p.w}x${p.h}`,
                column: p.column,
                x: p.x,
                y: p.y,
            },
        ]);
        setSelectedId(id);
    };
    const addToFirstFreeSpot = (entry: LibraryEntry) => {
        const size = parseWidgetSize(entry.widget.sizes[0]);
        if (!size) return;
        const spot = findFreeSpot(items(), size, geometry().columns);
        if (spot) addAt(entry, spot);
    };
    const moveTo = (id: string, p: Placement) => {
        if (!canPlace(items(), p, id)) return false;
        commit(items().map((item) => (item.id === id ? { ...item, column: p.column, x: p.x, y: p.y, size: `${p.w}x${p.h}` } : item)));
        return true;
    };
    const remove = (id: string) => {
        commit(items().filter((item) => item.id !== id));
        if (selectedId() === id) setSelectedId(null);
    };
    // a size that doesn't fit where the widget is stays put; the next one is tried
    const cycleSize = (item: HomeItem) => {
        const sizes = declarationOf(item)?.sizes ?? [];
        const start = sizes.indexOf(item.size);
        for (let step = 1; step < sizes.length; step++) {
            const next = parseWidgetSize(sizes[(start + step) % sizes.length]);
            if (!next) continue;
            const x = Math.min(item.x, COLUMN_CELLS - next.w);
            if (moveTo(item.id, { column: item.column, x, y: item.y, ...next })) return;
        }
    };

    // ── dragging ─────────────────────────────────────────────────────────
    const target = createMemo(() => {
        const d = drag();
        if (!d?.started || !grid) return null;
        const g = geometry();
        const rect = grid.getBoundingClientRect();
        const left = d.pointer.x - rect.left - d.grab.x * g.cell;
        const top = d.pointer.y - rect.top - d.grab.y * g.cell;
        const p = snapToGrid(left, top, d.size, g, rows());
        if (!p) return null;
        const ignore = d.source.kind === "move" ? d.source.itemId : undefined;
        const full = d.source.kind === "new" && items().length >= MAX_HOME_ITEMS;
        return { placement: p, valid: !full && canPlace(items(), p, ignore) };
    });

    const onPointerMove = (event: PointerEvent) => {
        const d = drag();
        if (!d) return;
        const pointer = { x: event.clientX, y: event.clientY };
        const started = d.started || Math.hypot(pointer.x - d.start.x, pointer.y - d.start.y) > DRAG_THRESHOLD_PX;
        setDrag({ ...d, pointer, started });
        if (started && scroller) {
            const bounds = scroller.getBoundingClientRect();
            if (pointer.y > bounds.bottom - AUTOSCROLL_EDGE_PX) scroller.scrollTop += AUTOSCROLL_STEP_PX;
            else if (pointer.y < bounds.top + AUTOSCROLL_EDGE_PX) scroller.scrollTop -= AUTOSCROLL_STEP_PX;
        }
    };
    const onPointerUp = () => {
        const d = drag();
        const t = target();
        endDrag();
        if (!d) return;
        if (!d.started) {
            // a press without a drag: library entries add, tiles select
            if (d.source.kind === "new") addToFirstFreeSpot(d.source.entry);
            else setSelectedId(d.source.itemId);
            return;
        }
        if (!t?.valid) return;
        if (d.source.kind === "new") addAt(d.source.entry, t.placement);
        else moveTo(d.source.itemId, t.placement);
    };
    const onDragKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") endDrag();
    };
    let dragTarget: Element | null = null;
    let dragPointer = -1;
    function endDrag() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", endDrag);
        window.removeEventListener("keydown", onDragKey);
        window.removeEventListener("blur", endDrag);
        if (dragTarget?.hasPointerCapture?.(dragPointer)) dragTarget.releasePointerCapture(dragPointer);
        dragTarget = null;
        setDrag(null);
    }
    const beginDrag = (event: PointerEvent, source: DragSource, name: string, size: WidgetSize, grab: { x: number; y: number }) => {
        if (event.button !== 0) return;
        event.preventDefault();
        endDrag();
        dragTarget = event.currentTarget as Element;
        dragPointer = event.pointerId;
        // capture keeps the drag ours while the pointer crosses widget frames
        dragTarget.setPointerCapture?.(event.pointerId);
        const start = { x: event.clientX, y: event.clientY };
        setDrag({ source, name, size, grab, start, pointer: start, started: false });
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", endDrag);
        window.addEventListener("keydown", onDragKey);
        window.addEventListener("blur", endDrag);
    };
    const startLibraryDrag = (entry: LibraryEntry, event: PointerEvent) => {
        const size = parseWidgetSize(entry.widget.sizes[0]);
        if (!size) return;
        // the ghost hangs from the pointer near its top, like picking up a card
        beginDrag(event, { kind: "new", entry }, entry.widget.name, size, { x: size.w / 2, y: 0.3 });
    };
    const startTileDrag = (item: HomeItem, event: PointerEvent) => {
        const el = tileElements.get(item.id);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cell = geometry().cell;
        beginDrag(event, { kind: "move", itemId: item.id }, labelOf(item), sizeOf(item), {
            x: (event.clientX - rect.left + inset()) / cell,
            y: (event.clientY - rect.top + inset()) / cell,
        });
    };

    const onTileKey = (item: HomeItem, event: KeyboardEvent) => {
        const steps: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
        };
        const step = steps[event.key];
        if (step) {
            event.preventDefault();
            moveTo(item.id, stepPlacement(placementOf(item), step[0], step[1]));
        } else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            const index = items().findIndex((i) => i.id === item.id);
            remove(item.id);
            // keep keyboard focus on Home instead of dropping it to the body
            const next = items()[Math.min(index, items().length - 1)];
            queueMicrotask(() => (next ? tileElements.get(next.id)?.querySelector<HTMLElement>("[tabindex]") : editButton)?.focus());
        }
    };

    let editButton: HTMLButtonElement | undefined;
    const finishEditing = () => {
        endDrag();
        setEditing(false);
        setSelectedId(null);
        // the Done button is gone; focus lands on the button that comes back
        queueMicrotask(() => editButton?.focus());
    };

    const ghost = () => {
        const d = drag();
        if (!d?.started) return null;
        const g = geometry();
        return {
            name: d.name,
            style: {
                left: `${d.pointer.x - d.grab.x * g.cell + inset()}px`,
                top: `${d.pointer.y - d.grab.y * g.cell + inset()}px`,
                width: `${d.size.w * g.cell - inset() * 2}px`,
                height: `${d.size.h * g.cell - inset() * 2}px`,
            },
        };
    };
    const lifted = (id: string) => {
        const d = drag();
        return !!d?.started && d.source.kind === "move" && d.source.itemId === id;
    };

    return (
        <div class={styles.home} style={{ display: props.visible ? "flex" : "none" }}>
            <div class={styles.canvasArea}>
                <div
                    ref={scroller}
                    class={styles.scroller}
                    classList={{ [styles.editing]: editing(), [styles.dragging]: !!drag()?.started }}
                >
                    <div
                        ref={grid}
                        class={styles.grid}
                        style={{
                            width: `${gridWidth()}px`,
                            height: `${gridHeight()}px`,
                            "--home-cell": `${geometry().cell}px`,
                        }}
                    >
                        <Show when={loadState() === "ready"}>
                            <For each={itemIds()}>
                                {(id) => {
                                    // keyed by instance id: a moved or resized widget keeps
                                    // its frame and focus instead of remounting
                                    let last: HomeItem | undefined;
                                    const item = () => (last = itemsById().get(id) ?? last) as HomeItem;
                                    const status = () => statusOf(item());
                                    // a move is not a resize: the widget hears only real size changes
                                    // memos, so the frame's event handlers read plain values
                                    const live = createMemo(() => !!recentlyInView()[id] && !suspended());
                                    const visible = createMemo(() => props.visible && !!inView()[id]);
                                    const size = createMemo(() => sizeOf(item()), undefined, {
                                        equals: (a, b) => a.w === b.w && a.h === b.h,
                                    });
                                    return (
                                        <WidgetTile
                                            ref={(el) => observe(id, el)}
                                            instanceId={id}
                                            computerId={item().computerId}
                                            panelId={item().panelId}
                                            widgetId={item().widgetId}
                                            size={size()}
                                            status={status()}
                                            live={live()}
                                            visible={visible()}
                                            editing={editing()}
                                            selected={selectedId() === id}
                                            lifted={lifted(id)}
                                            queue={queue}
                                            style={px(rectOf(placementOf(item())))}
                                            label={labelOf(item())}
                                            sizeLabel={sizeLabel(item().size)}
                                            canResize={(declarationOf(item())?.sizes.length ?? 0) > 1}
                                            onOpenPanel={() => props.onOpenPanel(item().computerId, item().panelId)}
                                            onRemove={() => remove(id)}
                                            onCycleSize={() => cycleSize(item())}
                                            onPointerDown={(e) => startTileDrag(item(), e)}
                                            onKeyDown={(e) => onTileKey(item(), e)}
                                            onFocus={() => setSelectedId(id)}
                                        />
                                    );
                                }}
                            </For>
                        </Show>
                        <Show when={target()}>
                            {(t) => (
                                <div
                                    class={styles.dropOutline}
                                    classList={{ [styles.dropInvalid]: !t().valid }}
                                    style={px(rectOf(t().placement))}
                                    aria-hidden="true"
                                />
                            )}
                        </Show>
                    </div>
                </div>

                <Show when={loadState() === "ready" && items().length === 0 && !editing()}>
                    <div class={styles.centerState}>
                        <PaperText size={5} weight={800}>Welcome home</PaperText>
                        <PaperText size={2} color="text-subtle">
                            Widgets from your panels, on every computer, in one place.
                        </PaperText>
                        <PaperButton variant="primary" onClick={() => setEditing(true)}>Add widgets</PaperButton>
                    </div>
                </Show>
                <Show when={loadState() === "loading"}>
                    <div class={styles.centerState} role="status">
                        <PaperText size={2} color="text-subtle">Loading Home…</PaperText>
                    </div>
                </Show>
                <Show when={typeof loadState() === "object" ? (loadState() as { error: string }) : null}>
                    {(failed) => (
                        <div class={styles.centerState} role="alert">
                            <PaperText size={5} weight={800}>Couldn't load Home</PaperText>
                            <PaperText size={2} color="text-subtle">{failed().error}</PaperText>
                            <div class={styles.actions}>
                                <PaperButton variant="primary" onClick={() => void load()}>Retry</PaperButton>
                                <PaperButton variant="danger" onClick={() => void startOver()}>Start over with an empty Home</PaperButton>
                            </div>
                        </div>
                    )}
                </Show>

                <Show when={loadState() === "ready" && !editing() && items().length > 0}>
                    <div class={styles.toolbar}>
                        <PaperButton ref={editButton} size="small" onClick={() => setEditing(true)}>Edit Home</PaperButton>
                    </div>
                </Show>
                <Show when={saveError()}>
                    <div class={styles.banner} role="alert">
                        <PaperText size={1}>Couldn't save Home: {saveError()}</PaperText>
                        <PaperButton size="tiny" variant="text" onClick={() => { setSaveError(null); void flush(); }}>Retry</PaperButton>
                    </div>
                </Show>
            </div>

            <Show when={editing() && loadState() === "ready"}>
                <WidgetLibrary
                    computers={props.computers}
                    panelsByComputer={props.panelsByComputer}
                    panelsLoadFailed={props.panelsLoadFailed}
                    full={items().length >= MAX_HOME_ITEMS}
                    onRetry={props.onRefreshPanels}
                    onStartDrag={startLibraryDrag}
                    onAdd={addToFirstFreeSpot}
                    onDone={finishEditing}
                />
            </Show>

            <Show when={ghost()}>
                {(g) => (
                    <div class={styles.ghost} style={g().style} aria-hidden="true">
                        <PaperText size={2}>{g().name}</PaperText>
                    </div>
                )}
            </Show>
        </div>
    );
};

export default HomeView;
