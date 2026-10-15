// What the Game Server widgets say, as plain functions of the service's state.
import type { PaperConsoleEntry } from "@mileniumhq/paperui";

export interface PlayerCount {
    online: string;
    /** empty while the server hasn't told its cap */
    max: string;
    /** "3/20", or "3" while the cap is unknown */
    short: string;
    /** "3 of 20 players", or "3 players" */
    long: string;
    noun: string;
}

export function playerCount(online: number, max: number | null): PlayerCount {
    const noun = (max ?? online) === 1 ? "player online" : "players online";
    const known = max !== null;
    return {
        online: String(online),
        max: known ? String(max) : "",
        short: known ? `${online}/${max}` : String(online),
        long: known ? `${online} of ${max} ${max === 1 ? "player" : "players"}` : `${online} ${online === 1 ? "player" : "players"} online`,
        noun,
    };
}

export function softwareLabel(software: string, version: string, names: Readonly<Record<string, string>>): string {
    const name = names[software] ?? software;
    return version ? `${name} ${version}` : name;
}

/** the first `limit` players, or one fewer and a "more" row when they don't all fit */
export function rosterRows(players: readonly string[], limit: number): { shown: string[]; more: number } {
    if (players.length <= limit) return { shown: [...players], more: 0 };
    const shown = players.slice(0, Math.max(0, limit - 1));
    return { shown, more: players.length - shown.length };
}

export interface TailLine {
    time: string;
    text: string;
    tone: "error" | "warn" | "plain";
}

// "[12:00:00] [Server thread/INFO]: Done" or Paper's "[12:00:00 INFO]: Done"
const LOG_PREFIX = /^\[(\d{2}:\d{2}:\d{2})(?: [A-Z]+)?\](?: \[[^\]]*\])?:?\s*/;

/** the last `count` log lines, timestamp split off, errors and warnings marked */
export function consoleTail(entries: readonly PaperConsoleEntry[], count: number): TailLine[] {
    const lines: TailLine[] = [];
    for (const entry of entries.slice(-count)) {
        const raw = typeof entry.content === "string" ? entry.content : "";
        const match = raw.match(LOG_PREFIX);
        const text = (match ? raw.slice(match[0].length) : raw).trim();
        lines.push({
            time: match?.[1] ?? "",
            text: text || raw,
            tone: entry.type === "error" ? "error" : entry.type === "warn" ? "warn" : "plain",
        });
    }
    return lines;
}
