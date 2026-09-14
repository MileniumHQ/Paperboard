# Paperboard Server branding

Drop files here; the daemon picks them up automatically. Everything is
optional; absence falls back to text/defaults, never an error.

| File        | Format                              | Used for                                              |
|-------------|-------------------------------------|-------------------------------------------------------|
| `icon.ico`  | Windows .ico, 256x256 multi-size    | Standalone `papercrane-*.exe` executable icon (replaces the default Bun icon). Applied at compile time by `publish.ts`, **only when compiling on a Windows host** (Bun rejects the flag in cross-compiles, so Linux/macOS-built exes keep defaults). |
| `icon.png`  | PNG, 512x512                        | Reserved for docs/packaging and future use.           |
| `banner.txt`| Plain-text ASCII art, ~60 cols wide | Printed as the TUI header on standalone daemon start (replaces the "Paperboard Server" text line). |

Notes:
- `icon.ico` only affects fresh compiles; rebuild the server binaries after adding it (`bun devutils/publish.ts usb`, or `./publish.ts crane`).
- The macOS/Linux standalone binaries show the OS generic executable icon; executables can't carry icons there without an app bundle.
- For a standalone deployment, copy this whole `branding/` folder next to the binary as `<exedir>/branding/` and `banner.txt` keeps working there too.
