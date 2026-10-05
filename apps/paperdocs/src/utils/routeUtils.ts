import { type Component } from "solid-js";
import type { Page } from "../types/docs";
import {
    allPagesFor,
    firstPageFor,
    isKnownSection,
    metaSections,
    sectionKeys,
    siblingsFor,
    subsectionsFor,
} from "../docs/structure";
import type { PageSiblings } from "../docs/structure";

// Route data helpers. There is no client-side router: every navigation is a
// full document load (real anchor links / window.location), and the app derives
// the current route from window.location at boot. The pure structure helpers
// live in ../docs/structure so non-Vite consumers can read them.

export {
    allPagesFor,
    firstPageFor,
    isKnownSection,
    metaSections,
    sectionKeys,
    siblingsFor,
    subsectionsFor,
};
export type { PageSiblings };

// Every docs page is pulled into the bundle eagerly. The docs app is small and
// fully navigated by document loads, so there is no lazy chunk to suspend on.
const docModules = import.meta.glob<{ default: Component }>(
    "../docs/*/*/*.tsx",
    { eager: true },
);

export function docComponentFor(
    section: string,
    page: Page,
): Component | null {
    const key = `../docs/${section}/${page.subKey}/${page.file}.tsx`;
    return docModules[key]?.default ?? null;
}

export type RouteKind = "docsLanding" | "section" | "docs" | "notFound";

export interface ResolvedRoute {
    kind: RouteKind;
    section?: string;
    pageKey?: string;
}

// Resolve a document path against the deployed URLs. The docs app is mounted
// only under /docs; every other path belongs to the prerendered root site and
// reports notFound here.
export function resolveRoute(
    pathname: string = window.location.pathname,
): ResolvedRoute {
    const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
    const segments = path
        .split("/")
        .filter(Boolean)
        .map((p) => p.toLowerCase());

    if (segments[0] !== "docs") return { kind: "notFound" };
    if (segments.length === 1) return { kind: "docsLanding" };
    if (!isKnownSection(segments[1])) return { kind: "notFound" };
    if (segments.length === 2) return { kind: "section", section: segments[1] };
    return { kind: "docs", section: segments[1], pageKey: segments[2] };
}
