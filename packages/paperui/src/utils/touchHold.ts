// A finger held still on something opens its context menu, as a right click
// does. Android's browser fires contextmenu on a long press but iOS's never
// does, so the document does it once for every platform: after HOLD_MS
// without moving it dispatches contextmenu at the finger. When something
// handles it (preventDefault, as every context menu does), the browser's own
// contextmenu for that press and the click its release would make are
// dropped, so the menu opens once and the item under it doesn't also open.

/** how long a still finger is held before it opens the context menu */
export const HOLD_MS = 500;
/** px a finger may wander and still be holding still */
const HOLD_SLOP = 8;

interface Hold {
    id: number;
    target: Element;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout> | undefined;
    /** the dispatched contextmenu was handled: drop what the press does next */
    handled: boolean;
}

let hold: Hold | null = null;
let dispatching = false;

function cancel() {
    if (hold?.timer !== undefined) clearTimeout(hold.timer);
    hold = null;
}

function fire() {
    if (!hold) return;
    hold.timer = undefined;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, clientX: hold.x, clientY: hold.y, button: 2 });
    dispatching = true;
    try {
        hold.target.dispatchEvent(event);
    } finally {
        dispatching = false;
    }
    hold.handled = event.defaultPrevented;
    if (!hold.handled) hold = null;
}

function find(e: TouchEvent): Touch | undefined {
    if (!hold) return undefined;
    for (const t of Array.from(e.changedTouches)) if (t.identifier === hold.id) return t;
    return undefined;
}

function onTouchStart(e: TouchEvent) {
    cancel();
    const t = e.touches.length === 1 ? e.touches[0] : undefined;
    if (!t || !(e.target instanceof Element)) return;
    hold = { id: t.identifier, target: e.target, x: t.clientX, y: t.clientY, timer: setTimeout(fire, HOLD_MS), handled: false };
}

function onTouchMove(e: TouchEvent) {
    const t = find(e);
    if (!hold || !t || hold.handled) return;
    if (Math.abs(t.clientX - hold.x) > HOLD_SLOP || Math.abs(t.clientY - hold.y) > HOLD_SLOP) cancel();
}

function onTouchEnd(e: TouchEvent) {
    if (!find(e) || !hold) return;
    const handled = hold.handled;
    cancel();
    if (!handled) return;
    // the release would click what the menu opened over
    if (e.cancelable) e.preventDefault();
    const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

function onContextMenu(e: MouseEvent) {
    if (dispatching || !hold) return;
    if (hold.handled) {
        // the browser's own long press, after ours opened the menu
        e.preventDefault();
        e.stopImmediatePropagation();
    } else {
        // the browser got there first; it is the one menu
        cancel();
    }
}

let installs = 0;

/** Starts the document's touch hold; PaperProvider calls it. Returns the matching uninstall. */
export function installTouchHold(): () => void {
    if (typeof window === "undefined") return () => undefined;
    if (installs++ === 0) {
        document.addEventListener("touchstart", onTouchStart, { passive: true });
        document.addEventListener("touchmove", onTouchMove, { passive: true });
        document.addEventListener("touchend", onTouchEnd, { passive: false });
        document.addEventListener("touchcancel", cancel);
        window.addEventListener("contextmenu", onContextMenu, { capture: true });
    }
    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        if (--installs > 0) return;
        cancel();
        document.removeEventListener("touchstart", onTouchStart);
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", onTouchEnd);
        document.removeEventListener("touchcancel", cancel);
        window.removeEventListener("contextmenu", onContextMenu, { capture: true });
    };
}
