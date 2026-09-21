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

To build from source, clone the repository and run the setup command from the root — see the [root README](../../README.md#development). Then run the commands below from `apps/paperboard`.

### Dev Mode
To run Paperboard without building the entire app:
```zsh
bun run dev
```
This opens a local dev process.

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

### License
This part of the monorepo is licensed under PolyForm Noncommercial.