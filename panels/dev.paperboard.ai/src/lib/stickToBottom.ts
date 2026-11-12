// Keeps a scroller pinned to its bottom while its content changes (see
// core/scroll.ts). The elements come in through refs, so a scroller that is
// unmounted and mounted again (Settings opened and closed) is observed anew;
// observers and the scroll listener go with the element or the owner.

import { createEffect, createSignal, onCleanup } from "solid-js";
import { pinnedAfterScroll } from "../core/scroll";

export function createStickToBottom() {
    const [scroller, setScroller] = createSignal<HTMLElement>();
    const [content, setContent] = createSignal<HTMLElement>();
    let pinned = true;
    let lastTop = 0;

    const pin = () => {
        const el = scroller();
        if (!el || !pinned) return;
        el.scrollTop = el.scrollHeight;
        lastTop = el.scrollTop;
    };

    createEffect(() => {
        const el = scroller();
        const inner = content();
        if (!el || !inner) return;
        const onScroll = () => {
            pinned = pinnedAfterScroll(pinned, lastTop, el);
            lastTop = el.scrollTop;
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        // sizes: streamed text, a tool card opening, the window or composer resizing
        const resize = new ResizeObserver(pin);
        resize.observe(el);
        resize.observe(inner);
        // nodes: a new message, a tool call or a permission request, even before it has a size
        const mutations = new MutationObserver(pin);
        mutations.observe(inner, { childList: true, subtree: true, characterData: true });
        lastTop = el.scrollTop;
        pin();
        onCleanup(() => {
            el.removeEventListener("scroll", onScroll);
            resize.disconnect();
            mutations.disconnect();
        });
    });

    return {
        scrollerRef: (el: HTMLElement) => setScroller(() => el),
        contentRef: (el: HTMLElement) => setContent(() => el),
        /** pins the view again (a chat opened, a message sent) and scrolls to the bottom */
        stick: () => {
            pinned = true;
            pin();
        },
        /** scrolls to the bottom if the view is pinned */
        pin,
    };
}
