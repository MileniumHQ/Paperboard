// The Players tab's leaderboard: what a roster can be sorted by, and how a
// player's numbers read. Offline stats come from the world's
// stats/<uuid>.json; a missing entry is "no data", never a zero.
import type { Accessor } from "solid-js";
import type { PlayerStatSummary, PlayerStatSummaryData } from "../../core/playerStats";

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
    uuid?: string;
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

/** A world's players by their numbers. */
export interface Leaderboard {
    summaryOf(player: Ranked): PlayerStatSummary | undefined;
    /** seconds played: the world's stats file, else what this session has counted */
    playtimeSeconds(player: Ranked): number | undefined;
    /** highest first for stats, alphabetical for names */
    sort<P extends Ranked>(players: readonly P[], key: SortKey): P[];
}

/** `summaries` are the world's stats files by lowercased uuid; `playtime` is this session's count by lowercased name */
export function createLeaderboard(summaries: Accessor<ReadonlyMap<string, PlayerStatSummary>>, playtime: Accessor<ReadonlyMap<string, number>>): Leaderboard {
    const summaryOf = (player: Ranked) => (player.uuid ? summaries().get(player.uuid.toLowerCase()) : undefined);
    const counted = (player: Ranked) => playtime().get(player.name.toLowerCase());
    const statNumber = (player: Ranked, key: Exclude<SortKey, "name">): number => {
        if (key === "playtime") {
            const stats = summaryOf(player);
            return stats ? stats.playTimeTicks : (counted(player) ?? 0) * 20;
        }
        return summaryOf(player)?.[STAT_FIELDS[key]] ?? 0;
    };
    return {
        summaryOf,
        playtimeSeconds: (player) => {
            const stats = summaryOf(player);
            return stats ? Math.floor(stats.playTimeTicks / 20) : counted(player);
        },
        sort: (players, key) => {
            const list = players.slice();
            if (key === "name") return list.sort((a, b) => a.name.localeCompare(b.name));
            return list.sort((a, b) => statNumber(b, key) - statNumber(a, key));
        },
    };
}
