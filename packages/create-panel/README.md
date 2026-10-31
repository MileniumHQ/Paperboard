# create-panel

Scaffolds a Paperboard panel. Learn more at https://paperboard.dev/paperapi.

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

The panel is written to `./<panel-id>/`; it builds and tests with
[Bun](https://bun.sh). What it writes is a panel as the first-party ones are
built today: PaperUI components and props with no inline styles, a service
whose state the pages mirror through the bridge, failures shown with their
reason, and a `test/uiStandards.test.ts` that keeps it that way.
