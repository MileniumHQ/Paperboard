/** The package/manifest/token/route identity contract. Never rewrite an ID. */
export const PANEL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/;
export const PANEL_ID_MAX_LENGTH = 128;
const RESERVED_PANEL_IDS = ["library", "settings", "landing"];

export function isPanelId(value: unknown): value is string {
    return typeof value === "string" && value.length <= PANEL_ID_MAX_LENGTH &&
        PANEL_ID_PATTERN.test(value) && !RESERVED_PANEL_IDS.includes(value);
}

export function requirePanelId(value: unknown): string {
    if (!isPanelId(value)) {
        throw new Error("Invalid panel id: use a lowercase identifier (letters, digits, dots, hyphens, underscores), at most 128 characters; library, settings and landing are reserved");
    }
    return value;
}
