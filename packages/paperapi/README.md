APIs for Paperboard panels. Learn more at https://paperboard.dev/docs/paperapi/, and
start building with the guides at https://paperboard.dev/docs/guides/.

# PaperAPI

Client SDK for Paperboard panels talking to the PaperCrane daemon. Paperboard
is a dashboard for self-hosted programs — panels are the apps. PaperAPI is the
package a panel UI (running inside the Paperboard host) or a panel service
(running anywhere Node runs) uses to reach the machine: terminals, supervised
processes, file storage, downloads, config persistence, the secret vault, and
the panel action/trigger grid.

Everything rides a single WebSocket per computer scope. Every channel call
carries an explicit credential; nothing is injected from ambient state except
the deprecated fallbacks listed below.

## Install

```sh
bun add @mileniumhq/paperapi
```

## Quickstart — panel UI

Panel UIs run inside the Paperboard host, which injects daemon credentials
into the iframe at serve time (`__PAPERBOARD_CRANE`). The SDK reads them for
you; there is no token parsing in your code.

```ts
import { initPaperApi, getPanelId, terminalApi, configApi } from "@mileniumhq/paperapi";

await initPaperApi(); // connects to the daemon for this panel's scope

const id = getPanelId(); // injected at serve time; "" if unresolvable

const terminalId = `term-${id}`;
await terminalApi.create(terminalId, { cols: 80, rows: 24 });
const offData = terminalApi.onData(terminalId, (data) => console.log(data));

await configApi.set({ theme: "dark" }); // keyed to this panel's id
```

State sync between a panel's UI and its service uses the bridge:

```ts
import { createPanelBridge } from "@mileniumhq/paperapi";

const bridge = createPanelBridge({ defaultState: { count: 0 } });
bridge.onStateChange((patch, full) => render(full));

await bridge.call("increment"); // action call to this panel's service
const out = await bridge.actions.increment(); // same thing via proxy
// a long-running action: wait past the 30 s default instead of failing
await bridge.call("install", undefined, { timeoutMs: null });

// release the subscription and listeners when the component unmounts
bridge.dispose();
```

## Quickstart — panel service

Services run in Node with a `crane.json` handshake file (written by the
daemon at `local/crane.json` in the Paperboard data folder: `PAPERBOARD_DIR`,
or `~/.paperboard`) holding the local daemon's port and token. The SDK reads
it; you never touch tokens.

```ts
import { definePanelService } from "@mileniumhq/paperapi";
import { defineAction, defineTrigger } from "@mileniumhq/paperapi";

definePanelService({
    // optional here; defaults to PAPERBOARD_PANEL_ID resolved by the runtime
    id: "dev.example.counter",
    state: { count: 0 },
    actions: {
        increment: (ctx, by = 1) =>
            ctx.setState((prev) => ({ count: prev.count + by })),
    },
    triggers: [
        defineTrigger({
            id: "count-changed",
            name: "Count changed",
            description: "Fires whenever the counter changes",
            output: "number",
            listen: (_ctx, emit) => {
                // subscribe to your own state change and emit with the payload
                return () => {}; // return a teardown
            },
        }),
    ],
});
```

State set with `ctx.setState` is broadcast to the panel's UI; UI code reads it
via `createPanelBridge` above.

## Credentials model

| Runtime | Where credentials come from |
| --- | --- |
| Panel UI (iframe) | Host-injected `__PAPERBOARD_CRANE` (port + scoped token + panelId), read automatically |
| Panel service (Node) | `crane.json` handshake file (`~/.paperboard/local/crane.json`, or `PAPERBOARD_DIR/local/crane.json`) |
| Explicit | `initPaperApi({ port, token, computerId })` — e.g. talking to a paired remote machine |

No SDK method parses tokens, and panel code should never handle one. Secrets
go to the vault (below), not to config files or payload.

## Secrets — vault, explicit panelId

Bot tokens and API keys never go in panel config files. They live in the
daemon's secret vault, addressed always by an explicit `panelId`:

```ts
import { secretsApi } from "@mileniumhq/paperapi";

await secretsApi.set("BOT_TOKEN", token, "dev.example.bot");
const { found, value } = await secretsApi.get("BOT_TOKEN", "dev.example.bot");
const names = await secretsApi.list("dev.example.bot"); // names only
await secretsApi.delete("BOT_TOKEN", "dev.example.bot");
await secretsApi.purge("dev.example.bot");
```

## Actions and triggers — namespaced `panelId:action`

Actions are defined by panels and called across the grid. Registration is
namespaced by owning panel id; the two-argument "for my panel" forms throw a
clear identity error when this panel's id cannot be resolved, rather than
silently subscribing to nothing.

```ts
import { actionsApi } from "@mileniumhq/paperapi";

// register for this panel (identity must be resolvable)
await actionsApi.register("reset", () => ({ ok: true }));

// register a schema'd action for another panel's context
await actionsApi.register(
    defineAction({
        id: "increment",
        name: "Increment counter",
        run: (_ctx, inputs) => ({ count: inputs.by }),
    }),
    undefined, // handler comes from the definition
    "dev.example.counter",
);

// watch another panel's events
const off = actionsApi.on("dev.example.counter", "count-changed", (payload) => {
    console.log(payload);
});

// watch another panel's trigger
const offT = actionsApi.onTrigger(
    "dev.example.counter",
    "count-changed",
    (output) => console.log(output),
);
```

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
| `paperapi call <panel-id> [action] [inputs] [--timeout <ms\|none>]` | Call an action and print its result as JSON. `inputs` is one JSON value; the timeout defaults to 30000, up to 60000, or `none`. With no action, lists the panel's actions and their inputs. |
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
04:21:15.210  dev.example.weather  event actions:dev.example.weather:forecast  84 B → 0 sockets
04:21:15.267  dev.example.weather  process started  weather-fetch
04:21:15.467  dev.example.weather  process exited  weather-fetch · code 0
```

## Timeouts

| Call family | Timeout |
| --- | --- |
| most routing-table invokes (`terminal-*`, `file-*`, `config-*`, `secrets-*`, `system-*`, `package-*`, `panels-list`) | 30 s |
| `actions:call` | 30 s by default; `options.timeoutMs` sets it, up to a 60 s cap, or `null` to wait for a long-running action |
| `panel-uninstall` | none — the daemon may take longer than 30 s to finish shredding |
| `panel-install`, `file-download`, `package-download` | none (long-running, progress events streamed) |
| registry index fetch | 10 s, with a 1 MB stream-bound size cap |
| outstanding call cap | 1000 queued calls transport-wide; past that new calls refuse |

`actionsApi.call(targetPanel, action, inputs, options)` and `bridge.call` take
an `options.timeoutMs`. A numeric value above 60 s is refused at the daemon
boundary with a typed error; `null` removes the deadline for an action that
legitimately runs long. The outstanding-call cap, not the timer, is the budget
then — prefer acknowledging long work and reporting progress through state
over holding a caller's socket open.

## Trust model

Panels are **reviewed, not sandboxed**: a reviewed panel is trusted like
first-party code, and runs with the reach of the APIs above. What makes the
trust meaningful is the registry: the daemon resolves a release from its own
registry and refuses to install bytes whose checksum does not match the
registry's. A panel's secrets belong in the vault, never in config or a
payload.
