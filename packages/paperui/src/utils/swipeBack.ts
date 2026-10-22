import { createSignal, onCleanup } from "solid-js";

// Phone layouts: an open page goes back when it is dragged to the right, like
// iOS's back swipe. Only the page's top bar and a strip along its left edge
// start the drag; the page's content keeps its own horizontal gestures (and
// in Paperboard's shell, a panel's iframe keeps all of its pointer events).

/** movement before a press counts as a drag rather than a tap */
export const SWIPE_SLOP = 8;
/** share of the page width past which a released drag goes back */
export const SWIPE_DISTANCE = 0.35;
/** px/ms; a flick this fast goes back even if it travelled less */
export const SWIPE_FLICK = 0.5;

/** whether a drag released at `dx` px, moving at `velocity` px/ms, goes back */
export function swipeGoesBack(dx: number, velocity: number, width: number): boolean {
    if (dx <= SWIPE_SLOP) return false;
    return dx >= width * SWIPE_DISTANCE || velocity >= SWIPE_FLICK;
}

interface Drag {
    pointerId: number;
    el: HTMLElement;
    x: number;
    y: number;
    lastX: number;
    lastT: number;
    velocity: number;
    tracking: boolean;
}

/**
 * Drag-to-go-back for one page. `offset()` is how far the page is dragged
 * (null when it isn't); spread `onPointerDown` on each drag handle.
 */
export function createSwipeBack(opts: { width: () => number; onBack: () => void }) {
    const [offset, setOffset] = createSignal<number | null>(null);
    let drag: Drag | null = null;

    const stopListening = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
    };

    const end = () => {
        stopListening();
        drag = null;
        setOffset(null);
    };

    // a drag that started on the back button must not also click it
    const swallowNextClick = () => {
        const swallow = (e: MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };

    function onMove(e: PointerEvent) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.tracking) {
            if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
            // leftward or mostly vertical: not a back swipe
            if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
                end();
                return;
            }
            drag.tracking = true;
            // a mouse leaving the handle (over a panel iframe) keeps reporting
            if (drag.el.isConnected) drag.el.setPointerCapture(e.pointerId);
        }
        const dt = e.timeStamp - drag.lastT;
        if (dt > 0) drag.velocity = (e.clientX - drag.lastX) / dt;
        drag.lastX = e.clientX;
        drag.lastT = e.timeStamp;
        setOffset(Math.max(0, dx));
    }

    function onUp(e: PointerEvent) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const { tracking, velocity } = drag;
        const dx = e.clientX - drag.x;
        end();
        if (!tracking) return;
        swallowNextClick();
        if (swipeGoesBack(dx, velocity, opts.width())) opts.onBack();
    }

    function onCancel(e: PointerEvent) {
        if (drag && e.pointerId === drag.pointerId) end();
    }

    const onPointerDown = (e: PointerEvent) => {
        if (drag || !e.isPrimary || e.button !== 0) return;
        drag = {
            pointerId: e.pointerId,
            el: e.currentTarget as HTMLElement,
            x: e.clientX,
            y: e.clientY,
            lastX: e.clientX,
            lastT: e.timeStamp,
            velocity: 0,
            tracking: false,
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
    };

    onCleanup(end);

    return { offset, onPointerDown };
}
