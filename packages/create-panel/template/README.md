# __PANEL_NAME__

__PANEL_DESC__

A [Paperboard](https://paperboard.dev) panel, built with SolidJS and PaperUI.

## Run it

```sh
bun install          # the panel's dependencies
bun run build        # typecheck, then the page, widget and service bundles
bunx paperapi link   # Paperboard runs the panel from this folder
```

After a change, run `bun run build` again, then `bunx paperapi restart` (or
restart the panel from its menu in Paperboard) to run the new build.

## When something is off

- `bunx paperapi doctor` checks the manifest, the build, the link and that
  Paperboard is running, and says what to run for anything that is not right.
- `bunx paperapi monitor --panel __PANEL_ID__` shows every call the panel
  makes and receives as it happens: how long it took and how it went.
<!-- @if service -->
- `bunx paperapi call __PANEL_ID__ greet '{"name":"Ada"}'` calls one of the
  service's actions from the terminal; `bunx paperapi call __PANEL_ID__`
  lists them.
<!-- @endif -->
- `bun test` runs the unit tests and the UI standards guard.

The guides for building panels are at <https://paperboard.dev/docs/developers/>.

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
- `test/hermetic.ts` keeps the tests off the network and off your real
  Paperboard data.

Before you publish, add `branding/icon.png` and point the manifest's `icon` at
it, and add screenshots to `store`.
