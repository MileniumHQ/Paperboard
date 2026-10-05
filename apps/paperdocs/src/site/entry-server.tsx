import { renderToString } from "solid-js/web";
import { SitePage } from "./SitePage";
import { SITE_ROUTES } from "./routes";
import { Landing } from "./landing/Landing";
import App from "../App";
import { LEARN_PANELS } from "./learn/panels";
import { LearnPage } from "./learn/LearnPage";
import { docsRoutes } from "./docsRoutes";

export interface RenderedPage {
    title: string;
    description: string;
    html: string;
    /** The main landing uses the shared marketing chrome with stage effects. */
    landing?: boolean;
    /** Learn pages share marketing chrome with ordinary document scrolling. */
    learn?: boolean;
}

const LANDING: RenderedPage = {
    title: "Paperboard | Self-hosted apps and automation",
    description:
        "Paperboard is an all-in-one toolkit for self-hosting. Run, manage, and automate tools locally on Windows, macOS, and Linux.",
    html: "",
};

// Called by scripts/prerender-site.mjs from the compiled SSR bundle. Renders
// the page body only; the script owns the document shell so <head> stays a
// plain template instead of a Solid tree. Docs pages keep their own app, root
// pages share SitePage, and the landing renders its own chrome, but all three
// come out of this one Solid build. The output is static HTML: the client
// bundle renders the interactive chrome and, for docs, the docs app, rather
// than hydrating the markup.
export function render(path: string): RenderedPage {
    if (path === "/") {
        const html = renderToString(() => <Landing />);
        return { ...LANDING, html, landing: true };
    }

    const panel = LEARN_PANELS.find(panel => path === `/${panel.slug}/`);
    if (panel) return {
        title: panel.seoTitle, description: panel.description,
        html: renderToString(() => <LearnPage panel={panel} />), learn: true,
    };

    const docs = docsRoutes().find((candidate) => candidate.path === path);
    if (docs) {
        const html = renderToString(() => (
            <div id="docs-root">
                <App pathname={docs.path} />
            </div>
        ));
        return { title: docs.title, description: docs.description, html };
    }

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

// The one 404 document sitewide. It renders the docs app's NotFound, so every
// missing path (docs or root) shows the same page.
export function renderNotFound(): RenderedPage {
    const html = renderToString(() => (
        <div id="docs-root">
            <App pathname="/docs/__not-found__" />
        </div>
    ));
    return {
        title: "Page not found | Paperboard",
        description: "The page you are looking for does not exist.",
        html,
    };
}

export const paths = [
    "/",
    ...LEARN_PANELS.map(panel => `/${panel.slug}/`),
    ...SITE_ROUTES.map((route) => route.path),
    ...docsRoutes().map((route) => route.path),
];

export { DOCS_ALIASES } from "./docsRoutes";
