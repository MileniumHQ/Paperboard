// Version mapping for the installer-based softwares, fed with version
// strings copied from the live NeoForge and Forge indexes (2026-10). The
// mapping decides which Minecraft version a loader build is installed for,
// so a wrong row installs a server that cannot load the user's world.
import { describe, expect, test } from "bun:test";
import {
    groupNeoForgeBuilds,
    neoForgeInstallerUrl,
    parseNeoForgeVersion,
    pickNeoForgeBuild,
} from "../src/software/providers/neoforge";
import { forgeInstallerUrl, forgeMcVersions, pickForgeBuild } from "../src/software/providers/forge";
import { SOFTWARE_PROVIDERS } from "../src/software/providers";
import { SOFTWARE, SOFTWARE_IDS } from "../src/software/catalog";

describe("NeoForge versions", () => {
    test("both numbering schemes map to the Minecraft release they run", () => {
        expect(parseNeoForgeVersion("21.1.256")?.mcVersion).toBe("1.21.1");
        expect(parseNeoForgeVersion("21.0.167")?.mcVersion).toBe("1.21");
        expect(parseNeoForgeVersion("20.2.3-beta")?.mcVersion).toBe("1.20.2");
        expect(parseNeoForgeVersion("26.1.2.114")?.mcVersion).toBe("26.1.2");
        expect(parseNeoForgeVersion("26.2.0.88")?.mcVersion).toBe("26.2");
        expect(parseNeoForgeVersion("26.3.0.57-beta")).toMatchObject({ mcVersion: "26.3", stable: false });
    });

    test("snapshot and April-fools builds are not offered", () => {
        expect(parseNeoForgeVersion("26.1.0.0-alpha.1+snapshot-1")).toBeNull();
        expect(parseNeoForgeVersion("26.1.0.0-alpha.15+pre-3")).toBeNull();
        expect(parseNeoForgeVersion("0.25w14craftmine.3-beta")).toBeNull();
    });

    const LIVE_SAMPLE = [
        "0.25w14craftmine.3-beta",
        "20.2.3-beta",
        "20.2.93",
        "21.0.0-beta",
        "21.0.167",
        "21.1.1",
        "21.1.9",
        "21.1.10",
        "21.1.256",
        "21.9.16-beta",
        "26.1.0.0-alpha.1+snapshot-1",
        "26.1.0.19-beta",
        "26.1.2.114",
        "26.2.0.0-beta",
        "26.2.0.88",
        "26.3.0.57-beta",
    ];

    test("groups are newest first and builds order numerically, not as text", () => {
        const groups = groupNeoForgeBuilds(LIVE_SAMPLE);
        expect([...groups.keys()]).toEqual(["26.3", "26.2", "26.1.2", "26.1", "1.21.9", "1.21.1", "1.21", "1.20.2"]);
        expect(groups.get("1.21.1")!.map((b) => b.build)).toEqual(["21.1.256", "21.1.10", "21.1.9", "21.1.1"]);
    });

    test("the newest stable build wins; a beta-only line still installs its newest beta", () => {
        const groups = groupNeoForgeBuilds(LIVE_SAMPLE);
        expect(pickNeoForgeBuild(groups.get("26.2")!)?.build).toBe("26.2.0.88");
        expect(pickNeoForgeBuild(groups.get("1.21.9")!)?.build).toBe("21.9.16-beta");
        expect(pickNeoForgeBuild([])).toBeNull();
    });

    test("installer url is the Maven artifact path", () => {
        expect(neoForgeInstallerUrl("21.1.256")).toBe(
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.256/neoforge-21.1.256-installer.jar",
        );
    });
});

describe("Forge versions", () => {
    const METADATA = {
        "1.7.10_pre4": ["1.7.10_pre4-10.12.2.1149-prerelease"],
        "1.12.2": ["1.12.2-14.23.5.2859", "1.12.2-14.23.5.2860", "1.12.2-14.23.5.2864"],
        "1.21.1": ["1.21.1-52.0.0", "1.21.1-52.1.0", "1.21.1-52.1.16"],
        "1.21.10": ["1.21.10-60.1.0", "1.21.10-60.1.15"],
        "26.3": ["26.3-66.0.0", "26.3-66.0.9"],
    };
    const PROMOS = {
        "1.12.2-recommended": "14.23.5.2859",
        "1.12.2-latest": "14.23.5.2864",
        "1.21.1-recommended": "52.1.0",
        "1.21.1-latest": "52.1.16",
        "26.3-latest": "66.0.9",
    };

    test("releases only, newest first, 1.21.10 above 1.21.1", () => {
        expect(forgeMcVersions(METADATA)).toEqual(["26.3", "1.21.10", "1.21.1", "1.12.2"]);
    });

    test("recommended, then latest, then newest published", () => {
        expect(pickForgeBuild("1.12.2", METADATA, PROMOS)).toBe("14.23.5.2859");
        expect(pickForgeBuild("26.3", METADATA, PROMOS)).toBe("66.0.9");
        expect(pickForgeBuild("1.21.10", METADATA, PROMOS)).toBe("60.1.15");
        expect(pickForgeBuild("1.20.4", METADATA, PROMOS)).toBeNull();
    });

    test("a promotion the Maven index does not list is not trusted", () => {
        const promos = { "1.21.1-recommended": "52.9.9" };
        expect(pickForgeBuild("1.21.1", METADATA, promos)).toBe("52.1.16");
    });

    test("installer url is the Maven artifact path", () => {
        expect(forgeInstallerUrl("1.21.1", "52.1.0")).toBe(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/1.21.1-52.1.0/forge-1.21.1-52.1.0-installer.jar",
        );
    });
});

test("every catalog software has a provider, and installer softwares name their launch files", () => {
    for (const id of SOFTWARE_IDS) {
        const provider = SOFTWARE_PROVIDERS[id];
        expect(provider.id).toBe(id);
        expect(SOFTWARE[id].id).toBe(id);
    }
    const neo = SOFTWARE_PROVIDERS.neoforge.install;
    const forge = SOFTWARE_PROVIDERS.forge.install;
    if (neo.type !== "installer" || forge.type !== "installer") throw new Error("expected installers");
    // paths observed from real installer runs (NeoForge 21.1.256, Forge 52.1.0 / 36.2.34)
    expect(neo.launchCandidates("1.21.1", "21.1.256").argfileDir).toBe("libraries/net/neoforged/neoforge/21.1.256");
    expect(forge.launchCandidates("1.21.1", "52.1.0").argfileDir).toBe("libraries/net/minecraftforge/forge/1.21.1-52.1.0");
    expect(forge.launchCandidates("1.16.5", "36.2.34").jars?.[0]).toBe("forge-1.16.5-36.2.34.jar");
    expect(neo.args("/s/installer.jar", "/s/server")).toEqual(["-jar", "/s/installer.jar", "--installServer", "/s/server"]);
});

test("mod loaders install add-ons from their own Modrinth loader into mods/", () => {
    expect(SOFTWARE.neoforge.addons).toMatchObject({ dir: "mods", modrinthLoader: "neoforge", kind: "mod" });
    expect(SOFTWARE.forge.addons).toMatchObject({ dir: "mods", modrinthLoader: "forge", kind: "mod" });
    expect(SOFTWARE.vanilla.addons).toBeNull();
});
