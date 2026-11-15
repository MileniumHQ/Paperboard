// Panel permissions as the shell and main both see them (main/panelPermissions.ts
// keeps the answers, main/panelPermissionHost.ts asks the shell).
import { shape, type Infer } from "@mileniumhq/paperapi";

export const PANEL_PERMISSIONS = ["microphone", "camera", "screen"] as const;
export const panelPermission = shape.oneOf(...PANEL_PERMISSIONS);
export type PanelPermission = Infer<typeof panelPermission>;
export const permissionAnswer = shape.oneOf("allowed", "denied");
export type PermissionAnswer = Infer<typeof permissionAnswer>;

export const isPanelPermission = (value: unknown): value is PanelPermission =>
    typeof value === "string" && (PANEL_PERMISSIONS as readonly string[]).includes(value);

export const panelPermissionEntry = shape.object({
    panelId: shape.text(),
    permission: panelPermission,
    answer: permissionAnswer,
});
export type PanelPermissionEntry = Infer<typeof panelPermissionEntry>;

/** A panel wants something you haven't answered; the shell replies with a PermissionAnswer, or null when closed unanswered. */
export const permissionAsk = shape.object({
    askId: shape.text(),
    computerId: shape.text(),
    panelId: shape.text(),
    permissions: shape.list(panelPermission),
});
export type PermissionAsk = Infer<typeof permissionAsk>;

const screenSource = shape.object({
    id: shape.text(),
    name: shape.text(),
    /** a data: URL */
    thumbnail: shape.text(),
});
export type ScreenSource = Infer<typeof screenSource>;

/** What to share: the shell replies with a source id, or null for nothing. */
export const screenPick = shape.object({
    askId: shape.text(),
    computerId: shape.text(),
    panelId: shape.text(),
    sources: shape.list(screenSource),
});
export type ScreenPick = Infer<typeof screenPick>;

/** The operating system blocks Paperboard itself from `permission`. */
export const systemBlock = shape.object({
    computerId: shape.text(),
    panelId: shape.text(),
    permission: panelPermission,
    platform: shape.oneOf("darwin", "win32"),
});
export type SystemBlock = Infer<typeof systemBlock>;

/** Paperboard couldn't decide whether the panel may use `permissions` (its answers file can't be read or saved), so it refused: why. */
export const permissionFailure = shape.object({
    computerId: shape.text(),
    panelId: shape.text(),
    permissions: shape.list(panelPermission),
    message: shape.text(),
});
export type PermissionFailure = Infer<typeof permissionFailure>;
