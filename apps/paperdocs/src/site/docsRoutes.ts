import {
    metaSections,
    sectionKeys,
    subsectionsFor,
} from "../docs/structure";

// Every docs page the site prerenders, derived from src/docs/index.json. This
// is the single route registry for the docs half of the static build: the SSR
// renderer, the prerender script, and the tests all read it. The landing
// ("/docs/") and each section root ("/docs/<section>/") are real pages; a
// section root shows its first page so section links never 404.

export interface DocsRouteMeta {
    path: string;
    title: string;
    description: string;
    section?: string;
    pageKey?: string;
    landing?: boolean;
}

const BASE_DESCRIPTION =
    "Documentation for Paperboard, PaperAPI, and PaperUI. Learn to build panels, use the panel APIs, and style interfaces with PaperUI.";

export function docsRoutes(): DocsRouteMeta[] {
    const routes: DocsRouteMeta[] = [
        {
            path: "/docs/",
            title: "PaperDocs",
            description: BASE_DESCRIPTION,
            landing: true,
        },
    ];

    for (const section of sectionKeys) {
        const meta = metaSections[section];
        const description = meta.description || BASE_DESCRIPTION;
        const pages = subsectionsFor(section).flatMap((sub) => sub.pages);
        const first = pages[0];

        if (first) {
            routes.push({
                path: `/docs/${section}/`,
                title: `${first.name} | Paperboard Docs`,
                description,
                section,
                pageKey: first.pageKey,
            });
        }

        for (const page of pages) {
            routes.push({
                path: `/docs/${section}/${page.pageKey}/`,
                title: `${page.name} | Paperboard Docs`,
                description,
                section,
                pageKey: page.pageKey,
            });
        }
    }

    return routes;
}

// README and package aliases: static files that forward to a docs section.
export const DOCS_ALIASES: { path: string; target: string }[] = [
    { path: "/paperui", target: "/docs/paperui/" },
    { path: "/paperapi", target: "/docs/paperapi/" },
    { path: "/paperdocs", target: "/docs/" },
];
