# create-panel

Scaffolds a Paperboard panel. The guides for building one are at
https://paperboard.dev/docs/guides/.

```sh
npm create @mileniumhq/panel
```

Run with no arguments and it asks about the choices that shape the panel:

- the panel's id, name and description, and its publisher
- a **background service**, which keeps state and runs work whether or not a
  window is open, and which other panels and the Actions panel can call
- a **Home widget**, a small live tile that mirrors the service's state
- a **store listing** starter for the panel's page in the panel library

Give it an id and it makes the panel at once, with everything included unless
you leave something out:

```sh
npm create @mileniumhq/panel dev.paperboard.my-panel "My Panel" --no-widget
```

| Option | Effect |
| --- | --- |
| `--description <text>` | the one line shown on the library page |
| `--publisher <name>` | who the library page credits |
| `--no-service` | a UI-only panel; also leaves out the widget |
| `--no-widget` | no Home widget |
| `--no-store` | no store listing starter |
| `-h`, `--help` | the usage, and nothing else |

It exits 0 when the panel is made, 1 when it cannot be (the folder already
exists, say), and 2 for a command line it cannot read.

The panel is written to `./<panel-id>/`; it builds and tests with
[Bun](https://bun.sh). The scaffolder ends with the three commands that run it:

```sh
cd dev.paperboard.my-panel
bun install          # the panel's dependencies
bun run build        # typecheck, then the page, widget and service bundles
bunx paperapi link   # Paperboard runs the panel from this folder
```

The panel's own README.md has what comes after: `bun test`, and
`paperapi doctor`, `monitor`, `call` and `restart` for when something is off.

What it writes is a panel as the first-party ones are built today: PaperUI
components and props with no inline styles, a service whose state the pages
mirror through the bridge, failures shown with their reason, a
`test/uiStandards.test.ts` that keeps it that way, and a test preload that
keeps the tests off the network and off your real Paperboard data (a
throwaway `PAPERBOARD_DIR`).
