import { type Accessor, createSignal } from "solid-js";

export interface PhonePagesOptions {
    phone: Accessor<boolean>;
    scroller: () => HTMLElement | undefined;
    pageWidth: Accessor<number>;
    pages: Accessor<number>;
    /** a widget is being carried: the sheet's own scrolling stops */
    carrying: Accessor<boolean>;
}

// A phone's Home: pages side by side that a swipe turns, and the gallery as
// a sheet raised by Edit Home. A widget held in the sheet is carried out of
// it onto Home (homeDrag.ts).
export function createPhonePages(options: PhonePagesOptions) {
    const [sheetOpen, setSheetOpen] = createSignal(false);
    // the page on screen, and a tick per scroll for what moves with it
    const [page, setPage] = createSignal(0);
    const [scrolled, setScrolled] = createSignal(0);
    // Add widgets, which raises the sheet again, and where focus returns when it closes
    let addButton: HTMLButtonElement | undefined;

    const closeSheet = () => {
        if (!sheetOpen()) return;
        setSheetOpen(false);
        queueMicrotask(() => addButton?.focus());
    };
    // a carried widget must not scroll the gallery it came from: only a
    // non-passive listener on the touched element can stop that
    const holdSheetScroll = (el: HTMLElement) => {
        el.addEventListener("touchmove", (e) => { if (options.carrying()) e.preventDefault(); }, { passive: false });
    };
    const onScroll = () => {
        setScrolled((n) => n + 1);
        const scroller = options.scroller();
        if (options.phone() && scroller && options.pageWidth() > 0) {
            setPage(Math.min(options.pages() - 1, Math.round(scroller.scrollLeft / options.pageWidth())));
        }
    };
    const showPage = (index: number) => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        options.scroller()?.scrollTo({ left: index * options.pageWidth(), behavior: reduce ? "auto" : "smooth" });
    };

    return {
        sheetOpen,
        openSheet: () => setSheetOpen(true),
        closeSheet,
        /** closes the sheet without handing focus back, as leaving editing does */
        dropSheet: () => setSheetOpen(false),
        page,
        scrolled,
        holdSheetScroll,
        onScroll,
        showPage,
        addButtonRef: (el: HTMLButtonElement) => (addButton = el),
    };
}
