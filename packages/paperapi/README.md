APIs for Paperboard panels. Learn more at https://paperboard.dev/docs/paperapi/, and
start building with the guides at https://paperboard.dev/docs/developers/.

# PaperAPI

Client SDK for Paperboard panels talking to the PaperCrane daemon. Paperboard
is a dashboard for self-hosted programs, and panels are its apps. A panel's
page, its widgets and its service use PaperAPI to reach the machine:
terminals, supervised processes, file storage, downloads, config, the secret
vault, and Blocks, which every other panel, the Blocks panel and agents use.

Everything rides one WebSocket per computer. Every page and service connects
with the credential it was granted; nothing is read from ambient state.

## Install

```sh
bun add @mileniumhq/paperapi
```

## Quickstart: panel service

A service is the part of a panel that keeps running while Paperboard's window
is closed: a server, a bot, a schedule. Name its built file in the manifest's
`service` field and call `definePanelService` once at its top level.

```ts
import { blocksApi, defineContract, definePanelService, shape } from "@mileniumhq/paperapi";

const PANEL_ID = "dev.example.counter";

export const counterContract = defineContract(PANEL_ID, {
    calls: {
        increment: { input: shape.object({ by: shape.optional(shape.number()) }), output: shape.number() },
    },
    events: {
        countChanged: shape.object({ count: shape.number() }),
    },
    state: {
        shape: shape.object({ count: shape.number() }),
        initial: { count: 0 },
    },
});

definePanelService({
    contract: counterContract,
    // what the panel's own page asks: client.calls.increment({ by: 2 })
    calls: {
        increment: ({ by }, ctx) => {
            const count = ctx.state.count + (by ?? 1);
            ctx.setState({ count });
            ctx.emit("countChanged", { count });
            return count;
        },
    },
    // what the Blocks panel, agents and other panels can use
    onInit: async (ctx) => {
        await blocksApi.panel(PANEL_ID).register({
            commands: [{
                id: "reset",
                name: "Reset",
                description: "Sets the counter back to zero",
                run: () => ctx.setState({ count: 0 }),
            }],
        });
    },
});
```

State set with `ctx.setState` reaches the panel's page through the contract client.

## Quickstart: panel page

The host injects the page's credential when it serves the panel, so a page
connects on its own. `serviceClient` keeps a copy of the service's state, calls
it and hears what it emits:

```ts
import { serviceClient, configApi, getPanelId, requirePanelId } from "@mileniumhq/paperapi";
import { counterContract } from "./contract";

const client = serviceClient(counterContract);
const stop = client.state.subscribe((full) => render(full));

await client.calls.increment({ by: 2 });
const off = client.events.countChanged((payload) => console.log(payload));

// config names its panel every time
const panelId = requirePanelId(getPanelId());
await configApi.set({ theme: "dark" }, panelId);

// when the component unmounts
stop();
off();
client.state.dispose();
```

## Credentials

| Runtime | Where the credential comes from |
| --- | --- |
| Panel page, widget page | `window.__PAPERBOARD_CRANE`, injected by the host (port, token scoped to the panel, computer and panel id) |
| Service the daemon started | `PAPERBOARD_PANEL_ID`, `PAPERCRANE_PANEL_TOKEN` and `PAPERCRANE_PORT`, set by the daemon and read once. A service never reads `crane.json` |
| Any other script | `initPaperApi({ port, token, computerId })`, or with no options the handshake in `$PAPERBOARD_DIR/local/crane.json` (default `~/.paperboard`), sent only once the listener proves it holds the same token |

No panel code handles a token. Secrets go to the vault, never to config or a
payload.

## Secrets: the vault, by explicit panel id

```ts
import { secretsApi } from "@mileniumhq/paperapi";

await secretsApi.set("BOT_TOKEN", token, "dev.example.bot");
const { found, value } = await secretsApi.get("BOT_TOKEN", "dev.example.bot");
const names = await secretsApi.list("dev.example.bot"); // names only
await secretsApi.delete("BOT_TOKEN", "dev.example.bot");
```

Every API is documented at https://paperboard.dev/docs/paperapi/.

## CLI

