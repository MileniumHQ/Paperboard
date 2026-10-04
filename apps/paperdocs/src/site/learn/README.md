Panel learn pages
================

Add a `LearnPanel` entry to `panels.ts` to create a page, its navigation links,
related-panel links, and sitemap entry. Use the panel's `store/about.md` as the
source for capability claims. `summary` is the short navigation description;
`description` introduces the page. Keep any prerequisites in `note`.

Use a `--paper-panel-*` identity token from PaperUI's `styles/colors.css` for
`accent`. The page derives its background, buttons, and highlights from the
single `--paper-site-accent` token, also used by the main landing page.

Capture screenshots in Chrome browser mode with `--force-color-profile=srgb`,
native 1600 × 1200 output. `capture-browser.mjs` sets Chrome's native page zoom
to 125% through Chrome Settings, with device scale factor 1. Individual Actions
flows use 200% page zoom; learn-page hero captures use 150%. This reflows the actual UI without resizing images. Use a temporary
`PAPERBOARD_DIR` and isolated `XDG_CONFIG_HOME`; never capture private user data.
Use realistic demo data for connected-state marketing captures; confine fixtures
to the capture browser and never change production readiness or authentication.
Flow close-ups may use Chrome's page zoom before capture; never upscale an
existing image. Validate action inputs against the actual schemas, run each
flow through the authenticated SDK, and check rendered flow bounds for overlap
and clipping. Put PNGs in `public/screens/` and give every feature a useful alt.

`LearnPage`, `MarketingChrome`, `DownloadCta`, and `Screenshot` are shared Solid
components. The SSR build produces static pages; `learn-reveal.js` adds ordinary
scroll reveals with an observer that disconnects on page exit. Content is visible
without JavaScript and under reduced motion. Landing-only scroll choreography
is not loaded on learn pages.

Run `bun run gate paperdocs paperui` and `bun run test:browser` in this app.
Set `CHROME_PATH` to your Chrome binary to test in Chrome; otherwise install
Playwright Chromium with `bunx playwright install chromium`. The browser check
serves built static artifacts on an ephemeral loopback port and tears everything down.
`bun run dev -- --port 4320` in `apps/paperdocs` starts the local Worker preview.

To refresh the connected-state demo pictures after launching a temporary
browser-mode install on port 4319:

```sh
PAPERBOARD_DIR=/tmp/paperboard-marketing-... bun run screenshots:demo
PAPERBOARD_DIR=/tmp/paperboard-marketing-... bun run screenshots:actions
PAPERBOARD_DIR=/tmp/paperboard-marketing-... bun scripts/capture-integrations.ts
CAPTURE_LEARN_HERO=1 PAPERBOARD_DIR=/tmp/paperboard-marketing-... bun run screenshots:demo
```

The script checks the temporary install's daemon socket, passes authentication
through, and substitutes only screenshot data inside its own Chrome context.
Set `PAPERBOARD_BROWSER_ORIGIN` and `CHROME_PATH` when needed. It never changes
production services, saves credentials, or connects to Discord.

Game Server captures require `real-server-state.json` inside the temporary install,
recorded from an actual online server through the authenticated SDK. The producer
uses real Modrinth search results and Mojang profiles/skins. Public usernames appear
in an illustrative roster; they do not indicate real sessions or endorsements.
The integration examples use actual registry schemas but remain inside Chrome: no
event subscriptions are registered and no Discord messages are sent.
The integration capture owns the published Actions examples; the older generic
flow capture is a separate SDK execution check. Run integrations last if refreshing
both. Every published picture has its own filename and contents, including the
main carousel; the content test rejects reused files and identical image bytes.
