# Paperboard Server branding

Drop files here; the daemon picks them up automatically. Everything is
optional; absence falls back to text/defaults, never an error.

| File        | Format                              | Used for                                              |
|-------------|-------------------------------------|-------------------------------------------------------|
| `icon.ico`  | Windows .ico, multi-size (16-256)   | Standalone `papercrane-*.exe` executable icon (replaces Bun's default logo). Stamped onto the built binary by `publish.ts` on every host — Bun refuses `--windows-icon` in a cross-compile, so the resources are rewritten in place after compilation. |
| `icon.png`  | PNG, 512x512                        | Reserved for docs/packaging and future use.           |
| `banner.txt`| Plain-text ASCII art, ~60 cols wide | Printed as the TUI header on standalone daemon start (replaces the "Paperboard Server" text line). |

Notes:
- `icon.ico` only affects fresh compiles; rebuild the server binaries after adding it (from the repo root: `bun scripts/publish.ts` → Build binaries, or `bun run usb` from `apps/paperboard`).
- The macOS/Linux standalone binaries show the OS generic executable icon; executables can't carry icons there without an app bundle.
- For a standalone deployment, copy this whole `branding/` folder next to the binary as `<exedir>/branding/` and `banner.txt` keeps working there too.
