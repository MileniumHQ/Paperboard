/** The package/manifest/token/route identity contract. Never rewrite an ID. */
export const PANEL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/;
export const PANEL_ID_MAX_LENGTH = 128;
// shell routes, plus the daemon's host-owned config names: the daemon
// stores a config id's document by name, so a panel holding one of these
// ids would own host settings or the updater's crane_version record
const RESERVED_PANEL_IDS = ["library", "settings", "landing", "app-settings", "crane_version"];
const RESERVED_PANEL_ID_PREFIXES = ["shell-"];

export function isPanelId(value: unknown): value is string {
    return typeof value === "string" && value.length <= PANEL_ID_MAX_LENGTH &&
        PANEL_ID_PATTERN.test(value) && !RESERVED_PANEL_IDS.includes(value) &&
        !RESERVED_PANEL_ID_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function requirePanelId(value: unknown): string {
    if (!isPanelId(value)) {
        throw new Error("Invalid panel id: use a lowercase identifier (letters, digits, dots, hyphens, underscores), at most 128 characters; library, settings, landing, app-settings, crane_version and shell-* are reserved");
    }
    return value;
}
