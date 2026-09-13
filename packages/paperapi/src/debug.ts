// off by default, enable via PAPERBOARD_TRANSPORT_DEBUG=1
const DEBUG =
    (typeof process !== "undefined" && process.env?.PAPERBOARD_TRANSPORT_DEBUG === "1") ||
    (typeof localStorage !== "undefined" &&
        (globalThis as any).localStorage?.getItem?.("PAPERBOARD_TRANSPORT_DEBUG") === "1");

export function debug(msg: string): void {
    if (DEBUG) console.debug(`[transport] ${msg}`);
}

/**
 * Errors always surface on the console — DEBUG only adds the chatty trace.
 * "Logged" must mean "visible", not "hidden behind a flag".
 */
export function debugErr(where: string, err: unknown): void {
    console.error(`[transport] ${where}:`, err instanceof Error ? err : String(err));
    if (DEBUG) console.debug(`[transport] ${where} trace above`);
}
