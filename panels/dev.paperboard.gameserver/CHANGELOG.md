# Changelog — Game Server (`dev.paperboard.gameserver`)

## 1.1.0

### New Features
- Headless service (`dist/service.js`): server keeps running with the UI closed and re-attaches on launch
- Service actions: `run-command`, `start-server`, `stop-server`, `restart-server`, `load-config`, `say-chat`, `kick-player`, `ban-player`, `list-players`, `player-count`
- Service triggers: `chat-message`, `player-joined`, `player-left`, `server-started`, `server-stopped`
- Welcome workflow: greets joins with `tellraw` + gives 20 golden apples (example automation)
- Platform helper: `isWindowsTarget()`

### Changes
- Server lifecycle moved into the service: loud errors for missing Minecraft version, missing Java package, or missing `server.jar`
- Only real chat senders emit `chat-message`; join/leave emit their own triggers
- Diagnostics narrowed to port-conflict, world-locked, and EULA (corrupt-world / OOM rules dropped); actions are `killPortAndRetry` and `acceptEula`
- `getRequiredJavaVersion()` returns `null` instead of defaulting to `java-8`
- Software manifest cached in memory; downloads require an explicit version
- Chat parsing splits `<Player>` messages from `[Server]` / join / leave system lines
- All `config` / `files` calls pass the panel id explicitly
- Manifest `1.0.0` → `1.1.0` with `"service": "./dist/service.js"`

### UI
- Issue modal buttons now run their fix (`killPortAndRetry`, `acceptEula`, `resetWorldAndStart`) instead of just linking
- Setup errors when the Java package cannot be determined

### Technical Changes
- UI thinned to a bridge client (`createPanelBridge` + `applyStatePatch`); logic lives in `src/core/` and `src/service/`
- Build now bundles `src/service.ts` to `dist/service.js`
- New tests: `test/workflow.test.ts`

## 1.0.0

### New Features
- Tabs: Options, Game Rules, Players, Plugins, Worlds, Advanced (RAM with `supports()` gating)
- Options: version-gated `server.properties` editor with 400ms debounce save
- Game Rules: `GAMERULES` list filtered by `addedIn` version, wiki links, live writes
- Players: online/seen names, stats, playtime, moderation actions, forget-data
- Plugins: Modrinth search (24 results), `DOMPurify` + `marked` detail view, `mods/` vs `plugins/` handling, install records
- Worlds: world-dir list/delete with `level.dat` detection
- Capabilities table (`CAPABILITIES`, `supports()`, `mcVersionAtLeast()`), file sanitize/list helpers, log/chat parsers, player join/leave + stat restore from `latest.log`

### Changes
- Renamed to `@paperboard-dev/paperapi` / `@paperboard-dev/paperui`; `pack: bunx paperapi pack`
- Menu: `Plugins/Mods` → `Plugins`, `Version/World/Backups` → `Worlds/Advanced`
- New icon (`512×512`, ~12KB)
- Note: this checkpoint regressed the manifest to `1.0.0`; treat `1.1.0` as the successor to Alpha `1.0.1` below

## 1.0.1

Alpha 1 baseline. Server diagnostics, issue modal, wizard version validation.
