// Panel permissions as the shell and main both see them (main/panelPermissions.ts
// keeps the answers, main/panelPermissionHost.ts asks the shell).

export const PANEL_PERMISSIONS = ["microphone", "camera", "screen"] as const;
export type PanelPermission = (typeof PANEL_PERMISSIONS)[number];
export type PermissionAnswer = "allowed" | "denied";

export const isPanelPermission = (value: unknown): value is PanelPermission =>
    typeof value === "string" && (PANEL_PERMISSIONS as readonly string[]).includes(value);

export interface PanelPermissionEntry {
    panelId: string;
    permission: PanelPermission;
    answer: PermissionAnswer;
}

/** A panel wants something you haven't answered; the shell replies with a PermissionAnswer, or null when closed unanswered. */
export interface PermissionAsk {
    askId: string;
    computerId: string;
    panelId: string;
    permissions: PanelPermission[];
}

export interface ScreenSource {
    id: string;
    name: string;
    /** a data: URL */
    thumbnail: string;
}

/** What to share: the shell replies with a source id, or null for nothing. */
export interface ScreenPick {
    askId: string;
    computerId: string;
    panelId: string;
    sources: ScreenSource[];
}

/** The operating system blocks Paperboard itself from `permission`. */
export interface SystemBlock {
    computerId: string;
    panelId: string;
    permission: PanelPermission;
    platform: "darwin" | "win32";
}
