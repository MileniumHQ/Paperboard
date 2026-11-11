// retained channels; preload allowlist must be built from these

export const SHELL_INVOKE_CHANNELS = [
    "crane-credentials",
    "clipboard-read",
    "clipboard-write",
    "computers-list",
    "computer-probe",
    "computer-pair",
    "computer-update",
    "computer-remove",
    "computer-switch",
    "discovery-list",
    "open-panel-folder",
    "panel-listing-file",
    "app-version",
    "launch-options",
    "graphics",
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
    "panel-permission-answer",
    "panel-permissions-list",
    "panel-permission-set",
    "open-system-privacy",
    "app-settings-changed",
] as const;

export const SHELL_SEND_CHANNELS = [
    "ping",
    "quit-and-install",
    "quit-app",
    "renderer-log",
] as const;

export const SHELL_ON_CHANNELS = [
    "pong",
    "app-update-state",
    "update-queue",
    "computers-changed",
    "discovery-changed",
    "graphics-changed",
    "panel-permission-ask",
    "panel-screen-pick",
    "panel-permission-system",
    "panel-permissions-changed",
] as const;
