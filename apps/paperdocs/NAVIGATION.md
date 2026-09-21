# PaperDocs: topbar and footer

The navigation is defined **twice** — once for the docs SPA (`/docs/*`) and once for the static landing (`/`). Keep them in sync.

| | Docs SPA | Static landing |
|---|---|---|
| Topbar | `src/components/Topbar.tsx` | `public/index.html` (`<header class="site-topbar">`) |
| Footer | `src/components/Footer.tsx` | `public/index.html` (`<footer class="site-footer">`) |
| Dropdown behaviour | PaperUI `PaperContextMenu` | `public/js/topbar.js` |

## Topbar

`Brand · Learn ▾ · Docs ▾ · Blog · [search, theme — SPA only] · [Download — landing only]`

- **Learn**: Actions `/actions` · Game Server `/game-server` · Bot Creator `/bot-creator` · Local AI `/ai`
- **Docs**: PaperAPI `/docs/paperapi` · PaperUI `/docs/paperui`

(The SPA's Docs menu is generated from `meta.sections` in `src/docs/index.json`; the landing's is hardcoded.)

## Footer

- **Learn**: About Paperboard `/` · Actions `/actions` · Game Server `/game-server` · Bot Creator `/bot-creator` · Local AI `/ai`
- **Docs**: PaperAPI `/docs/paperapi` · PaperUI `/docs/paperui`
- **Site**: Blog `/blog` · Brand `/brand` · Contact `/contact` · Downloads `/downloads` · Terms of Use `/terms` · Privacy Policy `/privacy`
- **Bottom**: `© <year> Milenium LLC` plus X, GitHub, Discord, and the Milenium wordmark

## Changing a link

Edit the SPA file **and** the landing file in the table above. Docs links in the SPA use `withBase()` (they resolve under `/docs`); the landing uses absolute `/docs/...`. Adding a docs section to `src/docs/index.json` updates the SPA's Docs menu on its own — add it to the landing by hand.
