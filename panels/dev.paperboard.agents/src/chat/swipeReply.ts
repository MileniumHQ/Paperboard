// Phones: a bubble dragged toward the middle of the chat is answered, as in
// iMessage. It follows the finger, slower past the point where letting go
// replies; crossing that point gives a little buzz. Only a finger does this:
// a mouse has the reply button. The bubble keeps touch-action: pan-y, so a
// vertical drag still scrolls the chat, and data-paper-no-swipe-back, so a
// sideways drag is the bubble's rather than the page's back swipe.

import { createSignal } from "solid-js";

/** px toward the middle past which letting go replies */
export const REPLY_AT = 56;
/** px a bubble can be dragged at most */
export const MAX_DRAG = 96;
/** movement before a touch counts as a drag rather than a tap */
const SLOP = 8;

/** How far the bubble shows dragged for a finger `dx` px toward the middle: with the finger up to REPLY_AT, then a third as fast. */
export function dragOffset(dx: number): number {
    if (dx <= 0) return 0;
    if (dx <= REPLY_AT) return dx;
    return Math.min(MAX_DRAG, REPLY_AT + (dx - REPLY_AT) / 3);
}

interface Drag {
    id: number;
    x: number;
    y: number;
    tracking: boolean;
    armed: boolean;
}

/**
 * Swipe-to-reply for one bubble. `toward` is the middle's direction (-1: left, for the user's own bubbles on the
 * right). Spread `handlers` on the row; `offset()` is the bubble's signed shift, `progress()` 0 to 1 toward replying.
 */
export function createSwipeReply(o: {
    toward: () => 1 | -1;
    enabled: () => boolean;
    /** the drag just crossed the point where letting go replies: the buzz goes here */
    onArm: () => void;
    onReply: () => void;
}) {
    const [dragged, setDragged] = createSignal(0);
    const [active, setActive] = createSignal(false);
    let drag: Drag | null = null;

    const end = () => {
        drag = null;
        setActive(false);
        setDragged(0);
    };

    const handlers = {
        onPointerDown: (e: PointerEvent) => {
            if (e.pointerType !== "touch" || !e.isPrimary || drag || !o.enabled()) return;
            drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tracking: false, armed: false };
        },
        onPointerMove: (e: PointerEvent) => {
            if (!drag || e.pointerId !== drag.id) return;
            const dx = (e.clientX - drag.x) * o.toward();
            const dy = e.clientY - drag.y;
            if (!drag.tracking) {
                if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
                // away from the middle, or mostly vertical: the chat scrolls instead
                if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
                    end();
                    return;
                }
                drag.tracking = true;
                setActive(true);
            }
            const armed = dx >= REPLY_AT;
            if (armed && !drag.armed) o.onArm();
            drag.armed = armed;
            setDragged(dragOffset(dx));
        },
        onPointerUp: (e: PointerEvent) => {
            if (!drag || e.pointerId !== drag.id) return;
            const reply = drag.tracking && drag.armed;
            end();
            if (reply) o.onReply();
        },
        onPointerCancel: (e: PointerEvent) => {
            if (drag && e.pointerId === drag.id) end();
        },
    };

    return {
        handlers,
        /** a finger is moving the bubble: it follows without easing */
        active,
        offset: () => dragged() * o.toward() || 0, // never -0
        progress: () => Math.min(1, dragged() / REPLY_AT),
    };
}
