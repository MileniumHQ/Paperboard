// Debug logging, off by default; enable via PAPERBOARD_TRANSPORT_DEBUG=1
const DEBUG =
    (typeof process !== "undefined" && process.env?.PAPERBOARD_TRANSPORT_DEBUG === "1") ||
    (typeof localStorage !== "undefined" &&
        (globalThis as any).localStorage?.getItem?.("PAPERBOARD_TRANSPORT_DEBUG") === "1");

export function debug(msg: string): void {
    if (DEBUG) console.debug(`[transport] ${msg}`);
}

/** One-line debug for swallowed errors; never changes control flow. */
export function debugErr(where: string, err: unknown): void {
    debug(`${where} swallowed error: ${err instanceof Error ? err.message : String(err)}`);
}
