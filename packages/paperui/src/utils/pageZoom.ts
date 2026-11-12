// A phone app is not a web page: pinching must not zoom the document. The
// viewport stops scaling (maximum-scale=1, user-scalable=no) and the root
// takes only pans, which is what iOS reads where it ignores the viewport.
// Nothing here listens to touches, so a panel's own pinch (a map) still gets
// every one of them: touch-action only narrows what the browser itself does,
// and a pinch the panel handles is its own to read.

const LOCKED = { "maximum-scale": "1", "user-scalable": "no" } as const;

/** a viewport meta's content with the page's zoom switched off */
export function lockedViewport(content: string): string {
    const kept = content
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part && !(part.split("=")[0].trim() in LOCKED));
    return [...kept, ...Object.entries(LOCKED).map(([key, value]) => `${key}=${value}`)].join(", ");
}

let installs = 0;
let restore: (() => void) | null = null;

/**
 * Stops the document from zooming under a pinch; PaperProvider calls it.
 * Returns the matching uninstall.
 */
export function installPageZoomLock(): () => void {
    if (typeof document === "undefined") return () => undefined;
    if (installs++ === 0) {
        const root = document.documentElement;
        const before = root.style.touchAction;
        root.style.touchAction = "pan-x pan-y";
        const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
        const content = meta?.getAttribute("content") ?? null;
        if (meta) meta.setAttribute("content", lockedViewport(content ?? ""));
        restore = () => {
            root.style.touchAction = before;
            if (meta && content !== null) meta.setAttribute("content", content);
        };
    }
    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        if (--installs > 0) return;
        restore?.();
        restore = null;
    };
}
