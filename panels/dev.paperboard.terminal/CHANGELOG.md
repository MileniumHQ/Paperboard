# Changelog — Terminal (`dev.paperboard.terminal`)

## 2.0.0

UI is unchanged. All changes are the Alpha 2 service migration.

### New Features
- Tabs and scrollback survive restarts (service owns sessions, restores from `config` + `files`)
- Actions (for UI + automations): `list-tabs`, `create-tab`, `open-tab`, `rename-tab`, `close-tab`, `touch-tab`, `write-to-terminal`, `read-terminal-buffer`, `run-terminal-command`
- Trigger: `terminal-exit`
- `open-tab` returns scrollback so the UI can repaint after a service restart

### Changes
- Headless service (`dist/service.js` via `definePanelService`); UI is a thin `actions.call` client with explicit panel id on every call
- All `config` / `files` calls pass `dev.paperboard.terminal` explicitly (no ambient defaults)
- `terminalApi.onData` / `onExit` unsubscribes are now honored (renderer dispose + subscribe-once guard)
- `run-terminal-command` runs through `process.exec`

### UI
- No changes
