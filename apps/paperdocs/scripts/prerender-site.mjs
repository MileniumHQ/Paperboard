import { siteMetadata } from "./site-metadata.mjs";
import { withDownloadWarningAssets } from './download-warning-assets.mjs';
import { referencedVariants, writeMarketingImages } from "./marketing-images.mjs";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    DOCS_ALIASES,
    docsRoutes,
    metaSections,
    paths,
    render,
    renderNotFound,
    subsectionsFor,
} from "../dist-ssr/entry-server.js";
import { docsPageMarkdown, markdownPath } from "./docs-markdown.mjs";

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

const ORIGIN = "https://paperboard.dev";

// A Markdown page names its canonical URL first, so a pasted page still says
// where it came from.
function withSource(markdown, path) {
    return `<!-- Source: ${ORIGIN}${path} -->\n\n${markdown}`;
}

function isDocsPath(path) {
    return path === "/docs/" || path.startsWith("/docs/");
}

// Marketing pages share the landing document shell. Learn pages load only
// the shared chrome scripts and the screenshot lightbox; the main landing
// adds its developer-card reveal and the draggable outro icons. Scroll
// reveals on both are CSS, and every image is a static file.
function landingDocument(page, path) {
    return `<!doctype html>
<html lang="en"${page.accent ? ` style="--paper-site-accent: ${page.accent}"` : ""}>
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="dark light" />
        ${siteMetadata(page, path)}
        <link rel="manifest" href="${isDocsPath(path) ? '/docs.webmanifest' : '/site.webmanifest'}" />
        <link rel="stylesheet" href="/site.css" />
        <link rel="preload" href="${marketingFont}" as="font" type="font/woff2" crossorigin />
        <link rel="stylesheet" href="/css/style.css" />
        ${page.learn ? '<link rel="stylesheet" href="/css/learn.css" />' : ""}
        <!-- The decorative elements are defined before the body is parsed, so
             each heading, button, and overlay renders as the parser creates it.
             Defined after the content, the page first painted their plain
             fallbacks and then swapped them in, shifting everything below. -->
        <script src="/js/bg-overlay.js"></script>
        <script src="/js/styled-text.js"></script>
        <script src="/js/paper-button.js"></script>
    </head>
    <body>
${stripSsrArtifacts(page.html)}
        <script src="/js/topbar.js"></script>
        <script src="/js/download-button.js"></script>
        ${page.learn ? '<script src="/js/learn-lightbox.js"></script>' : '<script type="module" src="/js/icon-play.js"></script>'}
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

// Every marketing heading, label, and button is set in PaperUI's Nunito, so
// the marketing documents preload that one face instead of discovering it
// only after both stylesheets have been parsed.
const marketingFonts = (await readdir(join(dist, "assets"))).filter((name) =>
    /^Nunito-[\w-]+\.woff2$/.test(name),
);
if (marketingFonts.length !== 1) {
    throw new Error(
        `paperdocs: expected one Nunito face in the build, found ${marketingFonts.length}`,
    );
}
const marketingFont = `/assets/${marketingFonts[0]}`;

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

// Each docs page also ships as Markdown for agents; its lead's first sentence
// is the page's description everywhere (meta tags, llms.txt).
const docsByPath = new Map(docsRoutes().map((route) => [route.path, route]));
const docsPages = new Map();

const imageVariants = [];
for (const path of paths) {
    const page = render(path);
    assertRendered(path, page.html, page.landing || page.learn);
    const docsRoute = docsByPath.get(path);
    if (docsRoute?.pageKey) {
        const pagePath = docsRoute.canonical ?? path;
        const md = docsPageMarkdown(page.html, path);
        page.description = md.description;
        page.markdown = markdownPath(pagePath);
        if (!docsRoute.canonical) {
            docsPages.set(path, { ...md, route: docsRoute });
            await writeFile(join(dist, page.markdown), withSource(md.markdown, path));
        }
    }
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
    const html = withDownloadWarningAssets(documentFor(page, path));
    imageVariants.push(...referencedVariants(html));
    await writeFile(file, html);
    console.log(`prerendered ${path}`);
}

// The responsive image copies the pages just referenced.
const images = await writeMarketingImages({
    publicDir: join(root, "public"),
    dist,
    cacheDir: join(root, "node_modules", ".cache", "paperdocs-images"),
    urls: imageVariants,
});
console.log(`images: ${images.variants} responsive variants (${images.encoded} encoded)`);

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

// The agent-facing index (https://llmstxt.org): every docs page, grouped by
// section, linking its Markdown. llms-full.txt is every page in one file.
const llms = [
    "# Paperboard",
    "",
    "> Paperboard is a desktop app and server daemon for running self-hosted programs, extended by panels. These docs cover using Paperboard, building panels (developers), the PaperAPI runtime, and the PaperUI component library. Every page is also available as Markdown at its URL with `.md` in place of the trailing slash.",
    "",
];
const llmsFull = [];
for (const [section, meta] of Object.entries(metaSections)) {
    llms.push(`## ${meta.name}`, "", meta.description, "");
    for (const sub of subsectionsFor(section)) {
        for (const p of sub.pages) {
            const path = `/docs/${section}/${p.pageKey}/`;
            const doc = docsPages.get(path);
            if (!doc) throw new Error(`paperdocs: ${path} has no Markdown export`);
            llms.push(`- [${meta.name} / ${sub.name} / ${p.name}](${ORIGIN}${markdownPath(path)}): ${doc.description}`);
            llmsFull.push(withSource(doc.markdown, path));
        }
    }
    llms.push("");
}
await writeFile(join(dist, "llms.txt"), llms.join("\n"));
await writeFile(join(dist, "llms-full.txt"), llmsFull.join("\n---\n\n"));
console.log(`llms: ${docsPages.size} docs pages exported as Markdown`);

// Sitemap. paths already covers the landing, the root pages, and every docs
// page (including section roots and the docs landing). Learn pages come from the same route list.
// Section roots repeat their first page, which is the canonical URL, so they
// stay out of the sitemap.
const sitemapUrls = paths.filter((path) => !docsByPath.get(path)?.canonical);
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
