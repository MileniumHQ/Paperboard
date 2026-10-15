import { PaperButton, PaperEmptyState, PaperPresence, PaperText } from "@mileniumhq/paperui";
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
import { config, parseWidgetSize, type PanelItem, type WidgetOptionValues, type WidgetSize } from "@mileniumhq/paperapi";
import { logToMain, type ComputerInfo } from "../../lib/shell";
import {
    canPlace,
    computeGeometry,
    findFreeSpot,
    fitCanvas,
    HOME_LAYOUT_COMPUTER,
    HOME_LAYOUT_ID,
    MAX_HOME_ITEMS,
    parseHomeLayout,
    placementOf,
    serializeHomeLayout,
    sizeOf,
    snapToGrid,
    stepPlacement,
    usedRows,
    type HomeItem,
    type Placement,
} from "../../lib/homeLayout";
import { createLoadQueue } from "../../lib/loadQueue";
import WidgetTile, { type TileStatus } from "./WidgetTile";
import WidgetLibrary, { sizeLabel, type LibraryEntry } from "./WidgetLibrary";
import PanelWidgetFrame, { type FrameFacts } from "./PanelWidgetFrame";
import { BuiltinView, builtinWidget, defaultHomeItems } from "./builtins";
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

/** What a widget is drawn from: a placed item, or a gallery entry being dragged. */
type WidgetRef = Pick<LibraryEntry, "computerId" | "source"> & { widgetId: string; panelId?: string; options?: WidgetOptionValues };

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
    onOpenComputer: (computerId: string) => void;
    /** bumped when a panel is restarted, by `computerId::panelId` */
    reloadTokens: Record<string, number>;
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
    const [editing, setEditingNow] = createSignal(false);
    // the canvas eases only while it changes size for the gallery, so a
    // window resize still tracks the window exactly
    const [easing, setEasing] = createSignal(false);
    let easeTimer: ReturnType<typeof setTimeout> | undefined;
    const setEditing = (next: boolean) => {
        if (next === editing()) return;
        // for as long as the transition the stylesheet gives it, which is none under reduced motion
        const seconds = scroller ? parseFloat(getComputedStyle(scroller).getPropertyValue("--paper-mid-transition")) : 0;
        setEasing(true);
        clearTimeout(easeTimer);
        easeTimer = setTimeout(() => setEasing(false), (Number.isFinite(seconds) ? seconds : 0) * 1000);
        setEditingNow(next);
    };
    const [selectedId, setSelectedId] = createSignal<string | null>(null);
    const [drag, setDrag] = createSignal<DragState | null>(null);
    const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
    const [inView, setInView] = createSignal<Record<string, boolean>>({});
    const [suspended, setSuspended] = createSignal(false);
    const queue = createLoadQueue(CONCURRENT_LOADS);

    const [galleryWidth, setGalleryWidth] = createSignal(0);
    let scroller: HTMLDivElement | undefined;
    let grid: HTMLDivElement | undefined;
    const tileElements = new Map<string, HTMLDivElement>();

    // ── persistence ──────────────────────────────────────────────────────
    // The layout lives in the local daemon's shell document. An unreadable
    // layout is shown as an error and never saved over by accident.
    const load = async () => {
        setLoadState("loading");
        try {
            const raw = await config.get(HOME_LAYOUT_ID, undefined, HOME_LAYOUT_COMPUTER);
            // a Home never arranged starts with this computer at a glance;
            // nothing is saved until it is changed
            setItems(raw === null || raw === undefined ? defaultHomeItems(HOME_LAYOUT_COMPUTER) : parseHomeLayout(raw));
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
    // the layout never changes to fit: when it is wider than the window, or
    // the gallery takes room from it, it is drawn smaller
    const geometry = createMemo(() => computeGeometry(viewport().width, items()));
    const gridWidth = () => geometry().across * geometry().cell;
    // a gallery left open on a hidden Home is released with Home's widgets
    const galleryOpen = () => editing() && loadState() === "ready" && !suspended();
    const fitted = createMemo(() => fitCanvas(gridWidth(), viewport().width - (galleryOpen() ? galleryWidth() : 0)));
    const scale = () => fitted().scale;
    const gridLeft = () => fitted().left;
    // a spare row to drop into while editing; never fewer than reach the
    // bottom of the window, so the dots do too
    const rows = createMemo(() =>
        Math.max(usedRows(items(), editing() ? 1 : 0), Math.floor(viewport().height / (geometry().cell * scale()))),
    );
    const gridHeight = () => rows() * geometry().cell;
    const inset = () => Math.round(geometry().cell * 0.06);

    const rectOf = (p: Placement) => {
        const g = geometry();
        return {
            left: p.x * g.cell + inset(),
            top: p.y * g.cell + inset(),
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
        if (item.source === "builtin") {
            const builtin = builtinWidget(item.widgetId);
            if (!builtin) return { kind: "unavailable", message: "This version of Paperboard doesn't have this widget." };
            if (!builtin.declaration.sizes.includes(item.size)) {
                return { kind: "unavailable", message: `${builtin.declaration.name} doesn't come in ${sizeLabel(item.size)}.` };
            }
            const offered = (builtin.declaration.options ?? []).every((option) =>
                builtin.choices?.[option.id]?.some((choice) => choice.value === item.options?.[option.id]),
            );
            if (!offered) return { kind: "unavailable", message: `This version of Paperboard doesn't have this ${builtin.declaration.name.toLowerCase()}.` };
            if (builtin.perComputer && !comp.isLocal && comp.status?.connected === false) {
                return { kind: "unavailable", message: `${comp.name} is offline.` };
            }
            return { kind: "ok" };
        }
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
        return { kind: "ok" };
    };
    const computerName = (id: string) => props.computers.find((c) => c.id === id)?.name ?? id;
    const panelName = (computerId: string, panelId: string) =>
        props.panelsByComputer[computerId]?.find((p) => p.id === panelId)?.name ?? panelId;
    // what a panel's widget frames load against: whether it runs a service,
    // and a revision that changes when it is updated or restarted
    const frameFacts = (computerId: string, panelId: string): FrameFacts => {
        const panel = props.panelsByComputer[computerId]?.find((p) => p.id === panelId);
        return {
            service: !!panel?.service,
            computerName: computerName(computerId),
            revision: `${panel?.version ?? ""}|${panel?.updatedAt ?? ""}|${props.reloadTokens[`${computerId}::${panelId}`] ?? 0}`,
        };
    };
    const declarationOf = (item: HomeItem) =>
        item.source === "builtin"
            ? builtinWidget(item.widgetId)?.declaration
            : props.panelsByComputer[item.computerId]?.find((p) => p.id === item.panelId)?.widgets?.find((w) => w.id === item.widgetId);
    const labelOf = (item: HomeItem) => {
        const name = declarationOf(item)?.name ?? item.widgetId;
        if (item.source === "panel") return `${name} (${panelName(item.computerId, item.panelId)})`;
        // a CPU or Memory widget says which computer it shows once there's a choice
        return builtinWidget(item.widgetId)?.perComputer && props.computers.length > 1 ? `${name} (${computerName(item.computerId)})` : name;
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
        clearTimeout(easeTimer);
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
        const base = {
            id,
            computerId: entry.computerId,
            widgetId: entry.widget.id,
            size: `${p.w}x${p.h}`,
            x: p.x,
            y: p.y,
            ...(entry.options && Object.keys(entry.options).length > 0 ? { options: entry.options } : {}),
        };
        commit([...items(), entry.source === "builtin" ? { ...base, source: "builtin" } : { ...base, source: "panel", panelId: entry.panelId }]);
        setSelectedId(id);
    };
    const addToFirstFreeSpot = (entry: LibraryEntry) => {
        const size = parseWidgetSize(entry.size);
        if (!size) return;
        const spot = findFreeSpot(items(), size, geometry().across);
        if (spot) addAt(entry, spot);
    };
    const moveTo = (id: string, p: Placement) => {
        if (!canPlace(items(), p, id)) return false;
        commit(items().map((item) => (item.id === id ? { ...item, x: p.x, y: p.y } : item)));
        return true;
    };
    const remove = (id: string) => {
        commit(items().filter((item) => item.id !== id));
        if (selectedId() === id) setSelectedId(null);
    };
    // ── dragging ─────────────────────────────────────────────────────────
    const target = createMemo(() => {
        const d = drag();
        if (!d?.started || !grid) return null;
        const g = geometry();
        const rect = grid.getBoundingClientRect();
        // the grid may be drawn smaller than it is laid out
        const left = (d.pointer.x - rect.left) / scale() - d.grab.x * g.cell;
        const top = (d.pointer.y - rect.top) / scale() - d.grab.y * g.cell;
        const p = snapToGrid(left, top, d.size, g);
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
        const size = parseWidgetSize(entry.size);
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
            x: ((event.clientX - rect.left) / scale() + inset()) / cell,
            y: ((event.clientY - rect.top) / scale() + inset()) / cell,
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

    // what the ghost draws; the same widget stays the same object while the
    // pointer moves, so the ghost's content isn't rebuilt on every move
    const ghostFrom = createMemo<WidgetRef | undefined>(
        () => {
            const d = drag();
            if (!d?.started) return undefined;
            if (d.source.kind === "new") return { ...d.source.entry, widgetId: d.source.entry.widget.id };
            return itemsById().get(d.source.itemId);
        },
        undefined,
        {
            equals: (a, b) =>
                a?.source === b?.source &&
                a?.computerId === b?.computerId &&
                a?.widgetId === b?.widgetId &&
                a?.panelId === b?.panelId &&
                JSON.stringify(a?.options) === JSON.stringify(b?.options),
        },
    );
    const ghost = () => {
        const d = drag();
        if (!d?.started) return null;
        const g = geometry();
        return {
            name: d.name,
            size: d.size,
            // laid out at its real size and drawn at the canvas's, like the tiles
            style: {
                left: `${d.pointer.x - (d.grab.x * g.cell - inset()) * scale()}px`,
                top: `${d.pointer.y - (d.grab.y * g.cell - inset()) * scale()}px`,
                width: `${d.size.w * g.cell - inset() * 2}px`,
                height: `${d.size.h * g.cell - inset() * 2}px`,
                transform: `scale(${scale()})`,
            },
        };
    };
    // a widget being arranged doesn't navigate when pressed
    const navigates = () => !editing();
    // a built-in widget draws in place; a panel widget is the panel's frame
    const content = (from: WidgetRef, size: () => WidgetSize, visible: () => boolean, instanceId: string, label: () => string) => {
        const builtin = from.source === "builtin" ? builtinWidget(from.widgetId) : undefined;
        if (builtin) {
            return (
                <BuiltinView
                    widget={builtin}
                    computerId={from.computerId}
                    computerName={computerName(from.computerId)}
                    showComputer={props.computers.length > 1}
                    size={size()}
                    options={from.options ?? {}}
                    visible={visible()}
                    panelName={(panelId) => panelName(from.computerId, panelId)}
                    computers={props.computers}
                    panels={props.panelsByComputer[from.computerId]}
                    panelsFailed={!!props.panelsLoadFailed[from.computerId]}
                    onRetryPanels={() => props.onRefreshPanels(from.computerId)}
                    onOpenPanel={navigates() ? (panelId) => props.onOpenPanel(from.computerId, panelId) : undefined}
                    onOpenComputer={navigates() ? props.onOpenComputer : undefined}
                />
            );
        }
        if (!from.panelId) return null;
        const panelId = from.panelId;
        return (
            <PanelWidgetFrame
                computerId={from.computerId}
                computerName={frameFacts(from.computerId, panelId).computerName}
                panelId={panelId}
                widgetId={from.widgetId}
                instanceId={instanceId}
                size={size()}
                options={from.options}
                service={frameFacts(from.computerId, panelId).service}
                revision={frameFacts(from.computerId, panelId).revision}
                visible={visible()}
                label={label()}
                queue={queue}
                onOpenPanel={() => props.onOpenPanel(from.computerId, panelId)}
            />
        );
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
                    <div class={styles.stage} style={{ height: `${gridHeight() * scale()}px`, width: `${fitted().width + (galleryOpen() ? galleryWidth() : 0)}px` }}>
                    <div
                        ref={grid}
                        class={`${styles.grid} ${styles.dots}`}
                        classList={{ [styles.easing]: easing() }}
                        style={{
                            width: `${gridWidth()}px`,
                            height: `${gridHeight()}px`,
                            transform: `translateX(${gridLeft()}px) scale(${scale()})`,
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
                                            status={status()}
                                            live={live()}
                                            editing={editing()}
                                            selected={selectedId() === id}
                                            lifted={lifted(id)}
                                            style={px(rectOf(placementOf(item())))}
                                            label={labelOf(item())}
                                            sizeLabel={sizeLabel(item().size)}
                                            onRemove={() => remove(id)}
                                            onPointerDown={(e) => startTileDrag(item(), e)}
                                            onKeyDown={(e) => onTileKey(item(), e)}
                                            onFocus={() => setSelectedId(id)}
                                        >
                                            {/* an item never changes what it shows, only where and how big */}
                                            {untrack(() => content(item(), size, visible, id, () => labelOf(item())))}
                                        </WidgetTile>
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
                </div>

                <Show when={loadState() === "ready" && items().length === 0 && !editing()}>
                    <div class={styles.centerState}>
                        <PaperEmptyState
                            icon="widgets"
                            title="Welcome home"
                            description="Widgets from your panels, on every computer, in one place."
                        >
                            <PaperButton variant="primary" onClick={() => setEditing(true)}>Add widgets</PaperButton>
                        </PaperEmptyState>
                    </div>
                </Show>
                <Show when={loadState() === "loading"}>
                    <div class={styles.centerState} role="status">
                        <PaperEmptyState description="Loading Home…" />
                    </div>
                </Show>
                <Show when={typeof loadState() === "object" ? (loadState() as { error: string }) : null}>
                    {(failed) => (
                        <div class={styles.centerState} role="alert">
                            <PaperEmptyState icon="error" title="Couldn't load Home" description={failed().error}>
                                <PaperButton variant="primary" onClick={() => void load()}>Retry</PaperButton>
                                <PaperButton variant="danger" onClick={() => void startOver()}>Start over with an empty Home</PaperButton>
                            </PaperEmptyState>
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

            <PaperPresence when={galleryOpen()} motion="slide-end">
                <WidgetLibrary
                    onWidth={setGalleryWidth}
                    computers={props.computers}
                    panelsByComputer={props.panelsByComputer}
                    panelsLoadFailed={props.panelsLoadFailed}
                    full={items().length >= MAX_HOME_ITEMS}
                    visible={props.visible}
                    cell={geometry().cell}
                    inset={inset()}
                    queue={queue}
                    panelName={panelName}
                    frameFacts={frameFacts}
                    onRetry={props.onRefreshPanels}
                    onStartDrag={startLibraryDrag}
                    onAdd={addToFirstFreeSpot}
                    onDone={finishEditing}
                />
            </PaperPresence>

            <Show when={ghost()}>
                {(g) => (
                    <div class={styles.ghost} style={g().style} aria-hidden="true">
                        {/* a built-in widget is picked up as itself; a panel's frame can't be, so its name stands in */}
                        <Show
                            when={ghostFrom()?.source === "builtin" ? ghostFrom() : undefined}
                            keyed
                            fallback={<PaperText size={2}>{g().name}</PaperText>}
                        >
                            {(from) => content(from, () => g().size, () => true, "ghost", () => g().name)}
                        </Show>
                    </div>
                )}
            </Show>
        </div>
    );
};

export default HomeView;
