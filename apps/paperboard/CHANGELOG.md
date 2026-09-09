# Changelog — Paperboard

## 2.0.0-alpha — Alpha 2

### New Features
- Actions panel: visual automation and workflow builder with 50+ blocks, user Functions, and file-backed variables
- Bot Creator panel: build Discord bots from the UI
- Terminal: tabs and scrollback persist across restarts
- Folder button: open the data directory, or browse files on a remote computer
- Run on startup and default-panel app settings
- Panels keep their own workspace data under their own files directory

### Changes
- Panels run in the background even with the UI closed, and re-attach on launch
- Package installs are atomic, with zip support
- Duplicate computer names on a LAN get renamed instead of colliding
- Standalone Windows terminals use a sidecar console
- Windows version names come from the registry DisplayVersion
- File browsing never surfaces secrets, even when authenticated
- App version `1.0.0-alpha` → `2.0.0-alpha`

### UI
- TopBar: version label and Restart-to-update button with download progress
- Sidebar: panel retry with classified probe errors
- Settings: run-on-startup, default panel, notifications, data directory
- Computer context menu

### Technical Changes
- PaperAPI `0.1.0` → `2.0.0`: Actions API, panel services, UI bridge, system notify / screenshot / volume / mute / beep, `process.exec`
- PaperUI `0.1.0` → `1.1.0`: layout props, Portal menus, rail labels

## 1.0.0-alpha — Alpha 1

First ever alpha release. App shell with computer rail, panel library, WebDAV file browsing stub, embedded supervisor, auto-updater wiring, and Minecraft panel preview.
