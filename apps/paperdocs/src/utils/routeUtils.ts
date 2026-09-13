import { lazy } from "solid-js";
import index from "../docs/index.json";
import type { SectionMeta, Subsection } from "../types/docs";

export const metaSections: Record<string, SectionMeta> =
    (index as any).meta?.sections || {};
export const sectionKeys = Object.keys(metaSections);

export const rawPath = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map((p) => p.toLowerCase());

export const sectionKey = rawPath.length > 0 ? rawPath[0] : "/";
export const sectionMeta = metaSections[sectionKey];
export const sectionData = (index as any)[sectionKey] || {};

export const subsections: Subsection[] = Object.entries<any>(
    sectionData.subsections || {},
).map(([subKey, sub]) => {
    const rawPages = Object.entries<any>(sub.pages || {}).map(([pKey, p]) => ({
        pageKey: pKey,
        name: p.name || pKey,
        file: p.file || pKey,
        subKey,
        index: p.index ?? 0,
    }));

    const pages =
        sub.sort === "alphabetical"
            ? rawPages.sort((a, b) => a.name.localeCompare(b.name))
            : rawPages.sort((a, b) => a.index - b.index);

    return { key: subKey, name: sub.name, icon: sub.icon, pages };
});

export const allPages = subsections.flatMap((s) => s.pages);

if (
    rawPath.length === 1 &&
    sectionMeta &&
    allPages.length > 0 &&
    typeof window !== "undefined"
) {
    window.location.replace(`/${sectionKey}/${allPages[0].pageKey}`);
}

export const requestedPageKey = rawPath.length > 1 ? rawPath[1] : undefined;
export const currentPageIndex = requestedPageKey
    ? allPages.findIndex((p) => p.pageKey === requestedPageKey)
    : -1;
export const currentPage =
    currentPageIndex >= 0 ? allPages[currentPageIndex] : null;

export const prevPage =
    currentPageIndex > 0 ? allPages[currentPageIndex - 1] : null;
export const nextPage =
    currentPageIndex >= 0 && currentPageIndex < allPages.length - 1
        ? allPages[currentPageIndex + 1]
        : null;

export const DocComponent =
    sectionMeta && currentPage
        ? lazy(
              () =>
                  import(
                      `../docs/${sectionKey}/${currentPage.subKey}/${currentPage.file}.tsx`
                  ),
          )
        : null;
