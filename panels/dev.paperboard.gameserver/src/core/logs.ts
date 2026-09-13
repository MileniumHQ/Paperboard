// Log-file helpers for the Logs tab. Pure and testable: the file-name
// boundary and the text tailing are the parts that must not be wrong.

const LOG_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.log(?:\.gz)?$/;

// a log name is one safe file, never a path: no separators, no traversal
export function isLogFileName(name: unknown): name is string {
    return (
        typeof name === "string" &&
        name.length <= 128 &&
        LOG_FILE_RE.test(name) &&
        !name.includes("..")
    );
}

// keep only the most recent `max` characters so a long session's log cannot
// blow up the bridge frame; the end is the useful part
export function tailChars(
    text: string,
    max: number,
): { text: string; truncated: boolean } {
    if (max <= 0 || text.length <= max) {
        return { text: max <= 0 ? "" : text, truncated: text.length > max };
    }
    return { text: text.slice(text.length - max), truncated: true };
}

const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// the user reads logs by when they happened, not by what the file is named
export function formatLogDate(epochMs: number): string {
    const date = new Date(epochMs);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} · ${hours}:${minutes}`;
}

export function logLabel(name: string, mtimeMs: number): string {
    return name === "latest.log" ? "Current session" : formatLogDate(mtimeMs);
}
