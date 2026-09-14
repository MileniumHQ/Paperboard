import semver from "semver";
import type { ServerSoftwareType } from "./software";

// One place that answers "what does this (software, version) actually look
// like?" for every version-sensitive feature in the panel. Modules consult a
// profile instead of hardcoding version checks, so supporting a new
// Minecraft version is a one-row data change here plus a boundary test —
// not a hunt through the codebase.
//
// Boundaries researched against vanilla changelogs and PaperMC docs:
//   1.16       legacy level-type values (default/flat/largeBiomes/amplified)
//   1.18       Overworld min build height drops to -64; modern chunk palette
//   1.19       level-type becomes world-preset ids
//   1.21.2     pause-when-empty appears
//   1.21.9     pvp/allow-nether/spawn-monsters/enable-command-block become gamerules
//   1.21.11    gamerules renamed camelCase -> namespaced snake_case (some inverted)
//   26.1       world storage moves under dimensions/ + players/; Java 25

export type GameruleNaming = "legacy" | "namespaced";
export type WorldLayout = "dimensions" | "bukkit-split" | "vanilla-split";
export type PlayerDataFolder = "players" | "legacy";
export type MapPalette = "modern" | "legacy";

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
    /** chunk section palette format the map renderer can parse */
    mapPalette: MapPalette;
    levelTypeOptions: LevelTypeOption[];
}

// ─── capabilities ────────────────────────────────────────────────────
// version-dependent facts, "since"/"until" bound each. Moved here so the
// profile is the single source; capabilities.ts re-exports for the UI.
export const CAPABILITIES = {
    enableStatus: { since: "1.16" },
    hideOnlinePlayers: { since: "1.18" },
    rateLimit: { since: "1.16.2" },
    acceptsTransfers: { since: "1.20.5" },

    simulationDistance: { since: "1.18" },
    pauseWhenEmpty: { since: "1.21.2" },
    propertyPvp: { until: "1.21.9" },
    propertyAllowNether: { until: "1.21.9" },
    propertySpawnMonsters: { until: "1.21.9" },
    propertyEnableCommandBlock: { until: "1.21.9" },

    legacyLevelTypePresets: { until: "1.19" },
    worldPresetLevelType: { since: "1.19" },

    requireResourcePack: { since: "1.17" },
    resourcePackPrompt: { since: "1.17" },
    resourcePackId: { since: "1.20.3" },

    functionPermissionLevel: { since: "1.14.4" },
    syncChunkWrites: { since: "1.16" },
    enforceSecureProfile: { since: "1.19" },
    logIps: { since: "1.20.2" },
    bugReportLink: { since: "1.21" },
    entityBroadcastRange: { since: "1.16" },
} as const;

export type CapabilityName = keyof typeof CAPABILITIES;

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

// pre-1.21.11 gamerule names -> the canonical (1.21.11+) snake_case id.
// Explicit rather than derived: several renames are irregular
// (doDaylightCycle -> advance_time, doMobSpawning -> spawn_mobs, ...), and
// the reverse lookup has to be exact to merge readouts onto the right rule.
const GAMERULE_LEGACY_ALIASES: Record<string, string> = {
    announceAdvancements: "show_advancement_messages",
    commandBlocksEnabled: "command_blocks_work",
    command_modification_block_limit: "max_block_modifications",
    commandBlockOutput: "command_block_output",
    disableElytraMovementCheck: "elytra_movement_check",
    disablePlayerMovementCheck: "player_movement_check",
    disableRaids: "raids",
    doDaylightCycle: "advance_time",
    doEntityDrops: "entity_drops",
    doFireTick: "fire_spread_radius_around_player",
    allowFireTicksAwayFromPlayer: "fire_spread_radius_around_player",
    doImmediateRespawn: "immediate_respawn",
    doInsomnia: "spawn_phantoms",
    doLimitedCrafting: "limited_crafting",
    doMobLoot: "mob_drops",
    doMobSpawning: "spawn_mobs",
    doPatrolSpawning: "spawn_patrols",
    doTileDrops: "block_drops",
    doTraderSpawning: "spawn_wandering_traders",
    doVinesSpread: "spread_vines",
    doWardenSpawning: "spawn_wardens",
    doWeatherCycle: "advance_weather",
    enderPearlsVanishOnDeath: "ender_pearls_vanish_on_death",
    keepInventory: "keep_inventory",
    locatorBar: "locator_bar",
    logAdminCommands: "log_admin_commands",
    maxCommandChainLength: "max_command_sequence_length",
    maxCommandForkCount: "max_command_forks",
    minecartMaxSpeed: "max_minecart_speed",
    mobGriefing: "mob_griefing",
    naturalRegeneration: "natural_health_regeneration",
    projectilesCanBreakBlocks: "projectiles_can_break_blocks",
    randomTickSpeed: "random_tick_speed",
    showDeathMessages: "show_death_messages",
    snowAccumulationHeight: "max_snow_accumulation_height",
    spawnRadius: "respawn_radius",
    spawnerBlocksEnabled: "spawner_blocks_work",
    tntExplodes: "tnt_explodes",
    // 1.21.9's camelCase introductions, renamed again in 1.21.11
    pvp: "pvp",
    allowEnteringNetherUsingPortals: "allow_entering_nether_using_portals",
    spawnMonsters: "spawn_monsters",
};

