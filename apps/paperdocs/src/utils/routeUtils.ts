import { type Component } from "solid-js";
import index from "../docs/index.json";
import type { Page, SectionMeta, Subsection } from "../types/docs";
import { BASE } from "./base";

// Route data helpers. There is no client-side router: every navigation is a
// full document load (real anchor links / window.location), and the app derives
// the current route from window.location at boot.

export const metaSections: Record<string, SectionMeta> =
    (index as any).meta?.sections || {};
export const sectionKeys = Object.keys(metaSections);

export function isKnownSection(section: string | undefined): boolean {
    return (
        !!section &&
        Object.prototype.hasOwnProperty.call(metaSections, section)
    );
}

export function subsectionsFor(section: string): Subsection[] {
    const data = (index as any)[section] || {};
    return Object.entries<any>(data.subsections || {}).map(([subKey, sub]) => {
        const rawPages = Object.entries<any>(sub.pages || {}).map(
            ([pKey, p]) => ({
                pageKey: pKey,
                name: p.name || pKey,
                file: p.file || pKey,
                subKey,
                index: p.index ?? 0,
            }),
        );

        const pages =
            sub.sort === "alphabetical"
                ? rawPages.sort((a, b) => a.name.localeCompare(b.name))
                : rawPages.sort((a, b) => a.index - b.index);

        return { key: subKey, name: sub.name, icon: sub.icon, pages };
    });
}

export function allPagesFor(section: string): Page[] {
    return subsectionsFor(section).flatMap((s) => s.pages);
}

export function firstPageFor(section: string): Page | null {
    return allPagesFor(section)[0] ?? null;
}

export interface PageSiblings {
    current: Page | null;
    prev: Page | null;
    next: Page | null;
}

export function siblingsFor(
    section: string,
    pageKey: string | undefined,
): PageSiblings {
    const pages = allPagesFor(section);
    const i = pages.findIndex((p) => p.pageKey === pageKey);
    return {
        current: i >= 0 ? pages[i] : null,
        prev: i > 0 ? pages[i - 1] : null,
        next: i >= 0 && i < pages.length - 1 ? pages[i + 1] : null,
    };
}

// Every docs page is pulled into the bundle eagerly. The docs SPA is small and
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

export type RouteKind = "landing" | "section" | "docs" | "notFound";

export interface ResolvedRoute {
    kind: RouteKind;
    section?: string;
    pageKey?: string;
}

// Resolve the current document path against the deployment base. The router
// used to own this; now it runs once per full page load.
export function resolveRoute(
    pathname: string = window.location.pathname,
): ResolvedRoute {
    const basePath = BASE.replace(/\/+$/, "");
    const relative =
        basePath &&
        (pathname === basePath || pathname.startsWith(`${basePath}/`))
            ? pathname.slice(basePath.length)
            : pathname;

    const segments = relative
        .split("/")
        .filter(Boolean)
        .map((p) => p.toLowerCase());

    if (segments.length === 0) return { kind: "landing" };
    if (!isKnownSection(segments[0])) return { kind: "notFound" };
    if (segments.length === 1) return { kind: "section", section: segments[0] };
    return { kind: "docs", section: segments[0], pageKey: segments[1] };
}
