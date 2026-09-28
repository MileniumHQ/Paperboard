import { renderToString } from "solid-js/web";
import { SitePage } from "./SitePage";
import { SITE_ROUTES } from "./routes";

export interface RenderedPage {
    title: string;
    description: string;
    html: string;
}

// Called by scripts/prerender-site.mjs from the compiled SSR bundle. Renders
// the page body only; the script owns the document shell so <head> stays a
// plain template instead of a Solid tree. The output is static HTML: the
// topbar is re-rendered client-side into its slot (src/site/entry-client.tsx)
// rather than hydrated, so no hydration keys are needed.
export function render(path: string): RenderedPage {
    const route = SITE_ROUTES.find((candidate) => candidate.path === path);
    if (!route) {
        throw new Error(`paperdocs: no site route registered for ${path}`);
    }
    const Page = route.component;
    const html = renderToString(() => (
        <SitePage>
            <Page />
        </SitePage>
    ));
    return {
        title: route.title,
        description: route.description,
        html,
    };
}

export const paths = SITE_ROUTES.map((route) => route.path);

export { landingChrome } from "./chrome";
