Panel learn pages
================

Add a `LearnPanel` entry to `panels.ts` to create a page, its navigation links,
related-panel links, and sitemap entry. Use the panel's `store/about.md` as the
source for capability claims. `summary` is the short navigation description;
`description` introduces the page. Keep any prerequisites in `note`.

Use a `--paper-panel-*` identity token from PaperUI's `styles/colors.css` for
`accent`. The page derives its background, buttons, and highlights from the
single `--paper-site-accent` token, also used by the main landing page.

Screenshots are the panels' own store screenshots. `bun run screens` copies
each featured panel's dark store screenshots, in store order, from
`panels/<id>/store` to `public/screens/<name>-<n>.png` (1360 × 1020) and removes
copies the store no longer has; run it after a panel's store screenshots
change. The hero and device renders take theirs from `scripts/renders/shots.mjs`
(`bun run renders`). Give every feature a useful alt; the store's alt text is
the place to start.

`LearnPage`, `MarketingChrome`, `DownloadCta`, and `Screenshot` are shared Solid
components. The SSR build produces static pages; sections reveal with a
scroll-driven CSS animation (`learn.css`), so no script ever hides content.
Content is visible without JavaScript, under reduced motion, and in browsers
without scroll-driven animations. Landing-only scroll choreography
is not loaded on learn pages.

Run `bun run gate paperdocs paperui` and `bun run test:browser` in this app.
Set `CHROME_PATH` to your Chrome binary to test in Chrome; otherwise install
Playwright Chromium with `bunx playwright install chromium`. The browser check
serves built static artifacts on an ephemeral loopback port and tears everything down.
`bun run dev -- --port 4320` in `apps/paperdocs` starts the local Worker preview.

Every learn page gives one feature to an Actions workflow. Where no store
screenshot shows one, `scripts/capture-integrations.ts` captures it from the
real Actions editor (`*-flow.png`, 1600 × 1200 at 200% page zoom). It needs a
temporary browser-mode install on port 4319 with Actions, Game Server and
Agents linked (`bun run link:panels` from the repo root, with that
`PAPERBOARD_DIR`) and one
Minecraft server added in Game Server. The server is never set up or started.
Use a temporary `PAPERBOARD_DIR` and `XDG_CONFIG_HOME`; never capture private
user data.

```sh
TMPDIR=/tmp PAPERBOARD_DIR=/tmp/paperboard-marketing-... bun run screenshots:actions
```

The script builds each flow from the schemas the install registered, checks its
inputs, runs it through the real Actions runtime against simulated answers,
saves it as a project, captures it in the editor after checking bounds, icons
and typed chips, and deletes the project. Set `PAPERBOARD_BROWSER_ORIGIN` and
`CHROME_PATH` when needed. Every published picture has its own filename and
contents; the content test rejects reused files and identical image bytes.
