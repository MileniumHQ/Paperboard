// Player statistics parsing (bun test): the world's stats/<uuid>.json is the
// server's own record, so the aggregation rules (custom counts, distance
// sum, mined total) are pinned here.
import { describe, test, expect } from "bun:test";
import { parsePlayerStats, playTimeSeconds } from "../src/core/playerStats";

const SAMPLE = {
    stats: {
        "minecraft:custom": {
            "minecraft:deaths": 3,
            "minecraft:mob_kills": 42,
            "minecraft:player_kills": 2,
            "minecraft:play_time": 72000,
            "minecraft:jump": 100,
            "minecraft:walk_one_cm": 100000,
            "minecraft:sprint_one_cm": 50000,
            "minecraft:fall_one_cm": 250,
        },
        "minecraft:mined": {
            "minecraft:stone": 10,
            "minecraft:dirt": 5,
        },
    },
    DataVersion: 4903,
};

describe("parsePlayerStats", () => {
    test("extracts counts and aggregates distance and mined blocks", () => {
        const parsed = parsePlayerStats(SAMPLE);
        expect(parsed).toEqual({
            deaths: 3,
            mobKills: 42,
            playerKills: 2,
            playTimeTicks: 72000,
            jumps: 100,
            blocksMined: 15,
            distanceCm: 150250,
        });
    });

    test("converts play time ticks to seconds", () => {
        expect(playTimeSeconds(parsePlayerStats(SAMPLE)!)).toBe(3600);
    });

    test("ignores malformed values", () => {
        const parsed = parsePlayerStats({
            stats: {
                "minecraft:custom": { "minecraft:deaths": "lots", "minecraft:mob_kills": 7 },
                "minecraft:mined": { "minecraft:stone": 3, bad: null },
            },
        });
        expect(parsed).not.toBeNull();
        expect(parsed!.deaths).toBe(0);
        expect(parsed!.mobKills).toBe(7);
        expect(parsed!.blocksMined).toBe(3);
    });

    test("returns null for non-stats documents", () => {
        expect(parsePlayerStats(null)).toBeNull();
        expect(parsePlayerStats({})).toBeNull();
        expect(parsePlayerStats({ stats: {} })).toBeNull();
        expect(parsePlayerStats("nope")).toBeNull();
    });
});
