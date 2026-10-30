# Game modules

Minecraft Java is the only registered game. This refactor adds no other game or runtime, and preserves Minecraft's installers, launch arguments, readiness markers, console parsing, port names, tabs, Actions schemas and widgets.

## Module contract

- `src/games/types.ts`: UI-safe `GameDefinition`, `GameOptions`, `GameFeatures`, `GameTab`, `Control` and `PackageRequirement`. `describe({ software, version, settings? })` resolves tabs, Action ids, widget ids, command control and runtime packages. Minecraft loader/version facts remain Minecraft-specific, not a required schema for future games.
- `src/games/index.ts`: bundled `games`, `gameFor(id)` and the new-server `defaultGame`. Unknown ids throw, including when deserializing stored servers. `assertGameAction` enforces resolved capabilities before a service Action executes.
- `src/games/serviceTypes.ts`: service-only `GameService`, `LaunchCommand`, `PreparedLaunch` and `PortSpec`. Hooks own initial state, options, launch preparation, mutation checks, stop/control, line observation, initialization, icons, disposal and backup consistency. `src/games/service.ts` resolves these implementations using the current server's explicit id.
- `src/games/uiTypes.ts` and `ui.tsx`: bundled `GameUI.create` produces a per-view `GameView` for setup and game tab renderers separately from service code. App renders the resolved menu in order; Files, Logs and Backups are shared tabs. Minecraft's existing specialized components remain in `src/components`, owned through `minecraft/ui.tsx`.
- `src/games/minecraft/`: metadata in `index.ts`; service hooks in `service.ts`; launch in `launch.ts`; readiness, players/chat/gamerules/port observation and on-ready work in `observe.ts`; Java in `java.ts`; installers in `softwareInstall.ts` and `providers/`; Actions and options in `actions.ts` and `config.ts`; port files in `ports.ts`; save acknowledgment and crash recovery in `saving.ts`. Import these implementations directly from `src/games/minecraft/`; shared service infrastructure stays in `src/service/`.

Shared lifecycle owns process start/exit/restart, chunk buffering and force-kill timers. It receives a resolved executable, args, cwd and env; it does not construct Java commands or parse Minecraft output. Minecraft keeps its existing evidence-based readiness markers; this refactor does not introduce a new startup deadline or change their behavior. A new game's readiness adapter must provide a bounded, evidence-based failure path.

Modules yield `PortSpec`s in order, reading/writing their own files; `src/service/ports.ts` claims/prepares them through the Port API. Minecraft keeps `java` and `bedrock` claim identities and existing per-server prefixes. Linked allocation waits for the first game needing it.

Log viewing and command input are distinct; `Control` currently supports `none` and `stdin`. Players/moderation require a real roster adapter. Minecraft's quiesce backup policy retains save-off/save-all/save-on acknowledgments, cleanup on copy failure, and the pause marker across service restarts. An offline-only policy refuses live backup. Widgets stay declared in the manifest; choices and runtime rendering consult resolved support and unsupported selections fail visibly.

`PackageRequirement` describes runtime ids from the daemon Package API (Java today). Setup installs the required Java; launch verifies it. Future distribution, host support, options schemas, RCON/HTTP control and runtime runners belong to the first module actually using them, with no placeholder implementations. Minecraft's protected-data and install-file rules remain specific to Minecraft; a future module must define its own persistent-data boundary.

## Shared packages

| Resource | Where |
|---|---|
| Java, SteamCMD bootstrap, pinned Wine/Proton | Daemon packages under `$PAPERBOARD_DIR/packages`, via `packageApi` |
| SteamCMD's mutable install/cache | A tool workspace under `$PAPERBOARD_DIR`, use serialized |
| Steam account session | Private workspace; credentials in the vault |
| Game binaries + Steam manifests | Per-server install directory |
| Saves, settings, mods, logs | Per-server persistent data, kept on uninstall |
| Wine prefix / Proton compatdata | Per server. Runners are shared, prefixes never are |

SteamCMD adapter: verified per-platform bootstrap; `force_install_dir` before login; explicit target platform (Windows depots for Wine/Proton) and branch; anonymous where possible and never silently retry with an account; Steam Guard as an interactive challenge, passwords/tokens in the vault, one-time codes never stored, output redacted; GSLTs, Klei tokens, RCON passwords as separate secrets; serialize SteamCMD and per-server mutations; verify success from output *and* files; stop the server before updates (`validate` can overwrite edited files); record app id, platform, branch, build id.

Wine translates APIs, not CPUs. Proton is Linux-only. Rosetta runs Mac Intel binaries, not Linux ones. Most Steam servers are x86-64 only. Unsupported OS/CPU combinations are marked unsupported, never implied to work.

