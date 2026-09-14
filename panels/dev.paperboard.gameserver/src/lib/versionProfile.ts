import semver from "semver";
import { getRequiredJavaVersion, type ServerSoftwareType } from "./software";

// One place that answers "what does this (software, version) actually look
// like?" for every version-sensitive feature in the panel. Modules consult a
// profile instead of hardcoding version checks, so supporting a new
// Minecraft version is a one-row data change here plus a boundary test —
// not a hunt through the codebase.
//
// Boundaries were researched against the vanilla changelogs and PaperMC
// docs (see the PR for the matrix). The versions where behaviour flips are:
//   1.16       legacy level-type values (default/flat/largeBiomes/amplified)
//   1.18       Overworld min build height drops to -64
//   1.19       level-type becomes world-preset ids
//   1.21.2     pause-when-empty appears
//   1.21.9     pvp/allow-nether/spawn-monsters/enable-command-block become gamerules
//   1.21.11    gamerules renamed camelCase -> namespaced snake_case
//   26.1       world storage moves under dimensions/ + players/; Java 25

export type GameruleNaming = "legacy" | "namespaced";
export type WorldLayout = "dimensions" | "bukkit-split" | "vanilla-split";
export type PlayerDataFolder = "players" | "legacy";

export interface LevelTypeOption {
    value: string;
    label: string;
}

export interface VersionProfile {
    version: string;
    software: ServerSoftwareType;
    /** installed package name for the JVM this version needs, or null when unknown */
    javaPackage: string | null;
    /** how `/gamerule` names are spelled this era */
    gameruleNaming: GameruleNaming;
    /** server.properties keys removed in favour of gamerules */
    propertiesMovedToGamerules: readonly string[];
    supportsWorldPresetLevelType: boolean;
    /** dimension directory layout on disk */
    worldLayout: WorldLayout;
    /** where player data lives under the level directory */
    playerDataFolder: PlayerDataFolder;
    /** lowest block Y the map renderer must assume for the Overworld */
    mapMinBuildHeight: number;
    levelTypeOptions: LevelTypeOption[];
}

// property keys that stopped being server.properties keys in 1.21.9
const PROPERTIES_MOVED_TO_GAMERULES = [
    "pvp",
    "allow-nether",
    "spawn-monsters",
    "enable-command-block",
] as const;

// 1.19+ world-preset ids. Namespace omitted on purpose: it sidesteps the
// Java-properties `:` escaping question entirely and is the form Paper
// documents.
const PRESET_LEVEL_TYPES: LevelTypeOption[] = [
    { value: "normal", label: "Normal" },
    { value: "flat", label: "Superflat" },
    { value: "large_biomes", label: "Large Biomes" },
    { value: "amplified", label: "Amplified" },
    { value: "single_biome_surface", label: "Single Biome" },
];

// 1.16–1.18 bare legacy values
const LEGACY_LEVEL_TYPES: LevelTypeOption[] = [
    { value: "default", label: "Default" },
    { value: "flat", label: "Superflat" },
    { value: "largeBiomes", label: "Large Biomes" },
    { value: "amplified", label: "Amplified" },
];

// 1.15 and older uppercase values
const ANCIENT_LEVEL_TYPES: LevelTypeOption[] = [
    { value: "DEFAULT", label: "Default" },
    { value: "FLAT", label: "Superflat" },
    { value: "LARGEBIOMES", label: "Large Biomes" },
    { value: "AMPLIFIED", label: "Amplified" },
    { value: "BUFFET", label: "Buffet" },
    { value: "CUSTOMIZED", label: "Customized" },
];

// pure version comparison over shorthand ("1.18", "26.1") and full
// ("1.21.11") release strings; snapshots coerce to their base release
export function mcSatisfies(
    version: string | null | undefined,
    range: { since?: string; until?: string },
): boolean {
    if (!range.since && !range.until) return true;
    if (!version) return false;
    const v = semver.coerce(version);
    if (!v) return false;
    const since = range.since ? semver.coerce(range.since) : null;
    const until = range.until ? semver.coerce(range.until) : null;
    if (since && !semver.gte(v, since)) return false;
    if (until && !semver.lt(v, until)) return false;
    return true;
}

export function mcAtLeast(
    version: string | null | undefined,
    boundary: string,
): boolean {
    return mcSatisfies(version, { since: boundary });
}

export function levelTypeOptionsFor(
    software: ServerSoftwareType,
    version: string | null | undefined,
): LevelTypeOption[] {
    void software;
    if (mcAtLeast(version, "1.19")) return PRESET_LEVEL_TYPES;
    if (mcAtLeast(version, "1.16")) return LEGACY_LEVEL_TYPES;
    return ANCIENT_LEVEL_TYPES;
}

export function resolveVersionProfile(
    software: ServerSoftwareType,
    version: string,
): VersionProfile {
    const dimensionsLayout = mcAtLeast(version, "26.1");
    const worldLayout: WorldLayout = dimensionsLayout
        ? "dimensions"
        : software === "paper"
          ? "bukkit-split"
          : "vanilla-split";
    return {
        version,
        software,
        javaPackage: getRequiredJavaVersion(version),
        gameruleNaming: mcAtLeast(version, "1.21.11") ? "namespaced" : "legacy",
        propertiesMovedToGamerules: mcAtLeast(version, "1.21.9")
            ? PROPERTIES_MOVED_TO_GAMERULES
            : [],
        supportsWorldPresetLevelType: mcAtLeast(version, "1.19"),
        worldLayout,
        playerDataFolder: dimensionsLayout ? "players" : "legacy",
        mapMinBuildHeight: mcAtLeast(version, "1.18") ? -64 : 0,
        levelTypeOptions: levelTypeOptionsFor(software, version),
    };
}
