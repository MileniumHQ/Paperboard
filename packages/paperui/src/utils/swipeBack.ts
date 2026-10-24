import { createEffect, createSignal, onCleanup } from "solid-js";

// Phone layouts: an open page goes back when it is dragged to the right, like
// iOS's back swipe. A page's top bar and a strip along its left edge are drag
// handles for any pointer. A finger can also start the swipe anywhere on the
// page, unless what it touched has a horizontal gesture of its own (a text
// field, a slider, a scrolled carousel, anything with touch-action that keeps
// pan-x for itself, or [data-paper-no-swipe-back]).
//
// A document with no open page to go back from (a panel's frame showing its
// list) says so with SWIPE_BACK_EVENT on window; PaperAPI forwards that to the
// shell, which drives the page holding the frame with swipeFromFrame.

/** movement before a press counts as a drag rather than a tap */
export const SWIPE_SLOP = 8;
/** share of the page width past which a released drag goes back */
export const SWIPE_DISTANCE = 0.35;
/** px/ms; a flick this fast goes back even if it travelled less */
export const SWIPE_FLICK = 0.5;

/** dispatched on window when a touch swipe has no page here to go back from */
export const SWIPE_BACK_EVENT = "paperui:swipe-back";

export type SwipePhase = "move" | "end" | "cancel";

export interface SwipeBackDetail {
    phase: SwipePhase;
    /** px dragged to the right; never negative */
    dx: number;
    /** px/ms at the latest move */
    velocity: number;
}

/** whether a drag released at `dx` px, moving at `velocity` px/ms, goes back */
export function swipeGoesBack(dx: number, velocity: number, width: number): boolean {
    if (dx <= SWIPE_SLOP) return false;
    return dx >= width * SWIPE_DISTANCE || velocity >= SWIPE_FLICK;
}

interface SwipeTarget {
    el: () => HTMLElement | undefined;
    active: () => boolean;
    width: () => number;
    setOffset: (offset: number | null) => void;
    onBack: () => void;
}

// the open pages of this document; a few per screen, each removed with its page
const targets = new Set<SwipeTarget>();

/** the innermost open page holding `node` */
function targetFor(node: Node): SwipeTarget | undefined {
    let best: SwipeTarget | undefined;
    for (const target of targets) {
        const el = target.el();
        if (!el || !target.active() || !el.contains(node)) continue;
        if (!best || best.el()!.contains(el)) best = target;
    }
    return best;
}

function apply(target: SwipeTarget, detail: SwipeBackDetail) {
    if (detail.phase === "move") {
        target.setOffset(Math.max(0, detail.dx));
        return;
    }
    target.setOffset(null);
    if (detail.phase === "end" && swipeGoesBack(detail.dx, detail.velocity, target.width())) target.onBack();
}

/** a swipe-back message from a panel frame, or null if it isn't one */
export function parseSwipeBack(data: unknown): SwipeBackDetail | null {
    if (!data || typeof data !== "object") return null;
    const { phase, dx, velocity } = data as Record<string, unknown>;
    if (phase !== "move" && phase !== "end" && phase !== "cancel") return null;
    if (typeof dx !== "number" || !Number.isFinite(dx)) return null;
    if (typeof velocity !== "number" || !Number.isFinite(velocity)) return null;
    return { phase, dx: Math.max(0, dx), velocity };
}

/**
 * A swipe a frame's document reported (it had no page of its own to go back
 * from): drives the open page holding `frame`. Returns whether one did.
 */
export function swipeFromFrame(frame: Element, data: unknown): boolean {
    const detail = parseSwipeBack(data);
    const target = detail && targetFor(frame);
    if (!detail || !target) return false;
    apply(target, detail);
    return true;
}

/** whether a touch starting on `start` belongs to that element rather than a back swipe */
function ownsHorizontalTouch(start: Element): boolean {
    if (start.closest("[data-paper-no-swipe-back], [aria-modal=\"true\"]")) return true;
    for (let el: Element | null = start; el && el !== document.documentElement; el = el.parentElement) {
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
        if (el instanceof HTMLInputElement && el.type !== "checkbox" && el.type !== "radio" && el.type !== "button") return true;
        if (el instanceof HTMLElement && el.isContentEditable) return true;
        const style = getComputedStyle(el);
        // touch-action that doesn't pan sideways: the element takes the sideways drag itself
        const touchAction = style.touchAction;
        if (touchAction !== "auto" && touchAction !== "manipulation" && !/pan-(x|left|right)/.test(touchAction)) return true;
        if (el.scrollLeft > 0 && (style.overflowX === "auto" || style.overflowX === "scroll")) return true;
    }
    return false;
}

