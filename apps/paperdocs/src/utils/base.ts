// Deployment base, e.g. "/docs/". Vite exposes the configured `base` as
// BASE_URL with a trailing slash. This is the one place that knows how to
// join a site-root-relative path onto it, so links and assets can never
// double or drop the prefix.
export const BASE = import.meta.env.BASE_URL;

/** Prefix a site-root-relative path ("/paperui") with the deployment base. */
export function withBase(path: string): string {
    const clean = path.replace(/^\/+/, "");
    return clean ? `${BASE}${clean}` : BASE;
}