## Games

L/W/M = native dedicated server on Linux/Windows/macOS. Compatibility routes are candidates, not tested claims.

| Game | Obtain | Native | Ports | Config / admin | Mods / difficulty |
|---|---|---|---|---|---|
| Minecraft Bedrock | Publisher ZIP | L/W x64, no M | UDP 19132 (v4), 19133 (v6) | `server.properties`, JSON allowlist; stdin; `save hold/query/resume` | Behavior/resource packs; medium |
| Terraria | Publisher ZIP | L/W/M (Mac Intel, Rosetta) | TCP 7777 | `serverconfig.txt`; stdin `save`/`exit` | TShock variant; low–medium |
| tModLoader | GitHub release; Steam 1281930 | L/W/M with .NET | TCP 7777 | Terraria + mod config; stdin | `.tmod`/Workshop; medium |
| Valheim | SteamCMD 896660, anon | L/W; M unverified | UDP 2456–2457 linked pair | CLI args, admin lists; no vanilla RCON | BepInEx/Thunderstore; medium |
| Factorio | Free Linux headless; licensed W/M | L/W/M | UDP 34197; opt. TCP RCON | JSON + INI; stdin/RCON | Mod portal; low–medium |
| Palworld | SteamCMD 2394010, anon | L/W x64 | UDP 8211; opt. TCP 25575 RCON, 8212 REST | `PalWorldSettings.ini`; RCON/REST | medium |
| Satisfactory | SteamCMD 1690800, anon | L/W x64 | 7777 TCP+UDP, 8888 TCP | INI + HTTPS API (save/shutdown) | SML; medium–high |
| Counter-Strike 2 | SteamCMD 730 (not 740); GSLT to list | L/W x64 | UDP 27015; TCP 27015 RCON | CFG/CLI; RCON | Workshop, Metamod; medium–high |
| Rust | SteamCMD 258550, anon | L/W x64 | UDP 28015, 28017 query; TCP 28016 WebRCON | CFG/CLI; WebRCON (not Source RCON) | Oxide/Carbon; medium–high |
| ARK: Survival Ascended | SteamCMD 2430930 (not ASE 376030) | W x64; Linux via Proton | UDP 7777/7778, opt. 27015; TCP 27020 RCON (verify) | INI + URL-style CLI; RCON `SaveWorld`/`DoExit` | CurseForge; high |
| Project Zomboid | SteamCMD 380870, anon | L/W; M custom path | UDP 16261/16262; opt. RCON | INI, Lua, SQLite; stdin/RCON | Workshop; medium–high |
| 7 Days to Die | SteamCMD 294420, anon | L/W | TCP 26900, UDP 26900–26903; opt. 8081 Telnet | `serverconfig.xml`; Telnet | XML modlets; medium–high |
| Enshrouded | SteamCMD 2278520, anon | W x64; Linux via Wine/Proton | UDP 15637 query | `enshrouded_server.json`; no RCON | high |
| V Rising | SteamCMD 1829350, anon | W x64; Linux via Wine/Proton | UDP 9876/9877; opt. RCON | JSON; RCON | BepInEx; high |
| Garry's Mod | SteamCMD 4020, anon; GSLT | L/W (Mac builds discontinued) | UDP 27015; TCP 27015 RCON | CFG, Lua; RCON | Workshop/Lua; medium |
| Don't Starve Together | SteamCMD 343050, anon; Klei token in vault | L/W | UDP 10999/11000, 10888 shard, per-shard Steam ports | `cluster.ini`, per-shard `server.ini`; Lua stdin | high: one server = several shard processes |

Notes:
- **Bedrock** is its own game id (`minecraft-bedrock`); Geyser stays a Java-server bridge.
- **Factorio** is the best second game: native everywhere, simple saves/config, stdin and RCON. **Terraria** is the next smallest.
- **Valheim** needs linked ports (base, base+1); the Port API's independent "next free" can't keep that, so linked allocation arrives with it.
- **DST** needs process groups (surface + caves) and whole-cluster backups; don't build that until DST.
- **ASA, Enshrouded, V Rising** are Windows-first; they wait for a pinned, tested Wine/Proton runner.

## Next implementation order

1. Completed: per-server identity and storage, registry, resolved launch, Minecraft service hooks, port/backup policy, resolved tabs/Actions/widgets and runtime package descriptions.
2. Add Factorio (or Terraria) as a complete bundled module with its own options, launch/install records, platform checks and tests.
3. Add SteamCMD with a native server, then pinned compatibility runners only when needed. No unfinished game is offered in the UI.
