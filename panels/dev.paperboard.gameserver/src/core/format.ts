// Display formatting for identifiers the game exposes as snake_case
// (gamerules, server.properties keys). The server speaks
// `command_block_output`; the UI must not. Pure and testable — the search
// index and the rendered title both call it, so they can never disagree.

/** A length of time, from seconds: "45s", "12m", "3h 05m" or "2d 4h". */
export function durationLabel(seconds: number): string {
    const s = Math.floor(seconds);
    if (s < 60) return `${s}s`;
    const minutes = Math.floor(s / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function humanizeIdentifier(identifier: string): string {
    const words = String(identifier ?? "")
        .split(/[_\s]+/)
        .filter(Boolean);
    if (words.length === 0) return "";
    return words
        .map((word) =>
            word.length === 1
                ? word.toUpperCase()
                : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ");
}
