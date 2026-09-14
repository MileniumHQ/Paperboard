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
// version-dependent facts, "since"/"until" bound each. Snapshot ids cite
// minecraft.wiki's Server.properties history. Moved here so the profile is
// the single source; capabilities.ts re-exports for the UI.
export const CAPABILITIES = {
    enableStatus: { since: "1.16" }, // 20w18a
    hideOnlinePlayers: { since: "1.18" }, // 21w44a
    rateLimit: { since: "1.16.2" }, // 20w28a
    acceptsTransfers: { since: "1.20.5" }, // 24w03a

    simulationDistance: { since: "1.18" }, // 21w38a
    pauseWhenEmpty: { since: "1.21.2" }, // 24w33a
    propertyPvp: { until: "1.21.9" }, // 25w35a
    propertyAllowNether: { until: "1.21.9" }, // 25w35a
    propertySpawnMonsters: { until: "1.21.9" }, // 25w35a
    propertyEnableCommandBlock: { until: "1.21.9" }, // 25w35a

    requireResourcePack: { since: "1.17" }, // 20w45a
    resourcePackPrompt: { since: "1.17" }, // 21w15a
    resourcePackId: { since: "1.20.3" }, // 1.20.3-pre1

    functionPermissionLevel: { since: "1.14.4" }, // 1.14.4-pre4
    syncChunkWrites: { since: "1.16" }, // 20w14a
    enforceSecureProfile: { since: "1.19" }, // 22w17a
    logIps: { since: "1.20.2" }, // 23w31a
    bugReportLink: { since: "1.21" }, // 24w21a
    entityBroadcastRange: { since: "1.16" }, // 20w18a

    // whole-feature floors: below these the tab is hidden entirely rather
    // than shown with half its controls doing nothing
    mapRendering: { since: "1.18" }, // block_states palette + -64 heightmaps
    playerStats: { since: "1.13" }, // namespaced stats/<uuid>.json
    worldManager: { since: "1.9" }, // hardcore / bonus-chest world options
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

// Level-type value sets by era. The post-1.19 world-preset ids are
// documented precisely; the pre-1.19 legacy names changed case across the
// flattening (1.12 server.properties wrote DEFAULT, 1.13+ lowercase) and the
// wiki lists the extras lowercase. The game has historically accepted the
// legacy names, so treat the case as best-effort, not load-bearing.
//
// 1.13–1.15: lowercase bare values; buffet/default_1_1/customized still exist
const LEGACY_MID_LEVEL_TYPES: LevelTypeOption[] = [
    { value: "default", label: "Default" },
    { value: "flat", label: "Superflat" },
    { value: "largeBiomes", label: "Large Biomes" },
    { value: "amplified", label: "Amplified" },
    { value: "buffet", label: "Buffet" },
    { value: "default_1_1", label: "Default 1.1" },
    { value: "customized", label: "Customized" },
];

// 1.16–1.18: the three removed options are gone
const LEGACY_LEVEL_TYPES: LevelTypeOption[] = [
    { value: "default", label: "Default" },
    { value: "flat", label: "Superflat" },
    { value: "largeBiomes", label: "Large Biomes" },
    { value: "amplified", label: "Amplified" },
];

// 1.12 and older: uppercase values
const ANCIENT_LEVEL_TYPES: LevelTypeOption[] = [
    { value: "DEFAULT", label: "Default" },
    { value: "FLAT", label: "Superflat" },
    { value: "LARGEBIOMES", label: "Large Biomes" },
    { value: "AMPLIFIED", label: "Amplified" },
    { value: "CUSTOMIZED", label: "Customized" },
];

// pre-1.21.11 gamerule names -> the canonical (1.21.11+) snake_case id.
// Explicit rather than derived: several renames are irregular
// (doDaylightCycle -> advance_time, doMobSpawning -> spawn_mobs, ...), and
// the reverse lookup has to be exact to merge readouts onto the right rule.
const GAMERULE_LEGACY_ALIASES: Record<string, string> = {
    announceAdvancements: "show_advancement_messages",
    commandBlocksEnabled: "command_blocks_work",
    // 25w35a..1.21.9 dev builds called it enableCommandBlocks before the
    // release renamed it to commandBlocksEnabled
    enableCommandBlocks: "command_blocks_work",
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

// Minecraft version identifiers are not all semver. Classify before
// comparing, then map to the release whose behaviour the build carries:
//   release   "1.21.11", "26.1"        -> itself
//   pre / rc  "1.21.5-pre1", "-rc1"    -> its base release
//   snapshot  "25w35a"                 -> anchored release, else itself
//   old_*     "b1.7.3", "a1.2.6"       -> "0.0.0" (pre-1.0)
export type McVersionKind =
    | "release"
    | "snapshot"
    | "pre"
    | "rc"
    | "old_beta"
    | "old_alpha"
    | "unknown";

export interface ClassifiedMcVersion {
    raw: string;
    kind: McVersionKind;
    /** the release id the build behaves as; "0.0.0" for pre-1.0 builds */
    base: string;
}

const WEEKLY_SNAPSHOT_RE = /^(\d{2})w(\d{2})([a-z])$/i;
const DROP_SNAPSHOT_RE = /^(\d+\.\d+(?:\.\d+)?)[-_]snapshot[-_]?\d+$/i;
const PRE_RC_RE =
    /^(\d+\.\d+(?:\.\d+)?)[-_](pre(?:[-_]?release)?|rc)[-_]?\d*$/i;
const RELEASE_RE = /^\d+\.\d+(?:\.\d+)?$/;
const OLD_RE =
    /^(?:[ab]\d+(?:\.\d+)*|rd[-_]?\d|inf[-_]?\d|pre[-_]?classic|classic|indev|infdev|alpha|beta)/i;

// Weekly "YYwWWx" snapshots are frozen (the calendar drops now use
// "<drop>-snapshot-N" / "<drop>-pre-N"), so this table is permanent. It is
// generated from Mojang's version manifest: each entry is the FIRST weekly
// snapshot whose next release (by releaseTime) is that id, so one row covers
// a whole dev cycle. A snapshot resolves to the latest row at or before it.
//
// Two rows are feature refinements rather than pure cycle starts, because a
// behaviour we gate on changed mid-cycle and the earlier snapshots in that
// cycle must keep the previous behaviour:
//   25w35a  1.21.9  (cycle started 25w31a) — properties -> gamerules
//   25w44a  1.21.11 (cycle started 25w41a) — gamerule namespaced rename
// Regenerate with the manifest when this ever needs revisiting.
export const SNAPSHOT_RELEASE_ANCHORS: Record<string, string> = {
    "13w16a": "1.5.2",
    "13w17a": "1.6.1",
    "13w36a": "1.6.4",
    "13w38a": "1.7.2",
    "13w47a": "1.7.3",
    "14w02a": "1.7.5",
    "14w08a": "1.7.6",
    "14w11b": "1.7.10",
    "14w20a": "1.8",
    "15w14a": "1.8.4",
    "15w31a": "1.8.9",
    "15w49b": "1.9",
    "16w14a": "1.9.3",
    "16w20a": "1.10",
    "16w32a": "1.11",
    "16w50a": "1.11.1",
    "17w06a": "1.12",
    "17w31a": "1.12.1",
    "17w43a": "1.13",
    "18w30a": "1.13.1",
    "18w43a": "1.14",
    "19w34a": "1.15",
    "20w06a": "1.16",
    "20w27a": "1.16.2",
    "20w45a": "1.16.5",
    "21w03a": "1.17",
    "21w37a": "1.18",
    "22w03a": "1.18.2",
    "22w11a": "1.19",
    "22w24a": "1.19.1",
    "22w42a": "1.19.3",
    "23w03a": "1.19.4",
    "23w12a": "1.20",
    "23w31a": "1.20.2",
    "23w40a": "1.20.3",
    "23w51a": "1.20.5",
    "24w18a": "1.21",
    "24w33a": "1.21.2",
    "24w44a": "1.21.4",
    "25w02a": "1.21.5",
    "25w15a": "1.21.6",
    "25w35a": "1.21.9",
    "25w44a": "1.21.11",
    "26w14a": "26.1.2",
};

interface WeeklyKey {
    year: number;
    week: number;
    letter: string;
}

function weeklyKey(id: string): WeeklyKey | null {
    const match = id.match(WEEKLY_SNAPSHOT_RE);
    if (!match) return null;
    return {
        year: Number(match[1]),
        week: Number(match[2]),
        letter: match[3].toLowerCase(),
    };
}

function compareWeekly(a: WeeklyKey, b: WeeklyKey): number {
    if (a.year !== b.year) return a.year - b.year;
    if (a.week !== b.week) return a.week - b.week;
    return a.letter < b.letter ? -1 : a.letter > b.letter ? 1 : 0;
}

export function classifyMcVersion(raw: string): ClassifiedMcVersion {
    const id = String(raw ?? "").trim();
    if (WEEKLY_SNAPSHOT_RE.test(id)) {
        return { raw: id, kind: "snapshot", base: id };
    }
    const drop = id.match(DROP_SNAPSHOT_RE);
    if (drop) {
        // "<drop>-snapshot-N": the base already carries the target release
        return { raw: id, kind: "snapshot", base: drop[1] };
    }
    const preRc = id.match(PRE_RC_RE);
    if (preRc) {
        return {
            raw: id,
            kind: /rc/i.test(preRc[2]) ? "rc" : "pre",
            base: preRc[1],
        };
    }
    if (RELEASE_RE.test(id)) {
        return { raw: id, kind: "release", base: id };
    }
    if (OLD_RE.test(id)) {
        return {
            raw: id,
            kind: /^a/i.test(id) ? "old_alpha" : "old_beta",
            base: "0.0.0",
        };
    }
    return { raw: id, kind: "unknown", base: id };
}

/** the release id whose behaviour this build carries */
export function behaviorVersionOf(raw: string): string {
    const classified = classifyMcVersion(raw);
    if (classified.kind !== "snapshot") return classified.base;
    const key = weeklyKey(classified.raw);
    // drop snapshots and pre-releases already carry their release in `base`
    if (!key) return classified.base;

    // weekly snapshots: take the latest cycle start at or before this one
    let best: { key: WeeklyKey; release: string } | null = null;
    for (const [anchorId, release] of Object.entries(SNAPSHOT_RELEASE_ANCHORS)) {
        const anchorKey = weeklyKey(anchorId);
        if (!anchorKey || compareWeekly(anchorKey, key) > 0) continue;
        if (!best || compareWeekly(anchorKey, best.key) > 0) {
            best = { key: anchorKey, release };
        }
    }
    return best?.release ?? classified.base;
}

// pure version comparison over releases, drops, snapshots and pre-1.0
// builds; snapshots resolve through SNAPSHOT_RELEASE_ANCHORS first
export function mcSatisfies(
    version: string | null | undefined,
    range: { since?: string; until?: string },
): boolean {
    if (!range.since && !range.until) return true;
    if (!version) return false;
    const v = semver.coerce(behaviorVersionOf(version));
    if (!v) return false;
    const since = range.since ? semver.coerce(behaviorVersionOf(range.since)) : null;
    const until = range.until ? semver.coerce(behaviorVersionOf(range.until)) : null;
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

// Paperboard's supported floor. Below this the server's console format,
// server.properties keys and command set diverge too far to manage reliably:
// the picker hides these versions and install/start refuse them.
export const MIN_SUPPORTED_MC_VERSION = "1.12.2";

export function isSupportedMcVersion(version: string | null | undefined): boolean {
    return mcAtLeast(version, MIN_SUPPORTED_MC_VERSION);
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

// Ascending by `at`. Snapshot ids cite minecraft.wiki's Server.properties
// history table and Java Edition release notes.
export const VERSION_OVERRIDES: readonly VersionOverride[] = [
    // 1.13: level-type values lowercased (flattening)
    { at: "1.13", patch: { levelTypeOptions: LEGACY_MID_LEVEL_TYPES } },
    // 1.16: buffet/default_1_1/customized removed from level-type
    { at: "1.16", patch: { levelTypeOptions: LEGACY_LEVEL_TYPES } },
    // Java 16 from 1.17 (21w19a); 1.16.5 stays Java 8
    { at: "1.17", patch: { javaPackage: "java-16" } },
    // 1.18 (21w37a): build range -64..320, modern chunk palette, Java 17
    {
        at: "1.18",
        patch: {
            javaPackage: "java-17",
            mapMinBuildHeight: -64,
            mapPalette: "modern",
        },
    },
    // 1.19 (22w11a): level-type becomes world-preset ids
    {
        at: "1.19",
        patch: {
            levelTypeOptions: PRESET_LEVEL_TYPES,
            supportsWorldPresetLevelType: true,
        },
    },
    // Java 21 from 1.20.5 (24w14a)
    { at: "1.20.5", patch: { javaPackage: "java-21" } },
    // 1.21.9 (25w35a): pvp/allow-nether/spawn-monsters/enable-command-block
    // become gamerules
    {
        at: "1.21.9",
        patch: { propertiesMovedToGamerules: PROPERTIES_MOVED_TO_GAMERULES },
    },
    // 1.21.11 (25w44a): gamerules become namespaced snake_case
    { at: "1.21.11", patch: { gameruleNaming: "namespaced" } },
    // 26.1 (26.1-snapshot-6): dimensions/ + players/ storage, Java 25
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
    if (!semver.coerce(behaviorVersionOf(version))) return null;
    return resolveFacts("vanilla", version).javaPackage;
}

export function levelTypeOptionsFor(
    software: ServerSoftwareType,
    version: string | null | undefined,
): LevelTypeOption[] {
    return resolveFacts(software, version).levelTypeOptions;
}
