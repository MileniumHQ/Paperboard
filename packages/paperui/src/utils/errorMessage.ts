/** A thrown value's message, for a notice or a status row: an Error's own words, anything else as text. */
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
