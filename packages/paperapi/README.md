APIs for Paperboard panels. Learn more at https://paperboard.dev/paperapi.

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

Services run in Node with a `crane.json` handshake file (written once by the
host at `$~/.paperboard/local/crane.json`) holding the local daemon's port
and token. The SDK reads it; you never touch tokens.

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

`paperapi` (installed with the package) is the developer tool:

| Command | What it does |
| --- | --- |
| `paperapi link [dir]` | Symlink a local panel dir into `~/.paperboard/panels` for live dev. `--force` replaces an existing target (renamed to a trash entry before delete). |
| `paperapi unlink <panel-id>` | Remove a dev link (refuses physical directories). |
| `paperapi links` | List active dev links, marking broken ones. |
| `paperapi pack [dir]` | Copy the panel manifest, the directory holding `manifest.base` (plus `dist`, branding/icon), into `out/<id>-<version>.tar.gz` and print release metadata with the sha256. Auto-builds (`bun run build`) when the entry is missing. |

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

Panels are **reviewed, not sandboxed** — a reviewed panel is trusted like
first-party code. What makes review meaningful is the registry and the
manifest: panels declare network egress (`network.hosts` / `network.mode`),
and review checks declared hosts against what they actually fetch, with the
panel CSP built from it. Install refuses without a registry-provided
checksum bound to the very bytes being downloaded. See the Paperboard trust
model docs (`AGENTS.md` in the Paperboard workspace) for the full picture.
