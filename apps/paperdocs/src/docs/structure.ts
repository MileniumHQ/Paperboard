import index from "./index.json";
import { metaSections } from "./meta";
import type { Page, Subsection } from "../types/docs";

// Pure docs structure: index.json plus section metadata, with no Vite-only
// imports. The prerender script and tests read routes from here, while
// routeUtils adds the eagerly bundled page components on top.

export { metaSections, sectionKeys } from "./meta";

export interface PageSiblings {
    current: Page | null;
    prev: Page | null;
    next: Page | null;
}

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
