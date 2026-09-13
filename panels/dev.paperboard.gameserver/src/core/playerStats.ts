// Per-player statistics from a world's `stats/<uuid>.json` (1.13+ namespaced
// format). Pure and testable: the file is the server's own record, so the
// parsing rules — which keys mean what, and how distance/blocks aggregate —
// live here rather than in the service.

export interface PlayerStatSummaryData {
    deaths: number;
    mobKills: number;
    playerKills: number;
    playTimeTicks: number;
    jumps: number;
    blocksMined: number;
    distanceCm: number;
}

export interface PlayerStatSummary extends PlayerStatSummaryData {
    uuid: string;
    name: string;
}

// every "…_one_cm" movement statistic, summed into one distance figure
export const DISTANCE_STATS: string[] = [
    "minecraft:walk_one_cm",
    "minecraft:sprint_one_cm",
    "minecraft:crouch_one_cm",
    "minecraft:swim_one_cm",
    "minecraft:fly_one_cm",
    "minecraft:walk_on_water_one_cm",
    "minecraft:walk_under_water_one_cm",
    "minecraft:aviate_one_cm",
    "minecraft:boat_one_cm",
    "minecraft:minecart_one_cm",
    "minecraft:horse_one_cm",
    "minecraft:pig_one_cm",
    "minecraft:strider_one_cm",
    "minecraft:climb_one_cm",
    "minecraft:fall_one_cm",
    "minecraft:dive_one_cm",
];

function num(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// returns null for anything that is not a stats document, so a corrupt or
// pre-1.13 (numeric-id) file is skipped rather than reported as all-zero
export function parsePlayerStats(raw: unknown): PlayerStatSummaryData | null {
    if (!raw || typeof raw !== "object") return null;
    const stats = (raw as { stats?: unknown }).stats;
    if (!stats || typeof stats !== "object") return null;

    const bag = stats as Record<string, unknown>;
    const custom = (bag["minecraft:custom"] ?? {}) as Record<string, unknown>;
    const mined = (bag["minecraft:mined"] ?? {}) as Record<string, unknown>;
    if (!bag["minecraft:custom"] && !bag["minecraft:mined"]) return null;

    const customNum = (key: string) => num(custom[key]);
    let distanceCm = 0;
    for (const key of DISTANCE_STATS) distanceCm += customNum(key);

    let blocksMined = 0;
    for (const value of Object.values(mined)) blocksMined += num(value);

    return {
        deaths: customNum("minecraft:deaths"),
        mobKills: customNum("minecraft:mob_kills"),
        playerKills: customNum("minecraft:player_kills"),
        playTimeTicks: customNum("minecraft:play_time"),
        jumps: customNum("minecraft:jump"),
        blocksMined,
        distanceCm,
    };
}

export function playTimeSeconds(data: PlayerStatSummaryData): number {
    return Math.floor(data.playTimeTicks / 20);
}
