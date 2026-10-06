import { siteMetadata } from "./site-metadata.mjs";
import { withDownloadWarningAssets } from './download-warning-assets.mjs';
import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    DOCS_ALIASES,
    paths,
    render,
    renderNotFound,
} from "../dist-ssr/entry-server.js";

// Prerenders every root page, docs page, and the landing into dist/. Run after
// the two Vite builds:
//   vite build -c vite.site.client.config.ts -> dist/ (site-client.js, chrome
//                                              CSS, and the public/ copy)
//   vite build -c vite.site.config.ts -> dist-ssr/ (SSR bundle)
//   bun scripts/prerender-site.mjs
// Every page, including the landing, is rendered by the Solid SSR bundle; this
// script only owns the document shell and writes the static files.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const ssr = join(root, "dist-ssr");

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function isDocsPath(path) {
    return path === "/docs/" || path.startsWith("/docs/");
}

// Marketing pages share the landing document shell. Learn pages load only
// the shared chrome scripts and scroll reveals; the main landing additionally
// gets carousel, stage and drag effects.
function landingDocument(page, path) {
    return `<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="dark light" />
        ${siteMetadata(page, path)}
        <link rel="manifest" href="${isDocsPath(path) ? '/docs.webmanifest' : '/site.webmanifest'}" />
        <link rel="stylesheet" href="/site.css" />
        <link rel="stylesheet" href="/css/style.css" />
        ${page.learn ? '<link rel="stylesheet" href="/css/learn.css" />' : ""}
    </head>
    <body>
${stripSsrArtifacts(page.html)}
        <script src="/js/bg-overlay.js"></script>
        <script src="/js/styled-text.js"></script>
        <script src="/js/paper-button.js"></script>
        <script src="/js/topbar.js"></script>
        <script src="/js/download-button.js"></script>
        ${page.learn ? '<script src="/js/learn-reveal.js"></script>\n        <script src="/js/learn-lightbox.js"></script>' : `<script src="/js/card-scroll.js"></script>
        <script src="/js/dots-bar.js"></script>
        <script src="/js/all-in-one.js"></script>
        <script src="/js/flight.js"></script>
        <script src="/js/cta.js"></script>
        <!-- The import map must precede every module script: Firefox ignores one
             registered after module loading starts, which drops the bare "three"
             specifiers and killed the stage there. -->
        <script type="importmap">
            {
                "imports": {
                    "three": "./js/vendor/three.module.js",
                    "three/addons/": "./js/vendor/addons/"
                }
            }
        </script>
        <script type="module" src="/js/icon-play.js"></script>
        <script type="module" src="/js/aio-stage.js"></script>`}
        <script src="/js/footer.js"></script>
    </body>
</html>
`;
}

function documentFor(page, path) {
    if (page.landing || page.learn) return landingDocument(page, path);

    return `<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="dark light" />
        ${siteMetadata(page, path)}
        <link rel="manifest" href="${isDocsPath(path) ? '/docs.webmanifest' : '/site.webmanifest'}" />
        <link rel="stylesheet" href="/site.css" />
        <script>
            // Resolve the theme before first paint so the page never flashes
            // the wrong surface. The client islands read this attribute.
            (function () {
                try {
                    var theme = localStorage.getItem("paper-docs-theme");
                    if (theme !== "light" && theme !== "dark") theme = "dark";
                    var root = document.documentElement;
                    root.setAttribute("data-paperui-theme", theme);
                    root.style.colorScheme = theme;
                } catch (e) {
                    document.documentElement.style.colorScheme = "dark";
                }
            })();
        </script>
    </head>
    <body>
${stripSsrArtifacts(page.html)}
        <script type="module" src="/site-client.js"></script>
        ${isDocsPath(path) ? "" : '<script src="/js/styled-text.js"></script>'}
    </body>
</html>
`;
}

// The pages are static HTML; nothing hydrates against these markers, so the
// hydration keys, boundary comments, and the server's default theme attribute
// are stripped. The inline head script owns the theme until the client islands
// render and apply the stored choice.
function stripSsrArtifacts(html) {
    return html
        .replaceAll(/ data-hk="[^"]*"/g, "")
        .replaceAll(/ data-paperui-theme="[^"]*"/g, "")
        .replaceAll(/<!--\$-->|<!--!\$-->|<!--\/-->/g, "");
}

// A static file that forwards an old/README path to its docs section, so the
// aliases work without a Worker redirect.
function aliasDocument(target) {
    return `<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Redirecting</title>
        <link rel="canonical" href="https://paperboard.dev${target}" />
        <meta http-equiv="refresh" content="0; url=${target}" />
    </head>
    <body>
        <p>This page moved to <a href="${target}">${target}</a>.</p>
    </body>
</html>
`;
}

// The SSR build's stylesheet covers every component the pages render, so it
// replaces the client build's chrome-only CSS. Fonts ride along under
// /assets/, which the site.css URLs reference absolutely.
await cp(join(ssr, "assets"), join(dist, "assets"), {
    recursive: true,
    force: true,
});
await cp(join(ssr, "site.css"), join(dist, "site.css"), { force: true });

// Every page is its own static document. A build that drops one is a failure,
// not a silently missing route.
function assertRendered(path, html, landing) {
    const marker = landing
        ? 'class="site-topbar"'
        : isDocsPath(path)
          ? 'id="docs-root"'
          : 'id="site-topbar"';
    if (!html.includes(marker)) {
        throw new Error(
            `paperdocs: ${path} did not render its ${marker} root`,
        );
    }
}

for (const path of paths) {
    const page = render(path);
    assertRendered(path, page.html, page.landing || page.learn);
    if (page.landing) {
        // The landing's link contents come from the shared nav source; a build
        // that drops them means the Solid port drifted from src/site/links.ts.
        for (const href of ["/actions", "/docs/paperapi/", "/downloads"]) {
            if (!page.html.includes(`href="${href}"`)) {
                throw new Error(
                    `paperdocs: landing is missing the ${href} link`,
                );
            }
        }
    }
    // A social card pointing at a missing file embeds as a broken image.
    if (page.image?.src.startsWith("/") && !existsSync(join(dist, page.image.src))) {
        throw new Error(
            `paperdocs: ${path} social image ${page.image.src} is not in the build`,
        );
    }
    const file = join(dist, path, "index.html");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, withDownloadWarningAssets(documentFor(page, path)));
    console.log(`prerendered ${path}`);
}

// One 404 document sitewide, served by the Worker with a 404 status.
const notFound = renderNotFound();
assertRendered("/docs/", notFound.html);
await writeFile(join(dist, "404.html"), withDownloadWarningAssets(documentFor(notFound, "/404.html")));

// README/package aliases, as static files so the Worker needs no redirect
// table.
for (const alias of DOCS_ALIASES) {
    const file = join(dist, `${alias.path}.html`);
    await writeFile(file, aliasDocument(alias.target));
    console.log(`alias ${alias.path} -> ${alias.target}`);
}

// Sitemap. paths already covers the landing, the root pages, and every docs
// page (including section roots and the docs landing). Learn pages come from the same route list.
const ORIGIN = "https://paperboard.dev";
const sitemapUrls = paths;
const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapUrls.map((path) => `    <url><loc>${ORIGIN}${path}</loc></url>`),
    "</urlset>",
    "",
].join("\n");
await writeFile(join(dist, "sitemap.xml"), sitemap);
console.log(`sitemap: ${sitemapUrls.length} urls`);

await rm(ssr, { recursive: true, force: true });
console.log(`site: ${paths.length} pages prerendered`);
