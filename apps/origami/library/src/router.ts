// The library's two pages are real URLs: `/library/` is the grid and
// `/library/?panel=<id>` is a panel's page. A query string rather than a
// path keeps every page a hit on the one static index.html, so a shared
// link, a reload and the embedded iframe all land on the same document
// without teaching Origami's asset routing about client routes.
import { createSignal, onCleanup } from "solid-js";
import { isPanelId } from "../../../../packages/paperapi/src/panelIdentity";

export const PANEL_QUERY = "panel";

/** Panel id named by a location's query, or null for the grid (invalid ids included). */
export function panelIdFromSearch(search: string): string | null {
    const id = new URLSearchParams(search).get(PANEL_QUERY);
    return isPanelId(id) ? id : null;
}

/** Relative href for a panel's page, or the grid when id is null. */
export function panelHref(id: string | null): string {
    return id ? `?${PANEL_QUERY}=${encodeURIComponent(id)}` : "./";
}

export interface LibraryRoute {
    panelId: () => string | null;
    navigate: (id: string | null) => void;
}

/** Must be created inside a reactive owner: the popstate listener is torn down with it. */
export function createLibraryRoute(): LibraryRoute {
    const [panelId, setPanelId] = createSignal(
        panelIdFromSearch(window.location.search),
    );

    const onPopState = () => setPanelId(panelIdFromSearch(window.location.search));
    window.addEventListener("popstate", onPopState);
    onCleanup(() => window.removeEventListener("popstate", onPopState));

    return {
        panelId,
        navigate(id) {
            if (id === panelId()) return;
            const url = new URL(panelHref(id), window.location.href);
            window.history.pushState(null, "", url);
            setPanelId(id);
        },
    };
}
