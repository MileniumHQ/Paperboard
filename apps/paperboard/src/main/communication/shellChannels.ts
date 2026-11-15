// retained channels; preload allowlist must be built from these

// served by every shell host: Electron IPC and the browser-mode bridge (shellHandlers.ts)
export const SHARED_SHELL_INVOKE_CHANNELS = [
    "crane-credentials",
    "computers-list",
    "computer-probe",
    "computer-pair",
    "computer-update",
    "computer-remove",
    "computer-switch",
    "computer-reorder",
    "discovery-list",
    "open-panel-folder",
    "panel-listing-file",
    "app-version",
    "launch-options",
    "graphics",
] as const;

export const SHELL_INVOKE_CHANNELS = [
    ...SHARED_SHELL_INVOKE_CHANNELS,
    "app-update-state",
    "update-queue",
    "update-release",
    "update-check",
    "open-update-download",
    "panel-file-export",
    "panel-file-import",
    "panel-loopback-redirect",
    "panel-loopback-redirect-cancel",
    "backup-gdrive-connect",
    "backup-gdrive-cancel",
    "panel-permission-answer",
    "panel-permissions-list",
    "panel-permission-set",
    "open-system-privacy",
    "app-settings-changed",
    "quit-and-install",
    "panels-unsaved",
    "quit-answer",
] as const;

export const SHELL_SEND_CHANNELS = [
    "quit-app",
    "renderer-log",
] as const;

export const SHELL_ON_CHANNELS = [
    "app-update-state",
    "update-queue",
    "computers-changed",
    "discovery-changed",
    "graphics-changed",
    "panel-permission-ask",
    "panel-screen-pick",
    "panel-permission-system",
    "panel-permission-failed",
    "panel-permissions-changed",
    "quit-ask",
] as const;
