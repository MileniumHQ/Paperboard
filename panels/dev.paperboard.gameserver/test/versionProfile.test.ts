import { describe, expect, test } from "bun:test";
import {
    canonicalGameruleName,
    canonicalGameruleValue,
    levelTypeOptionsFor,
    mcAtLeast,
    mcSatisfies,
    resolveFacts,
    resolveFactsWith,
    resolveVersionProfile,
    serverGameruleName,
    serverGameruleValue,
    VERSION_OVERRIDES,
    worldPathsFor,
} from "../src/lib/versionProfile";

describe("version comparison", () => {
    test("mcAtLeast respects shorthand and full release strings", () => {
        expect(mcAtLeast("1.21.11", "1.21.9")).toBe(true);
        expect(mcAtLeast("1.21.8", "1.21.9")).toBe(false);
        expect(mcAtLeast("26.1", "26.0.0")).toBe(true);
        expect(mcAtLeast("1.18", "1.18")).toBe(true);
        expect(mcAtLeast("", "1.18")).toBe(false);
        expect(mcAtLeast(undefined, "1.18")).toBe(false);
    });

    test("mcSatisfies handles until as exclusive", () => {
        expect(mcSatisfies("1.21.8", { until: "1.21.9" })).toBe(true);
        expect(mcSatisfies("1.21.9", { until: "1.21.9" })).toBe(false);
        expect(mcSatisfies("1.19", { since: "1.17", until: "1.21.9" })).toBe(true);
        expect(mcSatisfies("1.16.5", { since: "1.17", until: "1.21.9" })).toBe(false);
    });
});

describe("level type options by era", () => {
    test("oldest uses uppercase legacy values", () => {
        const values = levelTypeOptionsFor("paper", "1.12.2").map((o) => o.value);
        expect(values).toContain("DEFAULT");
        expect(values).toContain("FLAT");
        expect(values).not.toContain("normal");
    });

    test("1.16-1.18 use bare legacy values", () => {
        const values = levelTypeOptionsFor("paper", "1.18.2").map((o) => o.value);
        expect(values).toEqual(["default", "flat", "largeBiomes", "amplified"]);
    });

    test("1.19+ use world-preset values", () => {
        const values = levelTypeOptionsFor("paper", "1.21.11").map((o) => o.value);
        expect(values).toContain("normal");
        expect(values).toContain("large_biomes");
        expect(values).not.toContain("largeBiomes");
    });
});

describe("resolveVersionProfile", () => {
    test("pre-1.13 baseline", () => {
        const profile = resolveVersionProfile("vanilla", "1.12.2");
        expect(profile.javaPackage).toBe("java-8");
        expect(profile.gameruleNaming).toBe("legacy");
        expect(profile.propertiesMovedToGamerules).toEqual([]);
        expect(profile.mapMinBuildHeight).toBe(0);
        expect(profile.worldLayout).toBe("vanilla-split");
        expect(profile.playerDataFolder).toBe("legacy");
    });

    test("1.18: -64 map floor, Java 17", () => {
        const profile = resolveVersionProfile("paper", "1.18.2");
        expect(profile.javaPackage).toBe("java-17");
        expect(profile.mapMinBuildHeight).toBe(-64);
        expect(profile.worldLayout).toBe("bukkit-split");
    });

    test("1.20.5+: Java 21", () => {
        expect(resolveVersionProfile("paper", "1.20.6").javaPackage).toBe("java-21");
    });

    test("1.21.9: four properties become gamerules", () => {
        const profile = resolveVersionProfile("paper", "1.21.9");
        expect(profile.propertiesMovedToGamerules).toContain("pvp");
        expect(profile.propertiesMovedToGamerules).toContain("allow-nether");
        expect(resolveVersionProfile("paper", "1.21.8").propertiesMovedToGamerules).toEqual([]);
    });

    test("1.21.11: gamerules are namespaced", () => {
        expect(resolveVersionProfile("paper", "1.21.11").gameruleNaming).toBe("namespaced");
        expect(resolveVersionProfile("paper", "1.21.10").gameruleNaming).toBe("legacy");
    });

    test("26.1: dimensions layout, players folder, Java 25", () => {
        const profile = resolveVersionProfile("paper", "26.1.2");
        expect(profile.worldLayout).toBe("dimensions");
        expect(profile.playerDataFolder).toBe("players");
        expect(profile.javaPackage).toBe("java-25");
    });

    test("26.2 latest stays on the dimensions layout", () => {
        const profile = resolveVersionProfile("vanilla", "26.2");
        expect(profile.worldLayout).toBe("dimensions");
        expect(profile.levelTypeOptions.map((o) => o.value)).toContain("normal");
    });

    test("map palette flips at 1.18", () => {
        expect(resolveVersionProfile("paper", "1.17.1").mapPalette).toBe("legacy");
        expect(resolveVersionProfile("paper", "1.18.2").mapPalette).toBe("modern");
    });
});

