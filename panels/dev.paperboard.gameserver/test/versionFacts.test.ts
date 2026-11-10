import { describe, expect, test } from "bun:test";
import { isSupportedMcVersion, javaPackageFor, resolveVersionProfile, worldPathsFor } from "../src/lib/versionProfile";
import { groupNeoForgeBuilds, neoForgeInstallerUrl, parseNeoForgeVersion, pickNeoForgeBuild } from "../src/games/minecraft/providers/neoforge";
import { forgeInstallerUrl, forgeMcVersions, pickForgeBuild } from "../src/games/minecraft/providers/forge";
import { pickFabricLoader } from "../src/games/minecraft/providers/fabric";

// Version facts pick the right Java, loader build and world paths.
describe("version facts", () => {
    test("each Minecraft version runs the Java it needs, snapshots through their cycle", () => {
        const java: Record<string, string> = {
            "1.12.2": "java-8",
            "1.16.5": "java-8",
            "1.17": "java-17",
            "1.20.4": "java-17",
            "1.20.5": "java-21",
            "1.21.11": "java-21",
            "26.1": "java-25",
            "26.3": "java-25",
            // weekly snapshots resolve to the release their cycle ships
            "21w37a": "java-17",
            "23w46a": "java-17",
            "24w18a": "java-21",
            // drop snapshots and pre-releases carry their release
            "26.1-snapshot-6": "java-25",
            "1.20.5-pre1": "java-21",
            "1.20.5-rc1": "java-21",
        };
        for (const [version, pkg] of Object.entries(java)) expect([version, javaPackageFor(version)]).toEqual([version, pkg]);
    });

    test("versions below 1.12.2 are unsupported", () => {
        expect(isSupportedMcVersion("1.12.2")).toBe(true);
        for (const version of ["1.12.1", "1.8.9", "1.7.10", "17w31a", "not-a-version", "", null]) {
            expect(isSupportedMcVersion(version)).toBe(false);
        }
    });

    test("NeoForge builds map to their Minecraft release in both numbering schemes, without snapshot or April-fools builds", () => {
        expect(parseNeoForgeVersion("21.1.256")?.mcVersion).toBe("1.21.1");
        expect(parseNeoForgeVersion("21.0.167")?.mcVersion).toBe("1.21");
        expect(parseNeoForgeVersion("26.1.2.114")?.mcVersion).toBe("26.1.2");
        expect(parseNeoForgeVersion("26.2.0.88-beta")).toMatchObject({ mcVersion: "26.2", stable: false });
        expect(parseNeoForgeVersion("26.1.0.0-alpha.1+snapshot-1")).toBeNull();
        expect(parseNeoForgeVersion("0.25w14craftmine.3-beta")).toBeNull();

        // numeric, not string, order: 21.1.99 is older than 21.1.256
        const groups = groupNeoForgeBuilds(["21.1.99", "21.1.256", "21.1.300-beta", "21.0.167", "0.25w14craftmine.3-beta"]);
        expect(groups.get("1.21.1")!.map((b) => b.build)).toEqual(["21.1.300-beta", "21.1.256", "21.1.99"]);
        expect([...groups.keys()]).toEqual(["1.21.1", "1.21"]);
        // newest stable wins over a newer beta; a pin must be one of the version's builds
        expect(pickNeoForgeBuild(groups.get("1.21.1")!)?.build).toBe("21.1.256");
        expect(pickNeoForgeBuild(groups.get("1.21.1")!, "21.1.99")?.build).toBe("21.1.99");
        expect(pickNeoForgeBuild(groups.get("1.21.1")!, "21.0.167")).toBeNull();
        expect(neoForgeInstallerUrl("21.1.256")).toBe(
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.256/neoforge-21.1.256-installer.jar",
        );
    });

    test("Forge picks the promoted build only when Maven lists it, and a pinned build must exist", () => {
        const metadata = { "1.20.1": ["1.20.1-47.4.0", "1.20.1-47.4.10"], "1.9.4": ["1.9.4-12.17.0.2317"], "1.20.1-pre1": ["x"] };
        expect(forgeMcVersions(metadata)).toEqual(["1.20.1", "1.9.4"]);
        expect(pickForgeBuild("1.20.1", metadata, { "1.20.1-recommended": "47.4.0", "1.20.1-latest": "47.4.10" })).toBe("47.4.0");
        // a promotion Maven does not list is not honoured
        expect(pickForgeBuild("1.20.1", metadata, { "1.20.1-recommended": "47.9.9" })).toBe("47.4.10");
        expect(pickForgeBuild("1.20.1", metadata, {}, "47.4.0")).toBe("47.4.0");
        expect(pickForgeBuild("1.20.1", metadata, {}, "47.9.9")).toBeNull();
        expect(forgeInstallerUrl("1.20.1", "47.4.10")).toBe(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.10/forge-1.20.1-47.4.10-installer.jar",
        );
        expect(pickFabricLoader(["0.16.10", "0.16.9"])).toBe("0.16.10");
        expect(pickFabricLoader(["0.16.10"], "0.15.0")).toBeNull();
    });

    test("world paths follow the version: Paper's split roots before 26.1, vanilla DIM-1, and 26.1+ dimensions/ and players/", () => {
        const paper = worldPathsFor(resolveVersionProfile("paper", "1.21.1"), "world");
        expect([paper.overworld, paper.nether, paper.end]).toEqual(["world", "world_nether", "world_the_end"]);
        expect(paper.playerData("u")).toBe("world/playerdata/u.dat");
        const vanilla = worldPathsFor(resolveVersionProfile("vanilla", "1.21.1"), "survival");
        expect([vanilla.nether, vanilla.end]).toEqual(["survival/DIM-1", "survival/DIM1"]);
        for (const software of ["paper", "vanilla"] as const) {
            const modern = worldPathsFor(resolveVersionProfile(software, "26.1"), "world");
            expect([modern.overworld, modern.nether, modern.end]).toEqual([
                "world/dimensions/minecraft/overworld",
                "world/dimensions/minecraft/the_nether",
                "world/dimensions/minecraft/the_end",
            ]);
            expect([modern.playerData("u"), modern.stats("u"), modern.advancements("u")]).toEqual([
                "world/players/data/u.dat",
                "world/players/stats/u.json",
                "world/players/advancements/u.json",
            ]);
        }
    });
});
