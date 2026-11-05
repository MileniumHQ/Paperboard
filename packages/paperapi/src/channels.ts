// shared protocol names
export const STATE_SYNC_EVENT = "__stateChanged";
export const STATE_GET_ACTION = "__getState";
/** A panel's running backup or restore moved on a step, or ended. */
export const BACKUP_PROGRESS_EVENT = "backup:progress";
/** Home asks a panel's service what a widget option's dropdown offers. */
export const WIDGET_CHOICES_ACTION = "__widgetChoices";

// collision-free client ids
export function newClientId(prefix: string): string {
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return `${prefix}-${c.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