describe("gamerule name/value translation", () => {
    const modern = resolveVersionProfile("paper", "1.21.11");
    const legacy = resolveVersionProfile("paper", "1.21.10");

    test("namespaced era passes names and values through", () => {
        expect(serverGameruleName(modern, "keep_inventory")).toBe("keep_inventory");
        expect(canonicalGameruleName(modern, "keepInventory")).toBe("keepInventory");
        expect(serverGameruleValue(modern, "raids", "false")).toBe("false");
    });

    test("legacy era maps regular and irregular names", () => {
        expect(serverGameruleName(legacy, "keep_inventory")).toBe("keepInventory");
        expect(serverGameruleName(legacy, "spawn_mobs")).toBe("doMobSpawning");
        expect(serverGameruleName(legacy, "advance_time")).toBe("doDaylightCycle");
        expect(serverGameruleName(legacy, "command_blocks_work")).toBe(
            "commandBlocksEnabled",
        );
    });

    test("legacy reverse mapping canonicalizes readouts", () => {
        expect(canonicalGameruleName(legacy, "keepInventory")).toBe("keep_inventory");
        expect(canonicalGameruleName(legacy, "doDaylightCycle")).toBe("advance_time");
        expect(canonicalGameruleName(legacy, "disableRaids")).toBe("raids");
    });

    test("legacy era inverts disable* rules both directions", () => {
        expect(serverGameruleValue(legacy, "raids", "false")).toBe("true");
        expect(canonicalGameruleValue(legacy, "raids", "true")).toBe("false");
        expect(serverGameruleValue(legacy, "keep_inventory", "true")).toBe("true");
    });
});

describe("sparse version overrides", () => {
    test("a gap inherits the nearest earlier value", () => {
        // 1.16 sets legacy level types; nothing replaces them until 1.19
        const at1165 = resolveFacts("vanilla", "1.16.5");
        expect(at1165.javaPackage).toBe("java-8"); // no java override until 1.17
        expect(at1165.levelTypeOptions.map((o) => o.value)).toEqual([
            "default",
            "flat",
            "largeBiomes",
            "amplified",
        ]);

        const at171 = resolveFacts("vanilla", "1.17.1");
        expect(at171.javaPackage).toBe("java-16");
        expect(at171.levelTypeOptions.map((o) => o.value)).toEqual([
            "default",
            "flat",
            "largeBiomes",
            "amplified",
        ]);

        const at181 = resolveFacts("vanilla", "1.18.1");
        expect(at181.javaPackage).toBe("java-17");
        expect(at181.mapPalette).toBe("modern");
        // level types still held from 1.16
        expect(at181.levelTypeOptions.map((o) => o.value)).toContain("default");

        const at19 = resolveFacts("vanilla", "1.19");
        expect(at19.levelTypeOptions.map((o) => o.value)).toContain("normal");
    });

    test("a one-off override changes only the fields it names", () => {
        const overrides = [
            ...VERSION_OVERRIDES,
            {
                at: "1.16.5",
                patch: {
                    levelTypeOptions: [{ value: "FLAT", label: "Flat only" }],
                },
            },
        ];
        const at1165 = resolveFactsWith("vanilla", "1.16.5", overrides);
        expect(at1165.levelTypeOptions.map((o) => o.value)).toEqual(["FLAT"]);
        // every other fact inherited unchanged
        expect(at1165.javaPackage).toBe("java-8");
        expect(at1165.gameruleNaming).toBe("legacy");

        // the one-off does not leak backwards, and 1.19 still wins forward
        expect(
            resolveFactsWith("vanilla", "1.16.4", overrides).levelTypeOptions.map(
                (o) => o.value,
            ),
        ).toEqual(["default", "flat", "largeBiomes", "amplified"]);
        expect(
            resolveFactsWith("vanilla", "1.19", overrides).levelTypeOptions.map(
                (o) => o.value,
            ),
        ).toContain("normal");
    });

    test("software baseline fills worldLayout until a version overrides it", () => {
        expect(resolveFacts("paper", "1.21.11").worldLayout).toBe("bukkit-split");
        expect(resolveFacts("vanilla", "1.21.11").worldLayout).toBe("vanilla-split");
        expect(resolveFacts("paper", "26.1").worldLayout).toBe("dimensions");
    });
});

describe("worldPathsFor", () => {
    test("pre-26.1 Paper uses the split-root layout", () => {
        const paths = worldPathsFor(resolveVersionProfile("paper", "1.21.11"), "world");
        expect(paths.overworld).toBe("world");
        expect(paths.nether).toBe("world_nether");
        expect(paths.end).toBe("world_the_end");
        expect(paths.stats("abc")).toBe("world/stats/abc.json");
    });

    test("pre-26.1 vanilla nests DIM folders", () => {
        const paths = worldPathsFor(resolveVersionProfile("vanilla", "1.21.11"), "world");
        expect(paths.nether).toBe("world/DIM-1");
        expect(paths.end).toBe("world/DIM1");
    });

    test("26.1+ uses dimensions/ and players/", () => {
        const paths = worldPathsFor(resolveVersionProfile("paper", "26.1"), "world");
        expect(paths.overworld).toBe("world/dimensions/minecraft/overworld");
        expect(paths.nether).toBe("world/dimensions/minecraft/the_nether");
        expect(paths.end).toBe("world/dimensions/minecraft/the_end");
        expect(paths.stats("abc")).toBe("world/players/stats/abc.json");
        expect(paths.playerData("abc")).toBe("world/players/data/abc.dat");
    });
});
