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

type Rgba = [number, number, number, number];

function parse(color: string): Rgba | null {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(color);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

/**
 * The color showing at the middle of this document's bottom edge: the first
 * opaque background under it, with any translucent layers above that (a
 * modal's scrim) laid over it.
 */
export function bottomEdgeColor(): string | null {
    if (typeof document === "undefined") return null;
    const layers: Rgba[] = [];
    const chain: Element[] = [];
    for (let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1); el; el = el.parentElement) chain.push(el);
    for (const root of [document.body, document.documentElement]) if (root && !chain.includes(root)) chain.push(root);
    for (const el of chain) {
        const color = parse(getComputedStyle(el).backgroundColor);
        if (!color || color[3] === 0) continue;
        if (color[3] < 1) {
            layers.push(color);
            continue;
        }
        let [r, g, b] = color;
        // the nearest layer is the last laid on
        for (const [lr, lg, lb, la] of layers.reverse()) {
            r = lr * la + r * (1 - la);
            g = lg * la + g * (1 - la);
            b = lb * la + b * (1 - la);
        }
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
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
