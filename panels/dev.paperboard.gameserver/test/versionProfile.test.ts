import { describe, expect, test } from "bun:test";
import {
    behaviorVersionOf,
    canonicalGameruleName,
    canonicalGameruleValue,
    classifyMcVersion,
    isSupportedMcVersion,
    levelTypeOptionsFor,
    mcAtLeast,
    mcSatisfies,
    resolveFacts,
    resolveFactsWith,
    resolveVersionProfile,
    serverGameruleName,
    serverGameruleValue,
    VERSION_OVERRIDES,
    versionSupports,
    worldPathsFor,
} from "../src/lib/versionProfile";

describe("version comparison", () => {
    test("classifies releases, pre-releases and drops", () => {
        expect(classifyMcVersion("1.21.11")).toEqual({
            raw: "1.21.11",
            kind: "release",
            base: "1.21.11",
        });
        expect(classifyMcVersion("26.1")).toMatchObject({ kind: "release", base: "26.1" });
        expect(classifyMcVersion("1.21.5-pre1")).toMatchObject({ kind: "pre", base: "1.21.5" });
        expect(classifyMcVersion("1.21.5-rc1")).toMatchObject({ kind: "rc", base: "1.21.5" });
        expect(classifyMcVersion("25w35a")).toMatchObject({ kind: "snapshot" });
    });

    test("classifies pre-1.0 builds as older than everything", () => {
        expect(classifyMcVersion("b1.7.3")).toMatchObject({ kind: "old_beta", base: "0.0.0" });
        expect(classifyMcVersion("a1.2.6")).toMatchObject({ kind: "old_alpha", base: "0.0.0" });
        expect(behaviorVersionOf("b1.7.3")).toBe("0.0.0");
        expect(mcAtLeast("b1.7.3", "1.16")).toBe(false);
    });

    test("pre-releases behave as their base release", () => {
        expect(behaviorVersionOf("1.21.5-pre1")).toBe("1.21.5");
        expect(resolveFacts("vanilla", "1.21.5-pre1").javaPackage).toBe("java-21");
    });

    test("weekly snapshots resolve through their cycle anchor", () => {
        expect(behaviorVersionOf("25w35a")).toBe("1.21.9");
        // a snapshot later in the same cycle inherits the anchor's release
        expect(behaviorVersionOf("25w40a")).toBe("1.21.9");
        // the gamerule rename lands in 25w44a, starting the 1.21.11 cycle
        expect(behaviorVersionOf("25w44a")).toBe("1.21.11");
        expect(behaviorVersionOf("22w11a")).toBe("1.19");

        const at219 = resolveVersionProfile("paper", "25w35a");
        expect(at219.gameruleNaming).toBe("legacy");
        expect(at219.propertiesMovedToGamerules).toContain("pvp");
        expect(mcAtLeast("25w35a", "1.21.11")).toBe(false);

        const at2111 = resolveVersionProfile("paper", "25w44a");
        expect(at2111.gameruleNaming).toBe("namespaced");
    });

    test("manifest cycle table covers the weekly snapshot tail", () => {
        expect(behaviorVersionOf("13w16a")).toBe("1.5.2");
        expect(mcAtLeast("13w16a", "1.16")).toBe(false);
        expect(behaviorVersionOf("20w06a")).toBe("1.16");
        expect(behaviorVersionOf("21w37a")).toBe("1.18");
        expect(resolveVersionProfile("paper", "21w37a").mapMinBuildHeight).toBe(-64);
        expect(behaviorVersionOf("23w51a")).toBe("1.20.5");
        expect(behaviorVersionOf("26w14a")).toBe("26.1.2");
        expect(resolveVersionProfile("paper", "26w14a").worldLayout).toBe("dimensions");
    });

    test("mid-cycle refinements keep earlier snapshots on the old behaviour", () => {
        // 25w31a..25w34b belong to the 1.21.9 cycle but predate the
        // property -> gamerule move at 25w35a
        expect(behaviorVersionOf("25w31a")).toBe("1.21.6");
        expect(resolveVersionProfile("paper", "25w31a").propertiesMovedToGamerules).toEqual(
            [],
        );
        expect(resolveVersionProfile("paper", "25w31a").gameruleNaming).toBe("legacy");
        // 25w41a..25w43a predate the gamerule rename at 25w44a
        expect(behaviorVersionOf("25w41a")).toBe("1.21.9");
        expect(resolveVersionProfile("paper", "25w41a").gameruleNaming).toBe("legacy");
    });

    test("calendar drop snapshots and pre-releases carry their release", () => {
        expect(classifyMcVersion("26.1-snapshot-6")).toMatchObject({
            kind: "snapshot",
            base: "26.1",
        });
        expect(behaviorVersionOf("26.1-snapshot-6")).toBe("26.1");
        expect(classifyMcVersion("26.2-pre-release-5")).toMatchObject({
            kind: "pre",
            base: "26.2",
        });
        expect(behaviorVersionOf("26.2-pre-release-5")).toBe("26.2");
    });

    test("calendar drops compare above legacy numbering", () => {
        expect(mcAtLeast("26.1", "1.21.11")).toBe(true);
        expect(mcAtLeast("26.1", "26.1")).toBe(true);
        expect(mcAtLeast("26.0.9", "26.1")).toBe(false);
    });

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

    test("1.13-1.15 use lowercase values with buffet/default_1_1/customized", () => {
        const values = levelTypeOptionsFor("paper", "1.13.2").map((o) => o.value);
        expect(values).toContain("default");
        expect(values).toContain("buffet");
        expect(values).toContain("default_1_1");
        expect(values).not.toContain("DEFAULT");
        expect(levelTypeOptionsFor("paper", "1.15.2").map((o) => o.value)).toContain(
            "buffet",
        );
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
        // 25w35a-era name for the same rule
        expect(canonicalGameruleName(legacy, "enableCommandBlocks")).toBe(
            "command_blocks_work",
        );
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

describe("capabilities match the wiki boundary snapshots", () => {
    test("server.properties keys appear at the documented versions", () => {
        expect(versionSupports("1.15.2", "enableStatus")).toBe(false);
        expect(versionSupports("1.16", "enableStatus")).toBe(true);
        expect(versionSupports("1.16.1", "rateLimit")).toBe(false);
        expect(versionSupports("1.16.2", "rateLimit")).toBe(true);
        expect(versionSupports("1.20.4", "acceptsTransfers")).toBe(false);
        expect(versionSupports("1.20.5", "acceptsTransfers")).toBe(true);
        expect(versionSupports("1.21.1", "pauseWhenEmpty")).toBe(false);
        expect(versionSupports("1.21.2", "pauseWhenEmpty")).toBe(true);
        expect(versionSupports("1.20.2", "logIps")).toBe(true);
        expect(versionSupports("1.20.1", "logIps")).toBe(false);
        expect(versionSupports("1.20.3", "resourcePackId")).toBe(true);
        expect(versionSupports("1.20.2", "resourcePackId")).toBe(false);
    });

    test("the four pvp/nether/monster/command-block properties end at 1.21.9", () => {
        for (const cap of [
            "propertyPvp",
            "propertyAllowNether",
            "propertySpawnMonsters",
            "propertyEnableCommandBlock",
        ] as const) {
            expect(versionSupports("1.21.8", cap)).toBe(true);
            expect(versionSupports("1.21.9", cap)).toBe(false);
        }
    });

    test("mid-cycle snapshots gate on the feature snapshot, not the release", () => {
        // 25w31a is 1.21.9 but predates the property move at 25w35a
        expect(versionSupports("25w31a", "propertyPvp")).toBe(true);
        expect(versionSupports("25w35a", "propertyPvp")).toBe(false);
        // accepts-transfers arrived in 24w03a, inside the 1.20.5 cycle
        expect(versionSupports("24w03a", "acceptsTransfers")).toBe(true);
    });

    test("whole-feature floors hide the tab below the supporting version", () => {
        expect(versionSupports("1.17.1", "mapRendering")).toBe(false);
        expect(versionSupports("1.18", "mapRendering")).toBe(true);
        expect(versionSupports("1.12.2", "playerStats")).toBe(false);
        expect(versionSupports("1.13", "playerStats")).toBe(true);
        expect(versionSupports("1.8.9", "worldManager")).toBe(false);
        expect(versionSupports("1.9", "worldManager")).toBe(true);
    });
});

describe("minimum supported version", () => {
    test("versions below 1.12.2 are unsupported", () => {
        expect(isSupportedMcVersion("1.7.10")).toBe(false);
        expect(isSupportedMcVersion("1.12.1")).toBe(false);
        expect(isSupportedMcVersion("1.12.2")).toBe(true);
        expect(isSupportedMcVersion("26.2")).toBe(true);
        expect(isSupportedMcVersion("")).toBe(false);
        expect(isSupportedMcVersion(undefined)).toBe(false);
    });
});
