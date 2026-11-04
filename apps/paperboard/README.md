## Paperboard

This is where the code for the Electron app and server lives.

Paperboard is split into a frontend that displays panel UI and a backend (PaperCrane) that carries on panel actions in the foreground and background.

## Features
- **Instant install** - Panels are contained SolidJS projects that interact with Paperboard through a WebSocket. They're downloaded in seconds through a registry.
- **Run locally or remotely** - PaperCrane can be packaged separately from Paperboard to run on another computer over the local network, and can keep running its processes even when the Electron app closes.
- **Actions** - Panels can interact with each other using an Actions schema that lets them share functions.
- **Lightweight** - Paperboard runs processes as they're intended to run on every platform, without messy manual configuration or Docker.

## Compiling / Building
You can download directly from Paperboard's website or GitHub Releases, but if you don't trust those (fair enough), you can also compile and run the code yourself.
Note that Paperboard is not yet signed or notarized for macOS or Windows, so SmartScreen or Gatekeeper may have a fit if you download it from the web.

To build from source, clone the repository and run the setup command from the root — see the [root README](../../README.md#development). `setup` also fetches the Electron runtime binary, so `bun run dev` works immediately. Then run the commands below from `apps/paperboard`.

### Dev Mode
To run Paperboard without building the entire app:
```zsh
bun run dev
```
This opens a local dev process.

### Browser mode
Browser mode is a dev tool for agents (screenshots, testing, browser use), not something shipped to users. It serves the app to a browser instead of an Electron window:
```zsh
bun run dev:browser                        # from source
Paperboard --browser                       # an installed build
Paperboard --browser --browser-port=4700   # pin the port (default: any free port)
```
No window or browser tab opens. Paperboard serves the app at `http://paperboard.localhost:<port>` and prints that address to the terminal; point your agent's browser at it.

- Each panel gets its own origin (`http://<computer>.<panel>.paperboard.localhost:<port>`), the same isolation panels have in the desktop app.
- There is no sign-in. The server only listens on `127.0.0.1`; never expose the port on a network.
- Works in Chromium-based browsers and Firefox, which resolve `*.localhost` to your own machine. Safari may not.
- The desktop-only parts don't exist here: no auto-update pass (updates apply on the next windowed launch) and no title-bar integration.

### Skipping tutorials
Paperboard shows its own tutorial the first time it opens, and each panel's the first time you open that panel. `--no-tutorial` stops any of them opening by themselves, which keeps dev runs and agent-driven sessions free of surprise dialogs:
```zsh
bun scripts/launch.ts dev -- --no-tutorial              # windowed, from source
bun scripts/launch.ts dev -- --browser --no-tutorial    # browser mode, from source
Paperboard --no-tutorial                                # an installed build
```
Tutorials still open by hand (**Show Tutorial** on a panel's right-click menu, **Show tutorial** in App Settings), and nothing is recorded as seen until you finish one.

### Compiling
Compiling for all platforms for GitHub Releases is done on Linux x64. However, you can still compile it yourself.

Paperboard (Electron app)
```zsh
bun run build             # Typecheck and build
bun run build:win         # Windows installer
bun run build:mac-x64     # macOS .zip (Intel)
bun run build:mac-arm64   # macOS .zip (Apple Silicon)
bun run build:linux       # Linux AppImage (x64)
bun run build:linux-arm64 # Linux AppImage (ARM64)
bun run build:unpack      # No installer, just an unpacked directory
```

Paperboard server (standalone PaperCrane)
```zsh
bun build --compile --target=bun-linux-x64    ./papercrane/main.ts --outfile ./dist/papercrane-linux-x64
bun build --compile --target=bun-linux-arm64  ./papercrane/main.ts --outfile ./dist/papercrane-linux-arm64
bun build --compile --target=bun-darwin-x64   ./papercrane/main.ts --outfile ./dist/papercrane-macos-x64
bun build --compile --target=bun-darwin-arm64 ./papercrane/main.ts --outfile ./dist/papercrane-macos-arm64
bun build --compile --target=bun-windows-x64  ./papercrane/main.ts --outfile ./dist/papercrane-windows-x64.exe
```

### Running the server
The server (`papercrane`, the Paperboard server daemon) is one binary. `papercrane --help` lists everything; the short version:
```zsh
papercrane                      # start it with the interactive screen ([p] pairs a computer)
papercrane install-service      # run it in the background, starting with the computer
papercrane pair                 # show a pairing code on the running daemon
papercrane status               # is it running? (exits 3 when it isn't)
papercrane uninstall-service    # remove the service; your data stays
```
- No binary yet? `npx @mileniumhq/paperboard serve` downloads the signed release for your computer, checks it against the release key, and runs it (see [packages/crane-launcher](../../packages/crane-launcher/README.md)). Any command above works the same way.
- `serve` is the default command, so `papercrane --headless --port 45465` still works like it always did.
- `install-service` writes a systemd unit on Linux (`~/.config/systemd/user/papercrane.service`, or `/etc/systemd/system/` with `--system`) and a launchd job on macOS (`~/Library/LaunchAgents/dev.paperboard.papercrane.plist`, or `/Library/LaunchDaemons/` with `--system`), enables it and waits for the daemon to answer. Windows prints the Task Scheduler command to use instead. `--dry-run` prints the file without touching anything.
- The service runs `--headless` and stops only the daemon process (`KillMode=process`, `AbandonProcessGroup`), so game servers keep running through a restart and the next daemon adopts them.
- A user service on Linux stops when your last session ends unless lingering is on (`sudo loginctl enable-linger $USER`); install-service tells you when it isn't. On a headless box, `--system` is the better fit.
- Logs: `journalctl --user -u papercrane -f` (Linux), `~/Library/Logs/Paperboard/papercrane.log` (macOS), plus the daemon's own logs in `~/.paperboard/logs`.
- `--data-dir` (or `PAPERBOARD_DIR`) moves the data directory. `PAPERCRANE_PORT` and `PAPERCRANE_HOST` set the listen address when the flags aren't given.
- A wrong flag prints the error and usage and exits 2. Nothing starts.

### License
This part of the monorepo is licensed under PolyForm Noncommercial.