// A panel frame asks for the backup location window with
// { type: "paperboard:backup-location", generation, requestId, panelId }.
// The shell answers on the same frame with "paperboard:backup-location-result".
// Identity comes from the frame the message arrived on; the panelId the
// panel names must agree with it.
export const BACKUP_LOCATION_REQUEST = "paperboard:backup-location";
export const BACKUP_LOCATION_RESULT = `${BACKUP_LOCATION_REQUEST}-result`;

export type BackupLocationRequest = { requestId: string; refused: string | null };

/** null for anything that is not a well-formed backup location request */
export function parseBackupLocationRequest(data: unknown, framePanelId: string, alreadyOpen: boolean): BackupLocationRequest | null {
    if (!data || typeof data !== "object") return null;
    const message = data as Record<string, unknown>;
    if (message.type !== BACKUP_LOCATION_REQUEST) return null;
    if (typeof message.requestId !== "string" || !message.requestId || message.requestId.length > 128) return null;
    const refused =
        message.panelId !== framePanelId ? "The panel id does not match the panel that asked" : alreadyOpen ? "The backup location window is already open" : null;
    return { requestId: message.requestId, refused };
}
