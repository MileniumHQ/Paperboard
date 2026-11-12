import { FRAME_INSETS_MESSAGE, type FrameInsetsMessage } from "@mileniumhq/paperapi";

// How much of a panel frame's foot the screen's bottom covers: a phone's home
// indicator, or its keyboard. Frames may run to the screen's edge (the shell
// doesn't pad them), and a framed document can't see the screen's insets, so
// the shell measures them against where the frame ends and says so.

/**
 * Pixels at the foot of a frame that sit in the bottom safe area: the safe
 * area's height less the room left between the frame and the viewport's foot.
 */
export function frameBottomInset(safeArea: number, viewportBottom: number, frameBottom: number): number {
    return Math.max(0, Math.round(safeArea - Math.max(0, viewportBottom - frameBottom)));
}

/**
 * Tells `frame`'s document its bottom inset now and whenever it changes, until
 * the returned stop is called. `probe` is an element pinned to the viewport's
 * bottom edge, as tall as PaperUI's bottom safe area. `send` again after the
 * frame loads a new document, which has been told nothing.
 */
export function watchFrameInsets(
    frame: HTMLIFrameElement,
    probe: HTMLElement,
    generation: () => string,
): { send: () => void; stop: () => void } {
    let sent: number | null = null;
    const measure = () =>
        frameBottomInset(probe.getBoundingClientRect().height, document.documentElement.clientHeight, frame.getBoundingClientRect().bottom);
    const post = (bottom: number) => {
        const message: FrameInsetsMessage = { type: FRAME_INSETS_MESSAGE, generation: generation(), bottom };
        frame.contentWindow?.postMessage(message, "*");
    };
    const look = () => {
        const bottom = measure();
        if (bottom === sent) return;
        sent = bottom;
        post(bottom);
    };
    const observer = new ResizeObserver(look);
    observer.observe(frame);
    observer.observe(probe);
    return {
        send: () => {
            sent = measure();
            post(sent);
        },
        stop: () => observer.disconnect(),
    };
}
