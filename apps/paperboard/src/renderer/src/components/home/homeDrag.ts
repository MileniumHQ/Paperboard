import { type Accessor, createMemo, createSignal, onCleanup } from "solid-js";
import { haptic } from "@mileniumhq/paperui";
import { parseWidgetSize, type WidgetSize } from "@mileniumhq/paperapi";
import { snapToGrid, snapToPhone, type HomeGeometry, type PhoneGeometry, type Placement } from "../../lib/homeLayout";
import type { LibraryEntry } from "./WidgetLibrary";

const DRAG_THRESHOLD_PX = 4;
const AUTOSCROLL_EDGE_PX = 48;
const AUTOSCROLL_STEP_PX = 16;
// phones: a widget in the gallery is picked up by holding it this long,
// still; moving first scrolls the gallery instead
const HOLD_MS = 400;
const HOLD_SLOP_PX = 8;
// a widget carried to a page's side edge turns the page after this long
const PAGE_EDGE_PX = 28;
const PAGE_TURN_MS = 550;

export type DragSource =
    | { kind: "new"; entry: LibraryEntry }
    | { kind: "move"; itemId: string };

export interface DragState {
    source: DragSource;
    name: string;
    size: WidgetSize;
    /** pointer offset inside the ghost, in cells, so it survives a cell-size change */
    grab: { x: number; y: number };
    start: { x: number; y: number };
    pointer: { x: number; y: number };
    started: boolean;
}

export interface HomeDragOptions {
    phone: Accessor<boolean>;
    scroller: () => HTMLElement | undefined;
    grid: () => HTMLElement | undefined;
    geometry: Accessor<HomeGeometry>;
    phoneGeometry: Accessor<PhoneGeometry>;
    /** how much smaller than it is laid out the grid is drawn */
    scale: Accessor<number>;
    /** a tick per scroll: the grid moves under a still pointer when a phone's page turns */
    scrolled: Accessor<number>;
    /** whether `p` is free, not counting the widget `ignoreId` being moved */
    fits: (p: Placement, ignoreId?: string) => boolean;
    /** Home holds as many widgets as it can */
    full: Accessor<boolean>;
    page: Accessor<number>;
    pages: Accessor<number>;
    showPage: (index: number) => void;
    /** a press that didn't drag: a gallery entry goes in the first free spot */
    onAdd: (entry: LibraryEntry) => void;
    /** a press that didn't drag: a tile is selected */
    onSelect: (itemId: string) => void;
    onDropNew: (entry: LibraryEntry, p: Placement) => void;
    onDropMove: (itemId: string, p: Placement) => void;
    /** a widget carried out of the phone's gallery sheet was let go: the sheet closes */
    onSheetDone: () => void;
}