// legacy names whose boolean meaning is inverted relative to the canonical
// rule (old `disableX=true` == new `x=false`)
const GAMERULE_INVERTED: ReadonlySet<string> = new Set([
    "elytra_movement_check",
    "player_movement_check",
    "raids",
]);

const CANONICAL_TO_LEGACY: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    for (const [legacy, canonical] of Object.entries(GAMERULE_LEGACY_ALIASES)) {
        if (!(canonical in map)) map[canonical] = legacy;
    }
    return map;
})();

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

export function versionSupports(
    version: string | null | undefined,
    capability: CapabilityName,
): boolean {
    return mcSatisfies(version, CAPABILITIES[capability]);
}

export function profileSupports(
    profile: VersionProfile,
    capability: CapabilityName,
): boolean {
    return versionSupports(profile.version, capability);
}

// ─── gamerule name/value translation ─────────────────────────────────
function camelCase(name: string): string {
    return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function snakeCase(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function invertBool(value: string): string {
    if (value === "true") return "false";
    if (value === "false") return "true";
    return value;
}

/** canonical (1.21.11+) gamerule id -> the name this server speaks */
export function serverGameruleName(
    profile: VersionProfile,
    canonicalName: string,
): string {
    if (profile.gameruleNaming === "namespaced") return canonicalName;
    return CANONICAL_TO_LEGACY[canonicalName] ?? camelCase(canonicalName);
}

/** a name read from the server log -> the canonical id the panel stores */
export function canonicalGameruleName(
    profile: VersionProfile,
    serverName: string,
): string {
    if (profile.gameruleNaming === "namespaced") return serverName;
    return GAMERULE_LEGACY_ALIASES[serverName] ?? snakeCase(serverName);
}

/** canonical value -> the value this server expects (inverts `disable*` rules) */
export function serverGameruleValue(
    profile: VersionProfile,
    canonicalName: string,
    canonicalValue: string,
): string {
    if (profile.gameruleNaming === "namespaced") return canonicalValue;
    return GAMERULE_INVERTED.has(canonicalName)
        ? invertBool(canonicalValue)
        : canonicalValue;
}

/** a value read from the server log -> the canonical value */
export function canonicalGameruleValue(
    profile: VersionProfile,
    canonicalName: string,
    serverValue: string,
): string {
    return serverGameruleValue(profile, canonicalName, serverValue);
}

// ─── world storage paths ─────────────────────────────────────────────
export interface WorldPaths {
    overworld: string;
    nether: string;
    end: string;
    playerData: (uuid: string) => string;
    playerDataOld: (uuid: string) => string;
    stats: (uuid: string) => string;
    advancements: (uuid: string) => string;
}

// Where each world's data lives for this profile. Exposed so the world
// list, deletion, map and stats readers can share one resolver instead of
// each hardcoding a layout (they currently disagree).
export function worldPathsFor(
    profile: VersionProfile,
    levelName: string,
): WorldPaths {
    const level = levelName;
    if (profile.worldLayout === "dimensions") {
        return {
            overworld: `${level}/dimensions/minecraft/overworld`,
            nether: `${level}/dimensions/minecraft/the_nether`,
            end: `${level}/dimensions/minecraft/the_end`,
            playerData: (u) => `${level}/players/data/${u}.dat`,
            playerDataOld: (u) => `${level}/players/data/${u}.dat_old`,
            stats: (u) => `${level}/players/stats/${u}.json`,
            advancements: (u) => `${level}/players/advancements/${u}.json`,
        };
    }
    const nether =
        profile.worldLayout === "bukkit-split"
            ? `${level}_nether`
            : `${level}/DIM-1`;
    const end =
        profile.worldLayout === "bukkit-split" ? `${level}_the_end` : `${level}/DIM1`;
    return {
        overworld: level,
        nether,
        end,
        playerData: (u) => `${level}/playerdata/${u}.dat`,
        playerDataOld: (u) => `${level}/playerdata/${u}.dat_old`,
        stats: (u) => `${level}/stats/${u}.json`,
        advancements: (u) => `${level}/advancements/${u}.json`,
    };
}

// ─── sparse version overrides ────────────────────────────────────────
// A sparse delta. Only the fields named change; everything else inherits
// from the nearest earlier override (or the baseline). An override at
// "1.16" therefore holds until "1.19" replaces the same field, and a
// one-off at "1.16.5" changes only the fields it names.
export interface ProfilePatch {
    javaPackage?: string;
    gameruleNaming?: GameruleNaming;
    propertiesMovedToGamerules?: readonly string[];
    supportsWorldPresetLevelType?: boolean;
    worldLayout?: WorldLayout;
    playerDataFolder?: PlayerDataFolder;
    mapMinBuildHeight?: number;
    mapPalette?: MapPalette;
    levelTypeOptions?: LevelTypeOption[];
}

export interface VersionOverride {
    at: string;
    patch: ProfilePatch;
}

type ResolvedFacts = Omit<VersionProfile, "version" | "software">;

const BASELINE: ResolvedFacts = {
    javaPackage: "java-8",
    gameruleNaming: "legacy",
    propertiesMovedToGamerules: [],
    supportsWorldPresetLevelType: false,
    worldLayout: "vanilla-split",
    playerDataFolder: "legacy",
    mapMinBuildHeight: 0,
    mapPalette: "legacy",
    levelTypeOptions: ANCIENT_LEVEL_TYPES,
};

// Ascending by `at`. Add a row to change behaviour from that version until
// the next row that names the same field. Gaps inherit — not every version
// needs an entry.
export const VERSION_OVERRIDES: readonly VersionOverride[] = [
    { at: "1.16", patch: { levelTypeOptions: LEGACY_LEVEL_TYPES } },
    { at: "1.17", patch: { javaPackage: "java-16" } },
    {
        at: "1.18",
        patch: {
            javaPackage: "java-17",
            mapMinBuildHeight: -64,
            mapPalette: "modern",
        },
    },
    {
        at: "1.19",
        patch: {
            levelTypeOptions: PRESET_LEVEL_TYPES,
            supportsWorldPresetLevelType: true,
        },
    },
    { at: "1.20.5", patch: { javaPackage: "java-21" } },
    {
        at: "1.21.9",
        patch: { propertiesMovedToGamerules: PROPERTIES_MOVED_TO_GAMERULES },
    },
    { at: "1.21.11", patch: { gameruleNaming: "namespaced" } },
    {
        at: "26.1",
        patch: {
            javaPackage: "java-25",
            worldLayout: "dimensions",
            playerDataFolder: "players",
        },
    },
];

// software baseline for fields the version table leaves open
const SOFTWARE_WORLD_LAYOUT: Record<ServerSoftwareType, WorldLayout> = {
    paper: "bukkit-split",
    vanilla: "vanilla-split",
    fabric: "vanilla-split",
};

// merges every override at or below `version`, ascending, over the
// software baseline; a later row's named fields win, unnamed fields inherit
export function resolveFactsWith(
    software: ServerSoftwareType,
    version: string | null | undefined,
    overrides: readonly VersionOverride[],
): ResolvedFacts {
    const facts: ResolvedFacts = {
        ...BASELINE,
        worldLayout: SOFTWARE_WORLD_LAYOUT[software] ?? BASELINE.worldLayout,
    };
    // sort defensively so nearest-earlier wins regardless of authoring order
    const ordered = [...overrides].sort((a, b) => {
        const av = semver.coerce(a.at);
        const bv = semver.coerce(b.at);
        if (!av || !bv) return 0;
        return semver.compare(av, bv);
    });
    for (const override of ordered) {
        if (mcAtLeast(version, override.at)) {
            Object.assign(facts, override.patch);
        }
    }
    return facts;
}

export function resolveFacts(
    software: ServerSoftwareType,
    version: string | null | undefined,
): ResolvedFacts {
    return resolveFactsWith(software, version, VERSION_OVERRIDES);
}

export function resolveVersionProfile(
    software: ServerSoftwareType,
    version: string,
): VersionProfile {
    return { version, software, ...resolveFacts(software, version) };
}

export function javaPackageFor(version: string): string | null {
    if (!semver.coerce(version)) return null;
    return resolveFacts("vanilla", version).javaPackage;
}

export function levelTypeOptionsFor(
    software: ServerSoftwareType,
    version: string | null | undefined,
): LevelTypeOption[] {
    return resolveFacts(software, version).levelTypeOptions;
}
