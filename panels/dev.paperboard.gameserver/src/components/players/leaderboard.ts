// The Players tab's leaderboard: what a roster can be sorted by, and how a
// player's numbers read. Offline stats come from the world's
// stats/<uuid>.json; a missing file is "no data", never a zero.
import type { PlayerStatSummaryData } from "../../core/playerStats";

export type SortKey = "name" | "playtime" | "deaths" | "mobKills" | "playerKills" | "blocksMined" | "distance";

export const SORT_LABELS: Record<SortKey, string> = {
    name: "Name",
    playtime: "Playtime",
    deaths: "Deaths",
    mobKills: "Mob kills",
    playerKills: "Player kills",
    blocksMined: "Blocks mined",
    distance: "Distance",
};

const STAT_FIELDS: Record<Exclude<SortKey, "name" | "playtime">, keyof PlayerStatSummaryData> = {
    deaths: "deaths",
    mobKills: "mobKills",
    playerKills: "playerKills",
    blocksMined: "blocksMined",
    distance: "distanceCm",
};

interface Ranked {
    name: string;
    stats: PlayerStatSummaryData | null;
}

export function formatPlaytime(seconds: number | undefined): string {
    if (seconds === undefined) return "unknown";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatDistance(cm: number): string {
    const meters = cm / 100;
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
}

/** seconds played from the world's stats file; undefined without one */
export function playtimeSeconds(player: Ranked): number | undefined {
    return player.stats ? Math.floor(player.stats.playTimeTicks / 20) : undefined;
}

/** highest first for stats, alphabetical for names */
export function sortPlayers<P extends Ranked>(players: readonly P[], key: SortKey): P[] {
    const list = players.slice();
    if (key === "name") return list.sort((a, b) => a.name.localeCompare(b.name));
    const field = key === "playtime" ? "playTimeTicks" : STAT_FIELDS[key];
    return list.sort((a, b) => (b.stats?.[field] ?? 0) - (a.stats?.[field] ?? 0));
}
