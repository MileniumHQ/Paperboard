// Display formatting for identifiers the game exposes as snake_case
// (gamerules, server.properties keys). The server speaks
// `command_block_output`; the UI must not. Pure and testable — the search
// index and the rendered title both call it, so they can never disagree.

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
