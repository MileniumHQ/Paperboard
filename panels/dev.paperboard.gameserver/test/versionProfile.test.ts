import { describe, expect, test } from "bun:test";
import {
    levelTypeOptionsFor,
    mcAtLeast,
    mcSatisfies,
    resolveVersionProfile,
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
});
