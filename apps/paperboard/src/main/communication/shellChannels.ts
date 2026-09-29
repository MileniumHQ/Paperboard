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
] as const;

export const SHELL_SEND_CHANNELS = [
    "ping",
    "updater-finish",
    "app-settings-changed",
    "relaunch-for-update",
    "quit-and-install",
    "renderer-log",
] as const;

export const SHELL_ON_CHANNELS = [
    "pong",
    "updater-progress",
    "app-update-available",
    "app-update-progress",
    "app-update-downloaded",
    "computers-changed",
    "discovery-changed",
] as const;
