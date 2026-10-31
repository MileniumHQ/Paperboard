# __PANEL_NAME__

__PANEL_DESC__

A [Paperboard](https://paperboard.dev) panel, built with SolidJS and PaperUI.

```sh
bun install
bun run build   # typecheck, then the page, the widget and the service bundles
bun test        # hermetic unit tests and the UI standards guard
```

Load it into Paperboard while you work on it with `paperapi link` (see
<https://paperboard.dev/paperapi>). After a build, restart the panel from its
menu in Paperboard to pick up a new service.

## What is here

- `manifest.json` names the panel and points at what the build makes.
- `src/App.tsx` is the panel's menu and pages, in `src/pages/`.
- `src/panel.ts` holds what the page, the service and the widget share.
<!-- @if service -->
- `src/service.ts` is the background service. Its actions are what other
  panels and the Actions panel can call, and its state is what every window
  mirrors.
<!-- @endif -->
<!-- @if widget -->
- `src/widget.tsx` is the Home widget declared under `widgets` in the manifest.
<!-- @endif -->
<!-- @if store -->
- `store/about.md` is the long description on the panel's library page.
<!-- @endif -->
- `test/uiStandards.test.ts` keeps inline styles out of the UI.

Before you publish, add `branding/icon.png` and point the manifest's `icon` at
it, and add screenshots to `store`.