// Carrying a widget across Home with the pointer: from the gallery (a new
// one) or from its tile (a move). It follows the pointer as a ghost over
// the cell it would land on, scrolls Home at its edges and turns a phone's
// page at its sides, and lands where it is let go if it fits there. A
// phone picks a gallery widget up by holding it; the gallery's sheet hides
// (mounted, so the finger's touch keeps its element) until it is let go.
export function createHomeDrag(options: HomeDragOptions) {
    const [drag, setDrag] = createSignal<DragState | null>(null);
    const [sheetConcealed, setSheetConcealed] = createSignal(false);

    const target = createMemo(() => {
        const d = drag();
        // the grid moves under a still pointer when a phone's page turns
        options.scrolled();
        const grid = options.grid();
        if (!d?.started || !grid) return null;
        const g = options.geometry();
        const rect = grid.getBoundingClientRect();
        // the grid may be drawn smaller than it is laid out
        const left = (d.pointer.x - rect.left) / options.scale() - d.grab.x * g.cell;
        const top = (d.pointer.y - rect.top) / options.scale() - d.grab.y * g.cell;
        const p = options.phone() ? snapToPhone(left, top, d.size, options.phoneGeometry()) : snapToGrid(left, top, d.size, g);
        if (!p) return null;
        const ignore = d.source.kind === "move" ? d.source.itemId : undefined;
        const full = d.source.kind === "new" && options.full();
        return { placement: p, valid: !full && options.fits(p, ignore) };
    });

    // a widget held at a page's side turns the page, and keeps turning while it is held there
    let turning = 0;
    let turnTimer: ReturnType<typeof setTimeout> | undefined;
    const turnPage = () => {
        const next = Math.min(options.pages() - 1, Math.max(0, options.page() + turning));
        if (next !== options.page()) {
            haptic("selection");
            options.showPage(next);
        }
        turnTimer = setTimeout(turnPage, PAGE_TURN_MS);
    };

    const onPointerMove = (event: PointerEvent) => {
        const d = drag();
        if (!d) return;
        const pointer = { x: event.clientX, y: event.clientY };
        const started = d.started || Math.hypot(pointer.x - d.start.x, pointer.y - d.start.y) > DRAG_THRESHOLD_PX;
        if (started && !d.started) haptic("lift");
        setDrag({ ...d, pointer, started });
        const scroller = options.scroller();
        if (started && scroller) {
            const bounds = scroller.getBoundingClientRect();
            if (pointer.y > bounds.bottom - AUTOSCROLL_EDGE_PX) scroller.scrollTop += AUTOSCROLL_STEP_PX;
            else if (pointer.y < bounds.top + AUTOSCROLL_EDGE_PX) scroller.scrollTop -= AUTOSCROLL_STEP_PX;
            if (options.phone()) {
                const edge = pointer.x < bounds.left + PAGE_EDGE_PX ? -1 : pointer.x > bounds.right - PAGE_EDGE_PX ? 1 : 0;
                if (edge !== turning) {
                    turning = edge;
                    clearTimeout(turnTimer);
                    if (edge !== 0) turnTimer = setTimeout(turnPage, PAGE_TURN_MS);
                }
            }
        }
    };
    const onPointerUp = () => {
        const d = drag();
        const t = target();
        endDrag();
        if (!d) return;
        if (!d.started) {
            // a press without a drag: library entries add, tiles select
            if (d.source.kind === "new") options.onAdd(d.source.entry);
            else options.onSelect(d.source.itemId);
            return;
        }
        // let go where it can't go: it falls back to where it came from
        if (!t?.valid) {
            haptic("warning");
            return;
        }
        haptic("land");
        if (d.source.kind === "new") options.onDropNew(d.source.entry, t.placement);
        else options.onDropMove(d.source.itemId, t.placement);
    };
    const onDragKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") endDrag();
    };
    // a held finger asks for the page's context menu; Home is carrying something
    const noContextMenu = (event: Event) => event.preventDefault();
    let dragTarget: Element | null = null;
    let dragPointer = -1;
    function endDrag() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", endDrag);
        window.removeEventListener("keydown", onDragKey);
        window.removeEventListener("blur", endDrag);
        window.removeEventListener("contextmenu", noContextMenu);
        if (dragTarget?.hasPointerCapture?.(dragPointer)) dragTarget.releasePointerCapture(dragPointer);
        dragTarget = null;
        clearTimeout(turnTimer);
        turning = 0;
        setDrag(null);
        // a widget carried out of the sheet is placed, or not, on Home; the sheet stays closed
        if (sheetConcealed()) {
            setSheetConcealed(false);
            options.onSheetDone();
        }
    }
    const startDrag = (target: Element, pointerId: number, state: DragState) => {
        endDrag();
        dragTarget = target;
        dragPointer = pointerId;
        // capture keeps the drag ours while the pointer crosses widget frames
        dragTarget.setPointerCapture?.(pointerId);
        setDrag(state);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", endDrag);
        window.addEventListener("keydown", onDragKey);
        window.addEventListener("blur", endDrag);
        window.addEventListener("contextmenu", noContextMenu);
    };

    /** a pointer pressed on a gallery entry or a tile: a drag once it moves, a press if it doesn't */
    const beginDrag = (event: PointerEvent, source: DragSource, name: string, size: WidgetSize, grab: { x: number; y: number }) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const start = { x: event.clientX, y: event.clientY };
        startDrag(event.currentTarget as Element, event.pointerId, { source, name, size, grab, start, pointer: start, started: false });
    };

    // what stops the hold in progress, if one is
    let holding: (() => void) | undefined;
    const cancelHold = () => holding?.();
    /** phones: a finger on a gallery entry picks it up once held still, or adds it when lifted first */
    const holdLibraryEntry = (entry: LibraryEntry, event: PointerEvent) => {
        const size = parseWidgetSize(entry.size);
        if (event.button !== 0 || !size) return;
        // no mouse events follow the touch, so nothing in the closing sheet
        // takes focus from where closing it puts focus; touch-action, not
        // this, decides whether the gallery scrolls
        event.preventDefault();
        cancelHold();
        const target = event.currentTarget as Element;
        const pointerId = event.pointerId;
        const start = { x: event.clientX, y: event.clientY };
        let pointer = start;
        const move = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            pointer = { x: e.clientX, y: e.clientY };
            // moving first is scrolling the gallery
            if (Math.hypot(pointer.x - start.x, pointer.y - start.y) > HOLD_SLOP_PX) cancelHold();
        };
        const up = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            cancelHold();
            // a tap adds it where it fits and shows where
            options.onAdd(entry);
            options.onSheetDone();
        };
        const timer = setTimeout(() => {
            cancelHold();
            haptic("lift");
            setSheetConcealed(true);
            // the ghost hangs from the finger near its top, like picking up a card
            startDrag(target, pointerId, {
                source: { kind: "new", entry },
                name: entry.widget.name,
                size,
                grab: { x: size.w / 2, y: 0.3 },
                start,
                pointer,
                started: true,
            });
        }, HOLD_MS);
        holding = () => {
            clearTimeout(timer);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancelHold);
            window.removeEventListener("contextmenu", noContextMenu);
            holding = undefined;
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancelHold);
        window.addEventListener("contextmenu", noContextMenu);
    };

    /** the tile being carried, which stays in place, faded, until it lands */
    const lifted = (id: string) => {
        const d = drag();
        return !!d?.started && d.source.kind === "move" && d.source.itemId === id;
    };

    /** stops whatever is in progress: a hold, a drag */
    const stop = () => {
        cancelHold();
        endDrag();
    };
    onCleanup(stop);

    return { drag, target, sheetConcealed, beginDrag, holdLibraryEntry, lifted, stop };
}
