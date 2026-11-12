import { createSignal, type JSX } from "solid-js";
import { haptic } from "../../utils/haptics";
import { HOLD_SLOP } from "../../utils/touchHold";
import { dismissContextMenus } from "./contextMenuDismiss";

// Drag-to-reorder for a row or column of items, shared by PaperList and
// PaperRail. The dragged item follows the pointer; its siblings slide one
// step to open the gap; release reports the new order of item values.

interface DragState {
    value: string;
    startIndex: number;
    targetIndex: number;
    startCoord: number;
    currentCoord: number;
    itemSize: number;
    gap: number;
    currentValues: string[];
}

export interface ReorderOptions {
    container: () => HTMLElement | undefined;
    /** matches the reorderable items, in DOM order */
    itemSelector: string;
    /** the attribute on each item that holds its value */
    valueAttribute: string;
    horizontal: () => boolean;
    onReorder: () => ((newOrderValues: string[]) => void) | undefined;
}

export interface ReorderStartOptions {
    /**
     * Milliseconds the pointer must stay still before the item lifts and can
     * be dragged; moving sooner lets the gesture go (a finger scrolls).
     * Without it the item drags as soon as the pointer moves.
     */
    holdMs?: number;
}

export interface Reorder {
    start: (value: string | number, e: PointerEvent, options?: ReorderStartOptions) => void;
    itemStyle: (value: string | number) => JSX.CSSProperties;
    isDragging: (value: string | number) => boolean;
    /** held long enough to lift, or being dragged */
    isLifted: (value: string | number) => boolean;
    /** a held item is lifted: a touch move must drag it, not scroll the page */
    blocksScroll: () => boolean;
    hasActiveDrag: () => boolean;
    isDropping: () => boolean;
    /** true for the click that ends a drag, which must not also select */
    justDragged: () => boolean;
}

// a pointer that moves less than this is a click, not a drag
const DRAG_THRESHOLD = 6;

