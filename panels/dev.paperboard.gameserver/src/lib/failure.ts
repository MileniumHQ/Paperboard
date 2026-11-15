// What the UI shows when something happens: a title that names it, and the
// detail. A failure's detail is the error's own message, never a pointer to
// the console.
export interface Outcome {
    title: string;
    message: string;
}

// what the computer's own error codes mean, said as a sentence about the file
const SYSTEM_ERRORS: Record<string, (action: string, target: string) => string> = {
    EACCES: (action, target) => `Paperboard isn't allowed to ${action} ${target}`,
    EPERM: (action, target) => `Paperboard isn't allowed to ${action} ${target}`,
    ENOENT: (_action, target) => `${target} doesn't exist`,
    ENOSPC: (_action, target) => `The disk is full, so ${target} couldn't be written`,
    EROFS: (_action, target) => `${target} is on a disk that can't be written to`,
    EBUSY: (_action, target) => `${target} is in use by another program`,
    EISDIR: (_action, target) => `${target} is a folder, not a file`,
};
// Node's form: "EACCES: permission denied, open '/srv/server.properties'"
const SYSTEM_ERROR = /\b(E[A-Z]+): [^,\n]+, (\w+) '([^'\n]+)'/;
// the daemon's wrapper around a refused call, which says nothing of what failed
const TRANSPORT_PREFIX = /^(?:Request failed: )+/;

/**
 * A failure as a person reads it. The daemon's "Request failed:" wrapper is
 * dropped, and a system error such as EACCES becomes a sentence that still
 * names its code and the file; anything else is the message as it came.
 */
export function readableFailure(message: string): string {
    const text = message.replace(TRANSPORT_PREFIX, "");
    const match = SYSTEM_ERROR.exec(text);
    const say = match ? SYSTEM_ERRORS[match[1]!] : undefined;
    if (!match || !say) return text;
    return `${text.slice(0, match.index)}${say(match[2]!, match[3]!)} (${match[1]}).${text.slice(match.index + match[0].length).replace(/^\.?/, "")}`;
}

/** A failure's own words, as it threw them. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The system's code for a failure (ENOENT, EACCES, …), if it has one. */
export const errorCode = (err: unknown): string | undefined => (err as { code?: string } | null)?.code;

export const errorMessage = (err: unknown): string => readableFailure(errorText(err));

/**
 * A failure's first line says what failed; what a tool printed after it
 * (SteamCMD, an installer) is kept as it printed it, line by line.
 */
export function splitFailure(message: string): { summary: string; output: string } {
    const [summary = "", ...rest] = message.split(/\r?\n/);
    return { summary: summary.trim(), output: rest.join("\n").trim() };
}
