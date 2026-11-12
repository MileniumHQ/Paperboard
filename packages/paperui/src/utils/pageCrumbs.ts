import { createEffect, onCleanup } from "solid-js";

// A phone layout's open pages, outermost first. In a framed document (a
// panel) they are reported on window (PAGE_CRUMBS_EVENT) so the shell holding
// the frame can name them in its own top bar: "Game Server › My Server ›
// Overview". A shell that does marks the document [data-paper-host-bars], and
// the frame's pages draw no bar of their own; the shell's Back goes back
// through them first ("paperboard:back", see navigationBack).

/** dispatched on window in a framed document when its open pages change */
export const PAGE_CRUMBS_EVENT = "paperui:page-crumbs";

/** set on the root by a host that draws the frame's page bars itself */
export const HOST_BARS_ATTRIBUTE = "data-paper-host-bars";

export interface PageCrumbsDetail {
    /** the open pages' titles, outermost first */
    titles: string[];
}

interface Crumb {
    title: () => string;
}

// in the order the pages opened, which is outermost first
const crumbs: Crumb[] = [];

function report() {
    if (typeof window === "undefined" || window.parent === window) return;
    const titles = crumbs.map((crumb) => crumb.title());
    window.dispatchEvent(new CustomEvent<PageCrumbsDetail>(PAGE_CRUMBS_EVENT, { detail: { titles } }));
}

/** the titles of the open pages, outermost first */
export function pageCrumbs(): string[] {
    return crumbs.map((crumb) => crumb.title());
}

/**
 * Records an open page while `active`, by its title. PaperSlidePage calls it;
 * a page that changes its title reports again.
 */
export function createPageCrumb(active: () => boolean, title: () => string): void {
    createEffect(() => {
        if (!active()) return;
        const crumb: Crumb = { title };
        crumbs.push(crumb);
        onCleanup(() => {
            const index = crumbs.indexOf(crumb);
            if (index !== -1) crumbs.splice(index, 1);
            report();
        });
    });
    // a title change, or a page opening, is reported once its effects settle
    createEffect(() => {
        if (!active()) return;
        title();
        queueMicrotask(report);
    });
}
