// A finger that presses a control and slides off it before lifting doesn't
// press it, like a native button: while it's off, the control is marked
// [data-paper-press-out] (and looks unpressed), and lifting there swallows
// the click. Sliding back on presses it again. A press the page scrolls away
// with is the browser's to cancel (pointercancel).

/** px past a control's edge that still count as on it: a finger is wide */
export const PRESS_SLOP = 24;

const PRESSABLE = 'button, a[href], label, summary, [role="button"], [role="switch"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="checkbox"], [role="radio"]';

/** whether a pointer at (x, y) has left `el`, slop included */
export function pressedOutside(el: Element, x: number, y: number): boolean {
    const r = el.getBoundingClientRect();
    return x < r.left - PRESS_SLOP || x > r.right + PRESS_SLOP || y < r.top - PRESS_SLOP || y > r.bottom + PRESS_SLOP;
}

interface Press {
    id: number;
    el: Element;
    out: boolean;
}

let press: Press | null = null;

function mark(el: Element, out: boolean) {
    if (out) el.setAttribute("data-paper-press-out", "");
    else el.removeAttribute("data-paper-press-out");
}

function onDown(e: PointerEvent) {
    if (e.pointerType !== "touch" || !e.isPrimary) return;
    const el = e.target instanceof Element ? e.target.closest(PRESSABLE) : null;
    press = el ? { id: e.pointerId, el, out: false } : null;
}

function onMove(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    const out = pressedOutside(press.el, e.clientX, e.clientY);
    if (out === press.out) return;
    press.out = out;
    mark(press.el, out);
}

// the click a lifted-off press would still send
function swallowClick() {
    const swallow = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    // a lift off a control that sends no click must not eat the next one
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
}

function onUp(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    const { el } = press;
    const out = pressedOutside(el, e.clientX, e.clientY);
    press = null;
    mark(el, false);
    if (out && e.type === "pointerup") swallowClick();
}

let installs = 0;

/**
 * Starts cancelling presses that slide off; PaperProvider calls it. Returns
 * the matching uninstall; the listeners go when the last caller does.
 */
export function installPressCancel(): () => void {
    if (typeof window === "undefined") return () => undefined;
    if (installs++ === 0) {
        document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
        document.addEventListener("pointermove", onMove, { capture: true, passive: true });
        document.addEventListener("pointerup", onUp, { capture: true });
        document.addEventListener("pointercancel", onUp, { capture: true });
    }
    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        if (--installs > 0) return;
        if (press) mark(press.el, false);
        press = null;
        document.removeEventListener("pointerdown", onDown, { capture: true });
        document.removeEventListener("pointermove", onMove, { capture: true });
        document.removeEventListener("pointerup", onUp, { capture: true });
        document.removeEventListener("pointercancel", onUp, { capture: true });
    };
}
