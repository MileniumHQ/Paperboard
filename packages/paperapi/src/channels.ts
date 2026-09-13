// shared protocol names
export const STATE_SYNC_EVENT = "__stateChanged";
export const STATE_GET_ACTION = "__getState";

// collision-free client ids
export function newClientId(prefix: string): string {
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return `${prefix}-${c.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
