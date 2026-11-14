import { type Accessor, createEffect, createSignal, on, onCleanup, untrack } from "solid-js";

// A tile scrolled out of view keeps its frame this long, so scrolling back
// is instant; after it, the frame (and its process, if it was the panel's
// last) is released.
const OFFSCREEN_UNLOAD_MS = 30_000;
// Hidden Home keeps its frames (≈0 CPU while hidden) this long, then
// releases them until Home is shown again.
const HIDDEN_SUSPEND_MS = 5 * 60_000;

export interface HomeFrames {
    /** the tile `id` is drawn in `el`: its frame lives while it is in view */
    observe(id: string, el: HTMLDivElement): void;
    /** the tile's element, once drawn */
    element(id: string): HTMLDivElement | undefined;
    /** starts watching the tiles against `scroller`, Home's scrolling area; stops with Home */
    attach(scroller: HTMLElement): void;
    /** the tile is in view, or near it */
    inView(id: string): boolean;
    /** the tile's frame is loaded: in view, or out of it only for a little while */
    live(id: string): boolean;
    /** Home has been hidden long enough that every frame is released */
    suspended: Accessor<boolean>;
}

// How long each placed widget's frame lives: while its tile is in view or
// near it (a phone's neighbouring pages count as near, so a swipe finds them
// ready), a while after it leaves, and a while after Home is hidden.
export function createHomeFrames(options: { ids: Accessor<string[]>; visible: Accessor<boolean>; phone: Accessor<boolean> }): HomeFrames {
    const tileElements = new Map<string, HTMLDivElement>();
    const [inView, setInView] = createSignal<Record<string, boolean>>({});
    const [recentlyInView, setRecentlyInView] = createSignal<Record<string, boolean>>({});
    const [suspended, setSuspended] = createSignal(false);
    let observer: IntersectionObserver | undefined;

    const observe = (id: string, el: HTMLDivElement) => {
        const previous = tileElements.get(id);
        if (previous === el) return;
        if (previous) observer?.unobserve(previous);
        tileElements.set(id, el);
        observer?.observe(el);
    };

    const attach = (scroller: HTMLElement) => {
        observer = new IntersectionObserver(
            (entries) => {
                // a hidden Home reports every tile as out of view; that is
                // the suspend timer's business, not the scroll unloader's
                if (!options.visible()) return;
                setInView((prev) => {
                    const next = { ...prev };
                    for (const entry of entries) {
                        const id = (entry.target as HTMLElement).dataset.homeItem;
                        if (id) next[id] = entry.isIntersecting;
                    }
                    return next;
                });
            },
            { root: scroller, rootMargin: options.phone() ? "0px 100%" : "50% 0px" },
        );
        for (const el of tileElements.values()) observer.observe(el);
        onCleanup(() => observer?.disconnect());
    };

    // a tile that leaves the view keeps its frame for a while, then lets go
    const offscreenTimers = new Map<string, ReturnType<typeof setTimeout>>();
    createEffect(on([inView, options.ids], ([now, list]) => {
        const ids = new Set(list);
        for (const [id, timer] of offscreenTimers) {
            if (now[id] || !ids.has(id)) {
                clearTimeout(timer);
                offscreenTimers.delete(id);
            }
        }
        const recent = untrack(recentlyInView);
        const next: Record<string, boolean> = {};
        for (const id of ids) {
            if (now[id]) next[id] = true;
            else if (recent[id]) {
                next[id] = true;
                if (!offscreenTimers.has(id)) {
                    offscreenTimers.set(id, setTimeout(() => {
                        offscreenTimers.delete(id);
                        setRecentlyInView((prev) => {
                            const copy = { ...prev };
                            delete copy[id];
                            return copy;
                        });
                    }, OFFSCREEN_UNLOAD_MS));
                }
            }
        }
        setRecentlyInView(next);
    }));

    let suspendTimer: ReturnType<typeof setTimeout> | undefined;
    createEffect(on(options.visible, (visible) => {
        clearTimeout(suspendTimer);
        if (visible) setSuspended(false);
        else suspendTimer = setTimeout(() => setSuspended(true), HIDDEN_SUSPEND_MS);
    }));

    // forget tiles that are gone, so the maps stay as big as the layout
    createEffect(on(options.ids, (list) => {
        const ids = new Set(list);
        for (const [id, el] of tileElements) {
            if (!ids.has(id)) {
                observer?.unobserve(el);
                tileElements.delete(id);
            }
        }
        setInView((prev) => {
            const next: Record<string, boolean> = {};
            for (const id of ids) if (prev[id]) next[id] = true;
            return next;
        });
    }));

    onCleanup(() => {
        clearTimeout(suspendTimer);
        for (const timer of offscreenTimers.values()) clearTimeout(timer);
        offscreenTimers.clear();
        tileElements.clear();
    });

    return {
        observe,
        element: (id) => tileElements.get(id),
        attach,
        inView: (id) => !!inView()[id],
        live: (id) => !!recentlyInView()[id] && !suspended(),
        suspended,
    };
}
