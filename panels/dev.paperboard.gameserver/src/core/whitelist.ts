// Who can join while the whitelist is on. Operators bypass the whitelist
// (vanilla PlayerList.isWhiteListed), so an empty whitelist admits only
// them. Minecraft 26.3 turned the whitelist on by default for new servers,
// so a fresh 26.3 server turns everyone else away until they are added.

export type JoinRestriction = "operators-only" | "nobody" | null;

/**
 * @param whitelistOn white-list from server.properties (or the version's default)
 * @param whitelisted entries in whitelist.json; null when it could not be read
 * @param operators entries in ops.json; null when it could not be read
 * @returns null when anyone may join, or when the files are unreadable (no claim is made then)
 */
export function joinRestriction(
    whitelistOn: boolean,
    whitelisted: number | null,
    operators: number | null,
): JoinRestriction {
    if (!whitelistOn || whitelisted === null || operators === null) return null;
    if (whitelisted > 0) return null;
    return operators > 0 ? "operators-only" : "nobody";
}

/**
 * Entry count of a whitelist.json / ops.json text. Missing means the server
 * has not written it yet: empty. Anything unparseable is null, never 0.
 */
export function countJsonEntries(content: string | null): number | null {
    if (content === null || content.trim() === "") return 0;
    try {
        const parsed: unknown = JSON.parse(content);
        return Array.isArray(parsed) ? parsed.length : null;
    } catch (err) {
        console.debug("[whitelist] list file is not valid JSON:", String(err));
        return null;
    }
}