`paperapi` (installed with the package; `bunx paperapi` in a panel folder) is
the panel developer's tool. Every command works on the Paperboard data folder
in `PAPERBOARD_DIR` (default `~/.paperboard`), prints results to stdout and
progress and errors to stderr, and exits **0** when done, **1** when something
is wrong, **2** when the command line is. Errors say what to run next. Colour
follows the terminal, `NO_COLOR` and `FORCE_COLOR`.

| Command | What it does |
| --- | --- |
| `paperapi link [panel-dir]` | Link a panel folder (default: here) into the data folder's `panels/`, so Paperboard runs it from your working copy. Refuses to replace an installed copy unless `--force`; the panel's data stays either way. |
| `paperapi unlink <panel-id>` | Remove a development link. Never removes an installed panel. |
| `paperapi links [--json]` | List development links, marking the ones whose folder is gone. |
| `paperapi doctor [panel-dir] [--json]` | Check the manifest, the build (and whether `src/` changed since), the link, that Paperboard is running, and that the panel's service answers. Each problem comes with what to run. Exits 1 if anything fails. |
| `paperapi monitor [--panel <id>] [--json]` | Watch PaperAPI calls, events, services and processes on this computer as they happen. `--json` prints one record per line. Keeps watching through a Paperboard restart; Ctrl+C stops it. |
| `paperapi call <panel-id> [name] [input] [--timeout <ms\|none>]` | Run one of the panel's blocks (`command.x`, `value.x`, `project/command.x`) or one of its service's calls, and print the result as JSON. `input` is one JSON value; the timeout defaults to 30000, up to 60000, or `none`. With no name, lists the panel's blocks and their inputs. |
| `paperapi restart [panel]` | Restart a panel's service so it runs the latest build. `panel` is a folder or an id (default: here). |
| `paperapi pack [panel-dir] [--out <dir>] [--json]` | Package the manifest, `dist` and the branding icon into `out/<id>-<version>.tar.gz`, building first (`bun run build`) when the entry is missing. Prints the archive and its sha256, or the release metadata with `--json`. |

`monitor`, `call` and `restart` act as this computer's host, with the
credential in `local/crane.json`; they need Paperboard running on this
computer. A typical loop:

```sh
bun run build && bunx paperapi restart
bunx paperapi call dev.example.counter increment '{"by":2}'
bunx paperapi monitor --panel dev.example.counter
```

`monitor` shows one line per record, and never a secret's value or a file's
contents: arguments that identify what was done (ids, names, paths, commands)
are shown, and every other argument by its shape (`‹14 chars›`, `[3]`,
`{city,units}`):

```text
04:21:15.206  dev.example.weather  secrets:set   2.0 ms  ok  name=apiKey value=‹14 chars›
04:21:15.209  dev.example.weather  config:set    0.7 ms  ok  id=dev.example.weather data={city,units}
04:21:15.209  dev.example.weather  secrets:get   0.1 ms  ✗ FORBIDDEN Cross-panel access refused: …  panelId=dev.example.other name=apiKey
04:21:15.210  dev.example.weather  event blocks:dev.example.weather:event.emit-forecast  84 B → 0 sockets
04:21:15.267  dev.example.weather  process started  weather-fetch
04:21:15.467  dev.example.weather  process exited  weather-fetch · code 0
```

## Timeouts

| Call family | Timeout |
| --- | --- |
| most calls (`terminalApi`, `fileApi`, `configApi`, `secretsApi`, `systemApi`, `packageApi`, `panelsApi.list`) | 30 s |
| `blocksApi.run`/`read`, `serviceClient` calls | 30 s by default; `timeoutMs` sets it, up to 60 s, or `null` waits for work that runs long |
| panel install and uninstall, backup and restore | none: the daemon may take longer than 30 s |
| `fileApi.download`, `packageApi.download` | none (progress events streamed) |
| registry index fetch | 10 s, with a 1 MB size cap |
| outstanding calls | 1000 per transport; past that new calls refuse |

With no deadline, the outstanding-call cap is the budget: prefer answering
long work at once and reporting progress through state.

## Trust model

Panels are **reviewed, not sandboxed**: a reviewed panel is trusted like
first-party code, and runs with the reach of the APIs above. What makes the
trust meaningful is the registry: the daemon resolves a release from its own
registry and refuses to install bytes whose checksum does not match the
registry's. A panel's secrets belong in the vault, never in config or a
payload.
