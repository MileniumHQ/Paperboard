// A panel frame stops above a phone's home indicator, and the shell fills
// the strip below it. So the strip reads as the panel's own, a framed
// document reports the color showing along its bottom edge
// (FRAME_BACKGROUND_EVENT on window; PaperAPI forwards it), whenever that
// changes: a page opening, the theme turning.

/** dispatched on window in a framed document when its bottom edge's color changes */
export const FRAME_BACKGROUND_EVENT = "paperui:frame-background";

export interface FrameBackgroundDetail {
    /** a computed CSS color, rgb() or rgba() */
    color: string;
}

/** how often a framed document looks again, beside the moments it knows of */
const LOOK_MS = 1000;

function opaque(color: string): boolean {
    if (!color || color === "transparent") return false;
    const alpha = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\s*\)$/.exec(color);
    return !alpha || Number(alpha[1]) >= 1;
}

/** the color showing at the middle of this document's bottom edge */
export function bottomEdgeColor(): string | null {
    if (typeof document === "undefined") return null;
    let el: Element | null = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);
    for (; el; el = el.parentElement) {
        const color = getComputedStyle(el).backgroundColor;
        if (opaque(color)) return color;
    }
    for (const root of [document.body, document.documentElement]) {
        const color = root ? getComputedStyle(root).backgroundColor : "";
        if (opaque(color)) return color;
    }
    return null;
}

let installs = 0;
let stop: (() => void) | null = null;

/**
 * Starts reporting a framed document's bottom edge color; PaperProvider
 * calls it. Returns the matching uninstall. A top-level document reports
 * nothing.
 */
export function installFrameBackground(): () => void {
    if (typeof window === "undefined" || window.parent === window) return () => undefined;
    if (installs++ === 0) {
        let reported = "";
        const look = () => {
            const color = bottomEdgeColor();
            if (!color || color === reported) return;
            reported = color;
            window.dispatchEvent(new CustomEvent<FrameBackgroundDetail>(FRAME_BACKGROUND_EVENT, { detail: { color } }));
        };
        // a tap usually opens or closes something: look once it has moved
        let soon: ReturnType<typeof setTimeout> | undefined;
        const lookSoon = () => {
            clearTimeout(soon);
            soon = setTimeout(look, 400);
        };
        const frame = requestAnimationFrame(look);
        const timer = setInterval(look, LOOK_MS);
        window.addEventListener("resize", lookSoon);
        window.addEventListener("click", lookSoon, true);
        stop = () => {
            cancelAnimationFrame(frame);
            clearInterval(timer);
            clearTimeout(soon);
            window.removeEventListener("resize", lookSoon);
            window.removeEventListener("click", lookSoon, true);
        };
    }
    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        if (--installs > 0) return;
        stop?.();
        stop = null;
    };
}
