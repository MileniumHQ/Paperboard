# Blocks

Build automations from blocks, with every panel's blocks

A [Paperboard](https://paperboard.dev) panel, built with SolidJS and PaperUI.

## Run it

```sh
bun install          # the panel's dependencies
bun run build        # typecheck, then the page and service bundles
bunx paperapi link   # Paperboard runs the panel from this folder
```

After a change, run `bun run build` again, then `bunx paperapi restart` (or
restart the panel from its menu in Paperboard) to run the new build.

## When something is off

- `bunx paperapi doctor` checks the manifest, the build, the link and that
  Paperboard is running, and says what to run for anything that is not right.
- `bunx paperapi monitor --panel dev.paperboard.blocks` shows every call the panel
  makes and receives as it happens: how long it took and how it went.
- `bun test` runs the unit tests and the UI standards guard.

The guides for building panels are at <https://paperboard.dev/docs/developers/>.

## What is here

- `manifest.json` names the panel and points at what the build makes.
- `src/App.tsx` opens on the projects (`src/projects/`); opening one shows
  `src/Editor.tsx`, the Blockly canvas with the Library and the top bar.
- `src/lib/projects.ts` keeps the projects: an index, and each project's
  flows in its own file. The one canvas from before projects becomes
  "My flows" the first time, and its old file is left as it was.
- `src/lib/scheduler.ts` runs the schedule hats in the service and notes
  when each last ran in `schedules.json`; `src/lib/data.ts` keeps each
  project's Data in `data/<project>.json`.
- `src/templates.ts` is what New project can start a project with: Blocks' own templates, and the builder that makes panels' registered templates (`blocksApi` `templates`) from their blocks.
- `src/panel.ts` holds what the page and the service share.
- `src/service.ts` is the background service, and `src/runtime.ts` what it
  does: it keeps the projects, listens for the events their flows start
  from and runs them. Its state is what every window mirrors.
- `src/blocks.ts` is the panel's own Projects blocks, which other flows
  drive it with.
- `src/editorFlows.ts` loads and saves the open project's canvas, and
  `src/libraryModel.ts` is what the Library lists.
- `test/hermetic.ts` keeps the tests off the network and off your real
  Paperboard data.
