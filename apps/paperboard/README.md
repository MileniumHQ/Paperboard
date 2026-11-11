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
People open Paperboard in their browser with **Open in Browser** in the tray menu or `paperboard --web` (see the docs' "Use Paperboard in a browser"). For development, `--browser` serves the same thing without opening a tab and prints a sign-in link, for an agent's own browser (screenshots, testing, browser use):
```zsh
bun run dev:browser                        # from source
Paperboard --browser                       # an installed build
Paperboard --browser --web-port=4700       # pin the port (default for --browser and dev builds: any free port)
```
Paperboard serves the app at `http://localhost:<port>` and prints a sign-in link. It works once, for five minutes; run `--browser` again (the running app prints a new one) when you need another.

- The installed app serves on port 45470 for `--web` and Open in Browser, so bookmarks keep working.
- Panels are served from `/_panel/<computer>/<panel>/` on the same origin, as on Paperboard web.
- Browsers stay signed in for 30 days (`local/browser-sessions.json` keeps hashes only). Sign Out is in App Settings.
- It only listens on `127.0.0.1`. The desktop-only parts don't exist here: no auto-update pass (updates apply on the next windowed launch) and no title-bar integration.

### Compiling
Compiling for all platforms for GitHub Releases is done on Linux x64. However, you can still compile it yourself.

Paperboard (Electron app)
```zsh
bun run build             # Typecheck and build
bun run build:win         # Windows installer
bun run build:mac-x64     # macOS .zip (Intel)
bun run build:mac-arm64   # macOS .zip (Apple Silicon)
bun run build:linux       # Linux AppImage, deb and rpm (x64)
bun run build:linux-arm64 # Linux AppImage, deb and rpm (ARM64)
bun run build:unpack      # No installer, just an unpacked directory
```
The Linux builds make an rpm, which needs `rpmbuild` (the `rpm` package on Debian and Ubuntu, `rpm-tools` on Arch, `rpm-build` on Fedora).

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