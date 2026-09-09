# Changelog — `@paperboard-dev/paperapi`

## 2.0.0

### New Features
- Actions API: panels can `call`, `register`, `list`, and `emit` actions and triggers across panels
  - `actions.call(panelId, name, args)`, `register`, `registerTrigger`, `registerMultiple`
  - `list`, `listTriggers`, `on`, `onTrigger`, `onRegistryChange`
- Panel services: `definePanelService({ state, actions, triggers, onInit })` for headless background logic with `setState` / `emit` / `emitTrigger`
- UI bridge: `createPanelBridge({ panelId })` hydrates shared state (`__getState` / `__stateChanged`) and proxies `actions.call`
- Action schemas: `defineAction`, `defineTrigger`, `defineType`, `listTypes`, `isTypeCompatible`
- System: `notify(title, message)`, `screenshot(savePath)`, `setVolume`, `setMuted`, `beep`
- Process: `exec(command, args, { cwd, env, timeoutMs })` → `{ stdout, stderr, exitCode }`
- CLI: `link`, `unlink`, `links`, `pack` via `commander`, with `-f/--force`

### Changes
- `process.run` now waits for `process-exit` and resolves `{ exitCode }` (timeout → `{ exitCode: -1 }`)
- Files, packages, and processes use collision-free client ids (`newClientId`)
- Transport keeps a registry of action/trigger handlers and replays them on reconnect
- Browser crane credentials must come from `__PAPERBOARD_CRANE` (scope-checked); the `fetch("/__crane")` fallback was removed
- `terminalApi.onData` / `onExit` return an unsubscribe function
- Service runtimes can set `PAPERBOARD_PANEL_ID` instead of relying on `panel://` host parsing
- Debug logging gated behind `PAPERBOARD_TRANSPORT_DEBUG=1` (`debug` / `debugErr`)

### Technical Changes
- Version `0.2.0` → `2.0.0`
- New dependencies: `commander`, `ws` (+ `@types/ws`)
- New modules: `src/actions.ts`, `src/schema.ts`, `src/service.ts`, `src/bridge.ts`, `src/channels.ts`, `src/transport/registry.ts`

## 0.2.0

### Changes
- `REGISTRY_URL` centralized in `src/config.ts` (env `ORIGAMI_REGISTRY_URL` or `https://origami.ariapis.com`)
- `getPanelId()` parses the panel id from the host; `getHost()` delegates to it
- `ipc.on()` returns an unsubscribe that releases terminal/process tracking
- `process-run` returns the daemon result and tracks the process; `process-exists` / `attach` log via `debugErr`
- `file:download` uses no timeout; registry lookups no longer fail silently
- `tsconfig.json` includes `bin/` and `test/`

## 0.1.0

Alpha 1 baseline. `config`, `file`, `process`, `package`, `panels`, `system`, `terminal`, `ipc`, `ws` bridge.
