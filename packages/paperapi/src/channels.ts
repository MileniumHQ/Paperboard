// shared protocol names
/** A panel's running backup or restore moved on a step, or ended. */
export const BACKUP_PROGRESS_EVENT = "backup:progress";

// collision-free client ids
export function newClientId(prefix: string): string {
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return `${prefix}-${c.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