export function createReorder(options: ReorderOptions): Reorder {
    const [dragState, setDragState] = createSignal<DragState | null>(null);
    const [isDropping, setIsDropping] = createSignal(false);
    const [liftedValue, setLiftedValue] = createSignal<string | null>(null);
    let justFinishedDrag = false;

    const start = (value: string | number, e: PointerEvent, startOptions: ReorderStartOptions = {}) => {
        const container = options.container();
        if (e.button !== 0 || !container) return;

        const valStr = String(value);
        const itemEls = Array.from(
            container.querySelectorAll<HTMLElement>(options.itemSelector),
        );
        const currentValues = itemEls.map(
            (el) => el.getAttribute(options.valueAttribute) ?? "",
        );
        const startIndex = currentValues.indexOf(valStr);
        if (startIndex < 0) return;

        const horiz = options.horizontal();
        const rect = itemEls[startIndex].getBoundingClientRect();
        const itemSize = horiz ? rect.width : rect.height;
        let gap = 0;
        if (itemEls.length > 1) {
            const nextIdx = startIndex === itemEls.length - 1 ? startIndex - 1 : startIndex + 1;
            const nextRect = itemEls[nextIdx].getBoundingClientRect();
            const diff = horiz
                ? Math.abs(nextRect.left - rect.left)
                : Math.abs(nextRect.top - rect.top);
            gap = Math.max(0, diff - itemSize);
        }

        const startCoord = horiz ? e.clientX : e.clientY;
        const startX = e.clientX;
        const startY = e.clientY;
        let didDrag = false;
        // without a hold the item is free to move at once
        let lifted = startOptions.holdMs === undefined;
        const holdTimer = lifted
            ? undefined
            : setTimeout(() => {
                  lifted = true;
                  setLiftedValue(valStr);
              }, startOptions.holdMs);
        const targetEl = e.currentTarget as HTMLElement;
        try {
            targetEl.setPointerCapture(e.pointerId);
        } catch (err) {
            console.debug("[PaperUI reorder] pointer capture failed:", err);
        }

        const handlePointerMove = (ev: PointerEvent) => {
            if (ev.pointerId !== e.pointerId) return;
            if (!lifted) {
                // moved before the hold lifted it: not a reorder after all
                if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > HOLD_SLOP) {
                    cleanup();
                    try {
                        targetEl.releasePointerCapture(ev.pointerId);
                    } catch (err) {
                        console.debug("[PaperUI reorder] pointer capture release failed:", err);
                    }
                }
                return;
            }
            const currentCoord = horiz ? ev.clientX : ev.clientY;
            const delta = currentCoord - startCoord;
            if (!didDrag && Math.abs(delta) < DRAG_THRESHOLD) return;
            if (!didDrag) {
                // carried, not chosen: a menu the hold opened goes away
                dismissContextMenus();
                if (startOptions.holdMs !== undefined) haptic("lift");
            }
            didDrag = true;

            const stepSize = itemSize + gap;
            const steps = stepSize > 0 ? Math.round(delta / stepSize) : 0;
            const targetIndex = Math.max(0, Math.min(itemEls.length - 1, startIndex + steps));
            setDragState({
                value: valStr,
                startIndex,
                targetIndex,
                startCoord,
                currentCoord,
                itemSize,
                gap,
                currentValues,
            });
        };

        const cleanup = () => {
            clearTimeout(holdTimer);
            setLiftedValue(null);
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
        };

        const finish = (ev: PointerEvent) => {
            if (ev.pointerId !== e.pointerId) return;
            try {
                targetEl.releasePointerCapture(ev.pointerId);
            } catch (err) {
                console.debug("[PaperUI reorder] pointer capture release failed:", err);
            }
            const wasHeld = lifted && startOptions.holdMs !== undefined;
            cleanup();

            // an item held and put back down was not tapped
            if (wasHeld && !didDrag) {
                justFinishedDrag = true;
                setTimeout(() => {
                    justFinishedDrag = false;
                }, 50);
            }
            const state = dragState();
            if (!state) return;
            if (didDrag) {
                justFinishedDrag = true;
                setTimeout(() => {
                    justFinishedDrag = false;
                }, 50);
            }
            // a cancelled gesture (the browser took it to scroll) never commits
            const onReorder = options.onReorder();
            if (ev.type === "pointerup" && didDrag && state.startIndex !== state.targetIndex && onReorder) {
                setIsDropping(true);
                const newOrder = [...state.currentValues];
                const [moved] = newOrder.splice(state.startIndex, 1);
                newOrder.splice(state.targetIndex, 0, moved);
                onReorder(newOrder);
                setDragState(null);
                setTimeout(() => setIsDropping(false), 50);
            } else {
                setDragState(null);
            }
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
    };

    const itemStyle = (value: string | number): JSX.CSSProperties => {
        const ds = dragState();
        if (!ds) return {};
        const valStr = String(value);
        const horiz = options.horizontal();
        const itemIdx = ds.currentValues.indexOf(valStr);
        if (itemIdx < 0) return {};
        const translate = (px: number) =>
            horiz ? `translate3d(${px}px, 0, 0)` : `translate3d(0, ${px}px, 0)`;

        if (valStr === ds.value) {
            return { transform: translate(ds.currentCoord - ds.startCoord) };
        }
        const stepSize = ds.itemSize + ds.gap;
        let shift = 0;
        if (ds.startIndex < ds.targetIndex && itemIdx > ds.startIndex && itemIdx <= ds.targetIndex) {
            shift = -stepSize;
        } else if (ds.startIndex > ds.targetIndex && itemIdx >= ds.targetIndex && itemIdx < ds.startIndex) {
            shift = stepSize;
        }
        return shift ? { transform: translate(shift) } : {};
    };

    return {
        start,
        itemStyle,
        isDragging: (value) => dragState()?.value === String(value),
        isLifted: (value) => liftedValue() === String(value) || dragState()?.value === String(value),
        blocksScroll: () => liftedValue() !== null || dragState() !== null,
        hasActiveDrag: () => dragState() !== null,
        isDropping,
        justDragged: () => justFinishedDrag,
    };
}
