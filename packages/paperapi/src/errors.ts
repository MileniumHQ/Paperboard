// What a caught failure says, for the person to read: the error's own words,
// never a generic "something went wrong". Plain TypeScript, for a page and a
// service alike.

/** A thrown value's message: an Error's `message`, anything else as text. */
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** The system's code for a failure (`ENOENT`, `EACCES`, …), or undefined when it has none. */
export function errorCode(err: unknown): string | undefined {
    const code = (err as { code?: unknown } | null | undefined)?.code;
    return typeof code === "string" ? code : undefined;
}
