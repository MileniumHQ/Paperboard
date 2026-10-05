// Site-root-relative URLs. The whole site (root pages and docs) builds with
// Vite base "/", so withBase only normalizes the leading slash now; the docs
// section is not a separate Vite root any more.
export const BASE = import.meta.env.BASE_URL;

/** Normalize a site-root-relative path ("/paperui.png"). */
export function withBase(path: string): string {
    const clean = path.replace(/^\/+/, "");
    return clean ? `/${clean}` : "/";
}

/** A docs section or page route, trailing-slashed to match its static file:
    "/docs/paperui/" or "/docs/paperui/overview/". */
export function docsPath(section: string, pageKey?: string): string {
    return pageKey
        ? `/docs/${section}/${pageKey}/`
        : `/docs/${section}/`;
}
