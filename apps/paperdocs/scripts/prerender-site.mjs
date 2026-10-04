import { siteMetadata } from "./site-metadata.mjs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { landingChrome, paths, render } from "../dist-ssr/entry-server.js";

// Prerenders the root pages into dist/ and injects the landing's chrome from
// the shared link contents. Run after the three Vite builds:
//   vite build                        -> dist/ (docs SPA + public/ landing)
//   vite build -c vite.site.client.config.ts -> dist/site-client.js, site.css
//   vite build -c vite.site.config.ts -> dist-ssr/ (SSR bundle)
//   bun scripts/prerender-site.mjs
// The docs build owns dist/index.html; this script only rewrites the marked
// chrome regions and adds the new page directories.

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

function injectMarkers(html, name, replacement) {
    const start = `<!-- site-nav:${name} -->`;
    const end = `<!-- /site-nav:${name} -->`;
    const startIndex = html.indexOf(start);
    const endIndex = html.indexOf(end);
    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
        throw new Error(
            `paperdocs: dist/index.html is missing the site-nav:${name} markers`,
        );
    }
    return (
        html.slice(0, startIndex + start.length) +
        "\n" +
        replacement +
        "\n" +
        html.slice(endIndex)
    );
}

function documentFor(page, path) {
    return `<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="dark light" />
        ${siteMetadata(page, path)}
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="stylesheet" href="/site.css" />
        <script>
            // Resolve the theme before first paint so the page never flashes
            // the wrong surface. The topbar island reads this attribute.
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
    </body>
</html>
`;
}

// The pages are static HTML; nothing hydrates against these markers, so the
// hydration keys, boundary comments, and the server's default theme attribute
// are stripped. The inline head script owns the theme until the topbar island
// renders and applies the stored choice.
function stripSsrArtifacts(html) {
    return html
        .replaceAll(/ data-hk="[^"]*"/g, "")
        .replaceAll(/ data-paperui-theme="[^"]*"/g, "")
        .replaceAll(/<!--\$-->|<!--!\$-->|<!--\/-->/g, "");
}

const landingPath = join(dist, "index.html");
let landing;
try {
    landing = await readFile(landingPath, "utf8");
} catch (error) {
    throw new Error(
        `paperdocs: dist/index.html not found. Run the docs build first. (${error.message})`,
    );
}

landing = injectMarkers(landing, "learn", landingChrome.topbarLearn);
landing = injectMarkers(landing, "docs", landingChrome.topbarDocs);
landing = injectMarkers(landing, "mobile", landingChrome.mobile);
landing = injectMarkers(
    landing,
    "footer-learn",
    landingChrome.footerLearn,
);
landing = injectMarkers(landing, "footer-docs", landingChrome.footerDocs);
landing = injectMarkers(landing, "footer-site", landingChrome.footerSite);

for (const href of ["/actions", "/docs/paperapi", "/downloads", "/contact"]) {
    if (!landing.includes(`href="${href}"`)) {
        throw new Error(
            `paperdocs: landing chrome is missing the ${href} link after injection`,
        );
    }
}

await writeFile(landingPath, landing);

// The SSR build's stylesheet covers every component the pages render, so it
// replaces the client build's chrome-only CSS. Fonts ride along under
// /assets/, which the site.css URLs reference absolutely.
await cp(join(ssr, "assets"), join(dist, "assets"), {
    recursive: true,
    force: true,
});
await cp(join(ssr, "site.css"), join(dist, "site.css"), { force: true });

for (const path of paths) {
    const page = render(path);
    const file = join(dist, path, "index.html");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, documentFor(page, path));
    console.log(`prerendered ${path}`);
}

// Sitemap. The learn pages are deferred but planned, so they are listed now
// and will be indexed as soon as they ship.
const ORIGIN = "https://paperboard.dev";
const LEARN_PATHS = ["/actions", "/game-server", "/bot-creator", "/ai"];
const docsIndex = JSON.parse(
    await readFile(join(root, "src", "docs", "index.json"), "utf8"),
);
const docsPaths = ["/docs/"];
for (const [section, data] of Object.entries(docsIndex)) {
    if (section === "meta") continue;
    for (const subsection of Object.values(data.subsections ?? {})) {
        for (const pageKey of Object.keys(subsection.pages ?? {})) {
            docsPaths.push(`/docs/${section}/${pageKey}`);
        }
    }
}
const sitemapUrls = ["/", ...LEARN_PATHS, ...paths, ...docsPaths];
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
console.log(`site: ${paths.length} pages prerendered, landing chrome injected`);
