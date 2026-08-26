// Retained IPC channels; the preload allowlist must be built from these.

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
] as const;

export const SHELL_SEND_CHANNELS = [
    "ping",
    "updater-finish",
    "app-settings-changed",
    "relaunch-for-update",
    "renderer-log",
] as const;

export const SHELL_ON_CHANNELS = [
    "pong",
    "updater-progress",
    "computers-changed",
    "discovery-changed",
] as const;
