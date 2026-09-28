# PaperDocs: navigation and chrome

Link contents are defined **once** in `src/site/nav.json` (Learn, Site,
Download) plus `src/docs/index.json` (`meta.sections`, the Docs menu). Every
surface reads those:

| | Docs SPA | Prerendered root pages | Static landing |
|---|---|---|---|
| Chrome | `src/components/Topbar.tsx`, `Footer.tsx` | same components, hydrated | `public/index.html` |
| Topbar | PaperUI, search + theme | PaperUI, brand "Paperboard" + Download + theme | hand-written HTML + `public/js/topbar.js` |
| Footer | `src/components/Footer.tsx` | same component | hand-written HTML |
| Link data | `src/site/links.ts` | `src/site/links.ts` | injected at build by `src/site/chrome.ts` |

The docs SPA and the landing keep separate chrome implementations on purpose
(different CSS and markup). Only the link contents are shared. The landing's
topbar dropdowns and footer columns are generated between the `site-nav:*`
markers in `public/index.html` by `scripts/prerender-site.mjs`; the markers
must stay, and the build fails if one is missing.

Root pages are the same components as the docs, prerendered and then hydrated
in the browser (`src/site/entry-client.tsx`). The page text is in the HTML
response; the Solid runtime only adds behavior (menus, theme). Both site builds
alias PaperUI to source so the server and client markup match for hydration.

## Styling

`src/index.css` is the shared base for both builds (canvas, theme, chrome);
`src/styles/chrome.css` holds the topbar rules. The docs-only layout (sidebar
and table of contents bars) lives in `src/docs/docsLayout.css`, imported by
`DocsPage`. A change to the canvas, tokens, or chrome belongs in the shared
files, not in a per-page stylesheet.

## Topbar

`Brand · Learn ▾ · Docs ▾ · Blog · [search, theme — SPA only] · [Download — site/landing only]`

- **Learn**: Actions `/actions` · Game Server `/game-server` · Bot Creator `/bot-creator` · Local AI `/ai`
- **Docs**: PaperAPI `/docs/paperapi` · PaperUI `/docs/paperui`

The Docs menu derives from `meta.sections` in `src/docs/index.json`, so adding
a docs section updates the SPA, the prerendered pages, and the landing at
once.

## Footer

- **Learn**: About Paperboard `/` · Actions · Game Server · Bot Creator · Local AI
- **Docs**: PaperAPI · PaperUI
- **Site**: Blog `/blog` · Downloads `/downloads` · Contact `/contact`
- **Bottom**: `© <year> Milenium` plus X, GitHub, Discord, and the Milenium wordmark

## Root pages

`/blog`, `/blog/<slug>`, `/downloads`, and `/contact` are Solid pages in
`src/site/pages/`, prerendered to static HTML by
`bun run build` (see `vite.site.config.ts` and `scripts/prerender-site.mjs`).
They are registered in `src/site/routes.tsx`. The contact form is a client
island: `Contact.tsx` renders it for the static response and
`src/site/entry-client.tsx` re-renders it into `#site-contact` to build the
mailto hand-off. Blog posts are markdown files in `src/site/blog/`, read by
`src/site/blog.ts` (frontmatter metadata, body through `marked` and
`PaperProse`). The landing at `/` stays hand-written HTML in
`public/index.html`; only its chrome is generated.

## Changing a link

Edit `src/site/nav.json` (or add a docs section to `src/docs/index.json`) and
run the build. Do not edit link markup in `public/index.html`; the build
overwrites it between the markers.