interface TouchSwipe {
    id: number;
    x: number;
    y: number;
    lastX: number;
    lastT: number;
    velocity: number;
    tracking: boolean;
    /** the page it drives; undefined: reported on window */
    target: SwipeTarget | undefined;
}

let touch: TouchSwipe | null = null;

function report(swipe: TouchSwipe, detail: SwipeBackDetail) {
    if (swipe.target) apply(swipe.target, detail);
    else window.dispatchEvent(new CustomEvent<SwipeBackDetail>(SWIPE_BACK_EVENT, { detail }));
}

function findTouch(e: TouchEvent): Touch | undefined {
    if (!touch) return undefined;
    for (const t of Array.from(e.changedTouches)) if (t.identifier === touch.id) return t;
    return undefined;
}

function onTouchStart(e: TouchEvent) {
    if (touch) {
        // a second finger: not a back swipe
        if (touch.tracking) report(touch, { phase: "cancel", dx: 0, velocity: 0 });
        touch = null;
        return;
    }
    const t = e.touches.length === 1 ? e.touches[0] : undefined;
    if (!t || !(e.target instanceof Element) || ownsHorizontalTouch(e.target)) return;
    touch = { id: t.identifier, x: t.clientX, y: t.clientY, lastX: t.clientX, lastT: e.timeStamp, velocity: 0, tracking: false, target: targetFor(e.target) };
}

function onTouchMove(e: TouchEvent) {
    const t = findTouch(e);
    if (!touch || !t) return;
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    if (!touch.tracking) {
        if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
        // leftward or mostly vertical, or something under the finger took it
        if (dx <= 0 || Math.abs(dy) > Math.abs(dx) || e.defaultPrevented) {
            touch = null;
            return;
        }
        touch.tracking = true;
    }
    // the page moves with the finger, not the page's content under it
    if (e.cancelable) e.preventDefault();
    const dt = e.timeStamp - touch.lastT;
    if (dt > 0) touch.velocity = (t.clientX - touch.lastX) / dt;
    touch.lastX = t.clientX;
    touch.lastT = e.timeStamp;
    report(touch, { phase: "move", dx: Math.max(0, dx), velocity: touch.velocity });
}

function onTouchEnd(e: TouchEvent) {
    const t = findTouch(e);
    if (!touch || !t) return;
    const swipe = touch;
    touch = null;
    if (swipe.tracking) report(swipe, { phase: e.type === "touchcancel" ? "cancel" : "end", dx: Math.max(0, t.clientX - swipe.x), velocity: swipe.velocity });
}

let installs = 0;

/**
 * Starts the document's touch back swipe; PaperProvider calls it. Returns the
 * matching uninstall; the listeners go when the last caller does.
 */
export function installSwipeBack(): () => void {
    if (typeof window === "undefined") return () => undefined;
    if (installs++ === 0) {
        document.addEventListener("touchstart", onTouchStart, { passive: true });
        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", onTouchEnd);
        document.addEventListener("touchcancel", onTouchEnd);
    }
    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        if (--installs > 0) return;
        if (touch?.tracking) report(touch, { phase: "cancel", dx: 0, velocity: 0 });
        touch = null;
        document.removeEventListener("touchstart", onTouchStart);
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", onTouchEnd);
        document.removeEventListener("touchcancel", onTouchEnd);
    };
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
export function createSwipeBack(opts: {
    width: () => number;
    onBack: () => void;
    /** the page; while `active`, a touch anywhere on it can swipe it back */
    el?: () => HTMLElement | undefined;
    active?: () => boolean;
}) {
    const [offset, setOffset] = createSignal<number | null>(null);
    let drag: Drag | null = null;

    const el = opts.el;
    const active = opts.active;
    if (el && active) {
        const target: SwipeTarget = { el, active, width: opts.width, setOffset, onBack: () => opts.onBack() };
        targets.add(target);
        // a page that closes mid-swipe springs back
        createEffect(() => {
            if (!active() && !drag) setOffset(null);
        });
        onCleanup(() => {
            targets.delete(target);
            if (touch?.target === target) touch = null;
        });
    }

    const stopListening = () => {
        // prerendered (no window) a page never listened
        if (typeof window === "undefined") return;
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
