## Paperboard

This is where the code for the Electron app lives. The server daemon it runs is in [apps/daemon](../daemon/README.md).

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
Paperboard serves the app at `http://localhost:<port>` and prints a sign-in link. A throwaway data directory has no panels: link this checkout's first (`PAPERBOARD_DIR=<dir> bun run link:panels` from the repo root, after `bun run build:panels`). Vite's reload socket goes through the same port, so edits to the shell reload the tab. It works once, for five minutes; run `--browser` again (the running app prints a new one) when you need another.

- The installed app serves on port 45470 for `--web` and Open in Browser, so bookmarks keep working.
- Panels are served from `/_panel/<computer>/<panel>/` on the same origin, as on Paperboard web.
- Browsers stay signed in for 30 days (`local/browser-sessions.json` keeps hashes only). Sign Out is in App Settings.
- It only listens on `127.0.0.1`. The desktop-only parts don't exist here: no auto-update pass (updates apply on the next windowed launch) and no title-bar integration.

### Compiling
GitHub Releases are compiled by [the release workflow](../../.github/workflows/release.yml), each target on a runner of its own OS (macOS builds are signed on macOS, Windows builds carry their version info); only Linux ARM64 is cross-built on x64. You can still compile it yourself.

Paperboard (Electron app)
```zsh
bun run build             # Typecheck and build
bun run build:win         # Windows installer and MSI
bun run build:mac-x64     # macOS .zip (Intel)
bun run build:mac-arm64   # macOS .zip (Apple Silicon)
bun run build:linux       # Linux AppImage, deb and rpm (x64)
bun run build:linux-arm64 # Linux AppImage, deb and rpm (ARM64)
bun run build:unpack      # No installer, just an unpacked directory
```
The Windows build makes an MSI with WiX, which runs only on Windows: off Windows it needs wine and wine-mono.
The Linux builds make an rpm, which needs `rpmbuild` (the `rpm` package on Debian and Ubuntu, `rpm-tools` on Arch, `rpm-build` on Fedora).

The server daemon (PaperCrane) is built and run from [apps/daemon](../daemon/README.md).

### License
This part of the monorepo is licensed under PolyForm Noncommercial.