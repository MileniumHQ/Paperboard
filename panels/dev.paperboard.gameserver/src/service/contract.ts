// What the panel's pages and its service agree on: every call a page makes,
// with what it gives and what it gets back, checked on both sides of the
// bridge. The page reaches the service only through the typed client made
// from gameServerContract (lib/api.ts); a name or an input the contract
// doesn't have is a compile error, and the service refuses it too.
//
// The service's state is on it too: the saved servers, as the servers list
// shows them, and each server's own state under its id, which travels one
// server at a time so a busy console never resends the other servers'.
import { defineContract, shape, type CallDefinition, type Infer, type Shape } from "@mileniumhq/paperapi";
import { parseModpackRecord } from "../core/modpack";

export const PANEL_ID = "dev.paperboard.gameserver";

/** Where a picture a page shows comes from; each is fetched only from the hosts its source keeps pictures on. */
export type PictureSource = "modrinth" | "steam-workshop" | "web";

// the Blocks events a server fires, by their block ids
export const TRIGGER_IDS = {
    chatMessage: "chat-message",
    playerJoined: "player-joined",
    playerLeft: "player-left",
    serverStarted: "server-started",
    serverStopped: "server-stopped",
    serverCrashed: "server-crashed",
} as const;

export type TriggerId = (typeof TRIGGER_IDS)[keyof typeof TRIGGER_IDS];

// ─── Shapes the answers share ───────────────────────────────────────────────

const nothing = shape.nothing();
const done = shape.boolean();
const text = shape.text();
const texts = shape.list(shape.text());
// a world's stats/<uuid>.json, summed (core/playerStats)
const PLAYER_STAT_NUMBERS = {
    deaths: shape.number(),
    mobKills: shape.number(),
    playerKills: shape.number(),
    playTimeTicks: shape.number(),
    jumps: shape.number(),
    blocksMined: shape.number(),
    distanceCm: shape.number(),
};
/** a game's options, by option id: each game's own reader checks them */
const options = shape.record(shape.json());
const patch = shape.object({ patch: shape.record(shape.json()) });
const software = shape.oneOf("vanilla", "paper", "fabric", "neoforge", "forge");
const hostSupport = shape.object({ supported: shape.boolean(), reason: shape.optional(shape.text()) });

const automationView = shape.object({
    timeZone: shape.text(),
    canUpdate: shape.boolean(),
    restartAfterCrash: shape.boolean(),
    dailyRestart: shape.nullable(shape.text()),
    autoUpdate: shape.boolean(),
});

const loaderGroup = shape.object({
    label: shape.text(),
    path: shape.text(),
    settings: shape.list(
        shape.object({
            id: shape.text(),
            title: shape.text(),
            description: shape.text(),
            control: shape.oneOf("number", "text", "toggle", "select"),
            options: shape.optional(shape.list(shape.object({ value: shape.text(), label: shape.text() }))),
            min: shape.optional(shape.number()),
            max: shape.optional(shape.number()),
            decimal: shape.optional(shape.boolean()),
            maxLength: shape.optional(shape.number()),
            warning: shape.optional(shape.text()),
            value: shape.text(),
        }),
    ),
    error: shape.optional(shape.text()),
    pending: shape.optional(shape.oneOf(true)),
});
const settingWritten = shape.object({ id: shape.text(), value: shape.text(), path: shape.text() });
const crossplayView = shape.object({
    software,
    geyser: shape.nullable(shape.text()),
    floodgate: shape.nullable(shape.text()),
    groups: shape.list(loaderGroup),
});

const modrinthFile = shape.object({
    url: shape.text(),
    filename: shape.text(),
    size: shape.nullable(shape.number()),
    sha1: shape.text(),
    sha512: shape.text(),
});
export type ModrinthFile = Infer<typeof modrinthFile>;

const modrinthVersion = shape.object({
    id: shape.text(),
    projectId: shape.text(),
    versionNumber: shape.text(),
    name: shape.text(),
    versionType: shape.text(),
    loaders: shape.list(shape.text()),
    gameVersions: shape.list(shape.text()),
    datePublished: shape.text(),
    files: shape.list(modrinthFile),
    /** the file Modrinth marks primary, else the first; null when none is verifiable */
    primary: shape.nullable(modrinthFile),
});
export type ModrinthVersion = Infer<typeof modrinthVersion>;
const modrinthVersions = shape.list(modrinthVersion);

const modpackInstallOutcome = shape.object({
    title: shape.text(),
    versionNumber: shape.text(),
    mcVersion: shape.text(),
    loaderVersion: shape.text(),
    /** whether the server software was switched to the pack's versions */
    switchedServer: shape.boolean(),
    /** pack paths Paperboard keeps as they are (server.properties, the world) */
    kept: shape.list(shape.text()),
    warning: shape.optional(shape.text()),
});
export type ModpackInstallOutcome = Infer<typeof modpackInstallOutcome>;

const uploadOutcome = shape.object({ added: shape.list(shape.text()) });
const stage = shape.object({ stage: shape.text() });

const installedRecord = shape.object({
    projectId: shape.text(),
    slug: shape.text(),
    version: shape.text(),
    title: shape.optional(shape.text()),
    iconUrl: shape.optional(shape.text()),
    source: shape.optional(shape.object({ kind: shape.oneOf("geysermc"), project: shape.text(), platform: shape.text() })),
});

const verifiableFile = shape.object({
    url: shape.text(),
    filename: shape.text(),
    sha1: shape.optional(shape.text()),
    sha512: shape.optional(shape.text()),
});
const resolvedDependency = shape.object({
    key: shape.text(),
    name: shape.text(),
    kind: shape.oneOf("required", "optional", "incompatible", "embedded"),
    versionNumber: shape.text(),
    gameVersions: shape.list(shape.text()),
    projectId: shape.optional(shape.text()),
    versionId: shape.optional(shape.text()),
    file: shape.optional(verifiableFile),
    unresolvableReason: shape.optional(shape.text()),
});
const dependencies = shape.list(resolvedDependency);

const resourcePackSelection = shape.object({
    url: shape.text(),
    sha1: shape.text(),
    source: shape.oneOf("modrinth", "custom"),
    projectId: shape.optional(shape.text()),
    slug: shape.optional(shape.text()),
    title: shape.optional(shape.text()),
    version: shape.optional(shape.text()),
    versionId: shape.optional(shape.text()),
    iconUrl: shape.optional(shape.text()),
});

const mapDimension = shape.oneOf("overworld", "the_nether", "the_end");

const workshopMeta = shape.object({
    attribution: shape.text(),
    source: shape.text(),
    legal: shape.text(),
    disclaimer: shape.text(),
});
const workshopPage = shape.object({
    items: shape.list(
        shape.object({
            id: shape.text(),
            title: shape.text(),
            description: shape.text(),
            previewImageUrl: shape.nullable(shape.text()),
            tags: shape.list(shape.text()),
            authorId: shape.text(),
            subscriptions: shape.nullable(shape.number()),
            favorites: shape.nullable(shape.number()),
            timeUpdated: shape.number(),
            fileSize: shape.number(),
            children: shape.nullable(shape.list(shape.text())),
            workshopUrl: shape.text(),
        }),
    ),
    total: shape.nullable(shape.number()),
    meta: workshopMeta,
});
/** what a change to tModLoader's mods did, and whether the running server needs a restart for it */
const modChange = <T>(result: Shape<T>) => shape.object({ result, restart: shape.boolean() });

const terrariaWorldHeader = shape.object({
    name: shape.text(),
    seed: shape.text(),
    width: shape.number(),
    height: shape.number(),
    gameMode: shape.number(),
    evil: shape.oneOf("corruption", "crimson"),
    hardmode: shape.boolean(),
    bosses: shape.list(shape.text()),
});
const terrariaRelease = shape.object({ version: shape.text(), directory: shape.text(), url: shape.text(), size: shape.number(), sha256: shape.text() });

const rustMapView = shape.object({ size: shape.number(), seed: shape.number(), made: shape.boolean(), blueprints: shape.boolean() });

const sourceModView = shape.object({
    on: shape.boolean(),
    active: shape.boolean(),
    missing: shape.boolean(),
    plugins: shape.list(
        shape.object({
            file: shape.text(),
            title: shape.text(),
            description: shape.text(),
            enabled: shape.boolean(),
            bundled: shape.boolean(),
        }),
    ),
});
const sourceWorkshopMap = shape.object({
    id: shape.text(),
    title: shape.text(),
    previewImageUrl: shape.nullable(shape.text()),
    tags: shape.list(shape.text()),
    subscribers: shape.nullable(shape.number()),
    updated: shape.number(),
});
const sourceWorkshopMaps = shape.list(sourceWorkshopMap);
const sourceMapCycle = shape.object({
    maps: shape.list(shape.text()),
    custom: shape.boolean(),
    file: shape.nullable(shape.text()),
    installed: shape.list(shape.text()),
    workshop: sourceWorkshopMaps,
    workshopHeld: shape.record(shape.text()),
    overriddenBy: shape.nullable(shape.text()),
});
const steamId = shape.object({ steamId: shape.text() });

// ─── The calls ──────────────────────────────────────────────────────────────

/** The saved servers, and the pictures every page shows: no server's game answers these. */
const serversCalls = {
    /** makes a server, as New server does */
    addServer: { input: shape.object({ name: shape.text(), game: shape.text() }), output: shape.object({ id: shape.text() }), unscoped: true },
    renameServer: { input: shape.object({ name: shape.text() }), output: done },
    /** stops the server and forgets it; its folder and backups are kept */
    removeServer: { output: shape.object({ removed: shape.text() }) },
    /** the server's saved settings */
    readServerConfig: { output: options },
    /** sets up a server whose setup failed again */
    retryInitialize: { output: done },
    /** a picture from elsewhere as a data: address: a page never loads an address it was handed (service/pictures.ts) */
    servedPicture: { input: shape.object({ from: shape.oneOf("modrinth", "steam-workshop", "web"), url: shape.text() }), output: text, unscoped: true },
    /** a Steam account's profile picture as a data: address, null for an account with no profile (service/steamAvatars.ts); the account is its 17-digit Steam id, the size 64 px (`medium`, for a list's rows) or 184 px */
    steamAvatar: { input: shape.object({ steamId: shape.text(), size: shape.oneOf("medium", "full") }), output: shape.nullable(text), unscoped: true },
} satisfies Record<string, CallDefinition>;

/** Every game's calls, and Minecraft's own. */
const minecraftCalls = {
    readAutomation: { output: automationView },
    writeAutomation: { input: patch, output: automationView },
    runCommand: { input: shape.object({ command: shape.text() }), output: text },
    /** resolves once the game confirms the world is written */
    saveWorld: { output: done, timeoutMs: null },
    startServer: { output: done },
    stopServer: { output: done },
    restartServer: { output: done },
    loadConfig: { output: done },
    sayChat: { input: shape.object({ message: shape.text() }), output: text },
    listServerFiles: {
        input: shape.object({ path: shape.text() }),
        output: shape.object({
            entries: shape.list(shape.object({ name: shape.text(), path: shape.text(), kind: shape.oneOf("file", "folder") })),
            note: shape.optional(shape.text()),
        }),
    },
    readServerFile: {
        input: shape.object({ path: shape.text() }),
        output: shape.either(
            shape.object({ kind: shape.oneOf("text"), text: shape.text(), version: shape.text() }),
            shape.object({ kind: shape.oneOf("preview"), src: shape.text(), type: shape.text() }),
            shape.object({ kind: shape.oneOf("unavailable"), reason: shape.text() }),
        ),
    },
    writeServerFile: {
        input: shape.object({ path: shape.text(), text: shape.text(), version: shape.optional(shape.text()) }),
        output: shape.object({ version: shape.text(), message: shape.text() }),
    },
    listLogFiles: { output: shape.list(shape.object({ name: shape.text(), size: shape.number(), mtimeMs: shape.number() })) },
    readLogFile: { input: shape.object({ name: shape.text() }), output: shape.object({ name: shape.text(), content: shape.text(), truncated: shape.boolean() }) },
    readGameOptions: { output: options },
    writeGameOptions: { input: patch, output: options },
    killConflictingProcess: { input: shape.object({ port: shape.text() }), output: nothing },
    resetWorldFiles: { output: nothing },
    clearActiveIssue: { output: done },
    retryRecovery: { output: done },
    updatePanelConfig: { input: patch, output: done },

    listWorldDirs: { output: texts },
    listWorlds: {
        output: shape.list(shape.object({ name: shape.text(), active: shape.boolean(), generated: shape.boolean(), hasNether: shape.boolean(), hasEnd: shape.boolean() })),
    },
    setActiveWorld: {
        input: shape.object({ levelName: shape.text(), seed: shape.optional(shape.text()), createOnly: shape.boolean() }),
        output: shape.object({ activated: shape.text(), created: shape.boolean() }),
    },
    deleteWorld: { input: shape.object({ levelName: shape.text() }), output: done },
    /** zipping a big world takes a while */
    exportWorld: { input: shape.object({ levelName: shape.text() }), output: shape.object({ file: shape.text(), bytes: shape.number() }), timeoutMs: null },
    importWorld: { input: shape.object({ file: shape.text(), levelName: shape.text() }), output: shape.object({ name: shape.text(), folders: texts }), timeoutMs: null },
    discardWorldTransfer: { input: shape.object({ file: shape.text() }), output: done },

    /** a jar download plus a Forge or NeoForge installer outlasts 30 s; the install's progress arrives through state */
    installServerVersion: {
        input: shape.object({ software: shape.text(), version: shape.text() }),
        output: shape.object({ software, version: shape.text(), build: shape.nullable(shape.text()), warning: shape.optional(shape.text()) }),
        timeoutMs: null,
    },
    listSoftwareVersions: {
        input: shape.object({ software: shape.text() }),
        output: shape.list(shape.object({ id: shape.text(), type: shape.oneOf("release", "snapshot"), releaseTime: shape.optional(shape.text()), installable: shape.boolean() })),
    },
    readLoaderSettings: {
        output: shape.object({ software, emptyMessage: shape.nullable(shape.text()), groups: shape.list(loaderGroup), missing: texts }),
    },
    writeLoaderSetting: { input: shape.object({ id: shape.text(), value: shape.text() }), output: settingWritten },
    readCrossplay: { output: crossplayView },
    writeCrossplaySetting: { input: shape.object({ id: shape.text(), value: shape.text() }), output: settingWritten },
    prepareCrossplay: { output: crossplayView },

    readServerIcon: { output: shape.nullable(text) },
    setServerIcon: { input: shape.object({ png: shape.text() }), output: text },
    removeServerIcon: { output: done },
    locateAddonConfig: {
        input: shape.object({ filename: shape.text() }),
        output: shape.object({
            name: shape.nullable(shape.text()),
            reveal: shape.nullable(shape.object({ path: shape.text(), kind: shape.oneOf("file", "folder") })),
            message: shape.optional(shape.text()),
        }),
    },

    listMapRegions: {
        output: shape.object({
            levelName: shape.text(),
            dimensions: shape.list(
                shape.object({
                    dimension: mapDimension,
                    regions: shape.list(shape.object({ x: shape.number(), z: shape.number() })),
                    terrain: shape.object({ minX: shape.number(), minZ: shape.number(), maxX: shape.number(), maxZ: shape.number() }),
                }),
            ),
        }),
    },
    renderMapTile: {
        input: shape.object({ dimension: mapDimension, rx: shape.number(), rz: shape.number(), since: shape.optional(shape.number()) }),
        output: shape.nullable(
            shape.object({ dataUrl: shape.nullable(shape.text()), version: shape.number(), dimension: mapDimension, rx: shape.number(), rz: shape.number() }),
        ),
    },

    listInstalledPlugins: {
        output: shape.object({
            plugins: shape.list(
                shape.object({
                    filename: shape.text(),
                    record: shape.optional(installedRecord),
                    uploaded: shape.optional(shape.oneOf(true)),
                    described: shape.optional(shape.object({ name: shape.optional(shape.text()), version: shape.optional(shape.text()), error: shape.optional(shape.text()) })),
                }),
            ),
            warning: shape.optional(shape.text()),
        }),
    },
    recordPluginInstalls: { input: shape.object({ set: shape.record(installedRecord), remove: texts }), output: done },
    previewPluginInstall: {
        input: shape.object({ projectId: shape.text(), title: shape.text(), versionId: shape.text(), includeOptionalKeys: texts }),
        output: shape.object({
            title: shape.text(),
            versionNumber: shape.text(),
            gameVersions: texts,
            matchesServer: shape.boolean(),
            mainFile: shape.nullable(
                shape.object({
                    url: shape.text(),
                    filename: shape.text(),
                    sha1: shape.optional(shape.text()),
                    sha512: shape.optional(shape.text()),
                    versionNumber: shape.text(),
                    gameVersions: texts,
                }),
            ),
            required: dependencies,
            optional: dependencies,
            transitive: dependencies,
            incompatible: dependencies,
            embedded: dependencies,
            failures: texts,
        }),
    },
    installPluginVersion: {
        input: shape.object({
            projectId: shape.text(),
            slug: shape.text(),
            title: shape.optional(shape.text()),
            iconUrl: shape.optional(shape.text()),
            versionId: shape.text(),
            includeOptionalKeys: shape.optional(texts),
        }),
        output: shape.list(shape.object({ filename: shape.text(), versionNumber: shape.text(), title: shape.text(), kind: shape.oneOf("required", "optional", "main") })),
    },
    deletePlugin: { input: shape.object({ filename: shape.text() }), output: done },
    uninstallAllPlugins: { output: shape.number() },

    listDatapacks: {
        output: shape.object({
            world: shape.text(),
            worldExists: shape.boolean(),
            packs: shape.list(
                shape.object({
                    name: shape.text(),
                    kind: shape.oneOf("folder", "zip"),
                    record: shape.optional(
                        shape.object({ projectId: shape.text(), slug: shape.text(), title: shape.text(), version: shape.text(), iconUrl: shape.optional(shape.text()) }),
                    ),
                    uploaded: shape.optional(shape.oneOf(true)),
                }),
            ),
            truncated: shape.boolean(),
        }),
    },
    listDatapackVersions: { input: shape.object({ projectId: shape.text() }), output: modrinthVersions },
    installDatapack: {
        input: shape.object({ projectId: shape.text(), versionId: shape.optional(shape.text()) }),
        output: shape.object({ name: shape.text(), world: shape.text(), version: shape.text() }),
    },
    removeDatapack: { input: shape.object({ name: shape.text() }), output: done },

    readResourcePack: { output: shape.object({ url: shape.text(), sha1: shape.text(), selection: shape.nullable(resourcePackSelection) }) },
    listResourcePackVersions: { input: shape.object({ projectId: shape.text() }), output: modrinthVersions },
    /** a Modrinth pack by its project and version, or a pack at an address */
    selectResourcePack: {
        input: shape.object({ projectId: shape.optional(shape.text()), versionId: shape.optional(shape.text()), url: shape.optional(shape.text()) }),
        output: resourcePackSelection,
    },
    removeResourcePack: { output: done },

    // installing a pack and removing one run for minutes; their progress arrives through the server's state (modpackProgress)
    readModpack: { output: shape.object({ modpack: shape.read(parseModpackRecord) }) },
    listModpackVersions: { input: shape.object({ projectId: shape.text() }), output: modrinthVersions },
    installModpack: { input: shape.object({ projectId: shape.text(), versionId: shape.text() }), output: modpackInstallOutcome, timeoutMs: null },
    removeModpack: { output: shape.object({ removed: shape.number(), forgotten: shape.optional(shape.oneOf(true)) }), timeoutMs: null },

    uploadPlugins: { input: stage, output: uploadOutcome },
    uploadDatapacks: { input: stage, output: uploadOutcome },
    uploadModpack: { input: stage, output: modpackInstallOutcome, timeoutMs: null },
    discardAddonUpload: { input: stage, output: done },

    kickPlayer: { input: shape.object({ player: shape.text(), reason: shape.optional(shape.text()) }), output: done },
    banPlayer: { input: shape.object({ player: shape.text(), reason: shape.optional(shape.text()) }), output: done },
    // uuid names a player on the panel's own roster
    opPlayer: { input: shape.object({ player: shape.text(), uuid: shape.optional(shape.text()) }), output: done },
    deopPlayer: { input: shape.object({ player: shape.text(), uuid: shape.optional(shape.text()) }), output: done },
    whitelistPlayer: { input: shape.object({ player: shape.text(), uuid: shape.optional(shape.text()) }), output: done },
    unwhitelistPlayer: { input: shape.object({ player: shape.text(), uuid: shape.optional(shape.text()) }), output: done },
    pardonPlayer: { input: shape.object({ player: shape.text() }), output: done },
    killPlayer: { input: shape.object({ player: shape.text() }), output: done },
    deletePlayerData: { input: shape.object({ player: shape.text(), uuid: shape.optional(shape.text()) }), output: done },
    getPlayerSkin: {
        input: shape.object({ player: shape.text(), uuid: shape.optional(shape.text()), size: shape.optional(shape.number()) }),
        output: shape.nullable(text),
    },
    // the answers to these three arrive through the server's state
    queryPlayerStats: { input: shape.object({ player: shape.text() }), output: done },
    queryOnlinePlayers: { output: done },
    queryPlayerPositions: { output: done },
    listRoster: {
        output: shape.list(
            shape.object({
                key: shape.text(),
                uuid: shape.nullable(shape.text()),
                name: shape.text(),
                whitelisted: shape.boolean(),
                op: shape.boolean(),
                banned: shape.boolean(),
                banReason: shape.nullable(shape.text()),
                stats: shape.nullable(shape.object(PLAYER_STAT_NUMBERS)),
            }),
        ),
    },
    currentPlayerNames: { input: shape.object({ uuids: texts }), output: shape.record(shape.text()) },
    readBedrockNaming: { output: shape.nullable(shape.object({ prefix: shape.text(), replaceSpaces: shape.boolean() })) },
    listPlayerStats: {
        output: shape.list(
            shape.object({ uuid: shape.text(), name: shape.text(), ...PLAYER_STAT_NUMBERS }),
        ),
    },
    /** asks the running server for every rule its version has; the answers arrive through state */
    queryGamerules: { output: done },
    setGamerule: { input: shape.object({ name: shape.text(), value: shape.text() }), output: done },
} satisfies Record<string, CallDefinition>;

/** The Updates tab of a game downloaded from Steam. */
const steamCalls = {
    steamInfo: { output: shape.object({ host: hostSupport, build: shape.nullable(text), version: shape.nullable(text), downloaded: shape.boolean() }) },
    /** the bytes the server's download from Steam takes here; asks Steam, which can take a while */
    steamSize: { output: shape.number(), timeoutMs: null },
    /** asks Steam, which can take a while */
    steamLatest: { output: shape.object({ installed: shape.nullable(text), latest: shape.text(), updateAvailable: shape.boolean() }), timeoutMs: null },
    /** SteamCMD downloads for minutes; progress arrives through state */
    steamInstall: { output: done, timeoutMs: null },
} satisfies Record<string, CallDefinition>;

/** What Source games answer (Counter-Strike 2, Team Fortress 2, Garry's Mod), each as its game has them. */
const sourceCalls = {
    sourceMetrics: { output: shape.object({ bots: shape.number() }) },
    sourcePlayers: {
        output: shape.object({
            seen: shape.list(
                shape.object({
                    steamId: shape.text(),
                    name: shape.text(),
                    lastSeen: shape.number(),
                    kills: shape.optional(shape.number()),
                    deaths: shape.optional(shape.number()),
                    assists: shape.optional(shape.number()),
                    dominations: shape.optional(shape.number()),
                    playtime: shape.optional(shape.number()),
                }),
            ),
            bans: shape.list(shape.object({ steamId: shape.text(), name: shape.text(), at: shape.number() })),
            online: shape.list(
                shape.object({
                    userId: shape.number(),
                    name: shape.text(),
                    steamId: shape.text(),
                    team: shape.text(),
                    role: shape.optional(shape.text()),
                    since: shape.number(),
                    stats: shape.object({ kills: shape.number(), deaths: shape.number(), assists: shape.number(), dominations: shape.number(), playtime: shape.number() }),
                }),
            ),
            /** SourceMod's admins; null for a game without SourceMod, or with it off */
            admins: shape.nullable(texts),
        }),
    },
    sourceKick: { input: shape.object({ userId: shape.number() }), output: done },
    sourceBan: { input: steamId, output: done },
    sourceUnban: { input: steamId, output: done },
    sourceChangeMap: { input: shape.object({ map: shape.text() }), output: shape.object({ now: shape.boolean() }) },
    sourceMaps: { output: texts },
    sourceMapPictures: { output: shape.object({ source: shape.object({ name: shape.text(), url: shape.text() }), titles: shape.record(shape.text()) }) },
    sourceMapPicture: { input: shape.object({ map: shape.text() }), output: shape.nullable(text) },
    sourceMapCycle: { output: sourceMapCycle },
    /** null hands the rotation back to the game's map cycle file */
    sourceMapCycleSet: { input: shape.object({ maps: shape.nullable(texts) }), output: sourceMapCycle },
    /** setup's last choice: a mode makes its installed maps the rotation, the chosen map first; no mode leaves the rotation to the game */
    sourcePlay: { input: shape.object({ mode: shape.nullable(shape.text()), map: shape.text() }), output: sourceMapCycle },
    sourceWorkshopMaps: { output: sourceWorkshopMaps },
    sourceWorkshopFind: {
        input: shape.object({ query: shape.text() }),
        output: shape.object({
            items: shape.list(
                shape.object({
                    added: shape.boolean(),
                    id: shape.text(),
                    title: shape.text(),
                    previewImageUrl: shape.nullable(shape.text()),
                    tags: shape.list(shape.text()),
                    subscribers: shape.nullable(shape.number()),
                    updated: shape.number(),
                }),
            ),
            hidden: shape.number(),
            meta: workshopMeta,
        }),
    },
    sourceWorkshopAdd: { input: shape.object({ id: shape.text() }), output: sourceWorkshopMaps },
    sourceWorkshopRemove: { input: shape.object({ id: shape.text() }), output: sourceWorkshopMaps },
    sourceSourcemod: { output: sourceModView },
    /** turning SourceMod on downloads it first */
    sourceSourcemodSet: { input: shape.object({ on: shape.boolean() }), output: sourceModView, timeoutMs: null },
    sourcePlugin: { input: shape.object({ file: shape.text(), on: shape.boolean() }), output: sourceModView },
    sourcePluginRemove: { input: shape.object({ file: shape.text() }), output: sourceModView },
    sourcePluginUpload: { input: stage, output: shape.object({ added: texts, view: sourceModView }), timeoutMs: null },
    sourceAdmin: { input: shape.object({ steamId: shape.text(), admin: shape.boolean() }), output: sourceModView },
} satisfies Record<string, CallDefinition>;

const terrariaCalls = {
    terrariaVersions: {
        output: shape.object({
            releases: shape.list(terrariaRelease),
            tmodloaderReleases: shape.list(shape.object({ ...terrariaRelease.fields, terraria: shape.text(), runtime: shape.text() })),
            host: hostSupport,
            hosts: shape.object({ vanilla: hostSupport, tmodloader: hostSupport }),
        }),
    },
    terrariaInstall: { input: shape.object({ software: shape.oneOf("vanilla", "tmodloader"), version: shape.text() }), output: done, timeoutMs: null },
    terrariaWorlds: {
        output: shape.list(
            shape.object({
                name: shape.text(),
                active: shape.boolean(),
                generated: shape.boolean(),
                modified: shape.number(),
                bytes: shape.number(),
                header: shape.nullable(terrariaWorldHeader),
                error: shape.optional(shape.text()),
            }),
        ),
    },
    /** plays a world, or makes a new one with the settings Terraria generates it from */
    terrariaWorld: { input: shape.object({ name: shape.text(), create: shape.boolean(), generation: shape.optional(options) }), output: done },
    terrariaWorldDelete: { input: shape.object({ name: shape.text() }), output: done },
    terrariaWorldInspect: { input: shape.object({ file: shape.text() }), output: shape.object({ header: terrariaWorldHeader, suggestedName: shape.text() }) },
    terrariaWorldImport: { input: shape.object({ file: shape.text(), name: shape.text() }), output: done },
    terrariaWorldDiscard: { input: shape.object({ file: shape.text() }), output: done },
    terrariaMods: {
        output: shape.object({
            mods: shape.list(
                shape.object({
                    file: shape.text(),
                    info: shape.nullable(
                        shape.object({ name: shape.text(), version: shape.text(), builtFor: shape.text(), displayName: shape.text(), references: texts }),
                    ),
                    problem: shape.optional(shape.text()),
                    enabled: shape.boolean(),
                    record: shape.optional(
                        shape.object({
                            workshopId: shape.optional(shape.text()),
                            title: shape.text(),
                            previewImageUrl: shape.optional(shape.nullable(shape.text())),
                            timeUpdated: shape.optional(shape.number()),
                            uploaded: shape.optional(shape.boolean()),
                        }),
                    ),
                }),
            ),
            tmodloader: shape.text(),
        }),
    },
    terrariaModSearch: { input: shape.object({ query: shape.text(), sort: shape.oneOf("relevance", "subscriptions", "updated") }), output: workshopPage },
    terrariaModItems: { input: shape.object({ ids: texts }), output: workshopPage },
    // SteamCMD's first run updates itself, then downloads: minutes, not seconds
    terrariaModInstall: { input: shape.object({ id: shape.text(), dependencies: texts }), output: modChange(texts), timeoutMs: null },
    terrariaModUpdates: { output: modChange(shape.object({ updated: texts, current: shape.number() })), timeoutMs: null },
    terrariaModRemove: { input: shape.object({ file: shape.text() }), output: shape.object({ restart: shape.boolean() }) },
    terrariaModUpload: { input: stage, output: modChange(uploadOutcome), timeoutMs: null },
    terrariaPlayers: {
        output: shape.object({
            seen: shape.list(shape.object({ name: shape.text(), lastSeen: shape.number(), address: shape.optional(shape.text()) })),
            bans: shape.list(shape.object({ name: shape.text(), address: shape.text() })),
        }),
    },
    terrariaKick: { input: shape.object({ name: shape.text() }), output: done },
    terrariaBan: { input: shape.object({ name: shape.text() }), output: done },
    terrariaUnban: { input: shape.object({ name: shape.text() }), output: done },
    terrariaMotd: { input: shape.object({ motd: shape.text() }), output: shape.object({ appliesOnRestart: shape.boolean() }) },
} satisfies Record<string, CallDefinition>;

const palworldUser = shape.object({ userId: shape.text() });
const palworldCalls = {
    palworldMetrics: {
        output: shape.object({
            currentplayernum: shape.number(),
            maxplayernum: shape.number(),
            serverfps: shape.number(),
            serverfpsaverage: shape.number(),
            serverframetime: shape.number(),
            uptime: shape.number(),
            days: shape.number(),
            basecampnum: shape.number(),
        }),
    },
    palworldPlayers: {
        output: shape.object({
            seen: shape.list(shape.object({ userId: shape.text(), name: shape.text(), accountName: shape.text(), level: shape.number(), lastSeen: shape.number() })),
            bans: texts,
            online: shape.list(
                shape.object({
                    name: shape.text(),
                    accountName: shape.text(),
                    playerId: shape.text(),
                    userId: shape.text(),
                    ip: shape.text(),
                    ping: shape.number(),
                    level: shape.number(),
                }),
            ),
        }),
    },
    palworldKick: { input: palworldUser, output: done },
    palworldBan: { input: palworldUser, output: done },
    palworldUnban: { input: palworldUser, output: done },
} satisfies Record<string, CallDefinition>;

const rustCalls = {
    rustMetrics: {
        output: shape.object({
            Hostname: shape.text(),
            MaxPlayers: shape.number(),
            Players: shape.number(),
            Queued: shape.number(),
            Joining: shape.number(),
            EntityCount: shape.number(),
            Uptime: shape.number(),
            Map: shape.text(),
            Framerate: shape.number(),
            Memory: shape.number(),
            Protocol: shape.text(),
        }),
    },
    rustMap: { output: rustMapView },
    rustMapPicture: { output: shape.nullable(text) },
    rustMapDraw: { output: text },
    rustWipe: { input: shape.object({ blueprints: shape.boolean() }), output: shape.object({ ...rustMapView.fields, trashed: shape.boolean() }) },
    rustPlayers: {
        output: shape.object({
            seen: shape.list(shape.object({ steamId: shape.text(), name: shape.text(), lastSeen: shape.number() })),
            bans: shape.list(shape.object({ steamId: shape.text(), name: shape.text(), reason: shape.text() })),
            online: shape.list(shape.object({ steamId: shape.text(), name: shape.text(), ping: shape.number(), connected: shape.number(), health: shape.number() })),
        }),
    },
    rustKick: { input: steamId, output: done },
    rustBan: { input: steamId, output: done },
    rustUnban: { input: steamId, output: done },
} satisfies Record<string, CallDefinition>;

// ─── The state the pages mirror ─────────────────────────────────────────────

const serverStatus = shape.oneOf("offline", "starting", "online", "stopping", "restarting");

/** A server's own state, as its pages and widgets show it. */
export const serverStateShape = shape.object({
    serverStatus,
    /** the console, as the game printed it and the service said, the last MAX_BUFFERED_ENTRIES lines */
    serverEntries: shape.list(
        shape.object({
            id: shape.optional(shape.either(shape.text(), shape.number())),
            type: shape.optional(shape.oneOf("command", "output", "error", "warn", "info", "return")),
            content: shape.text(),
            timestamp: shape.optional(shape.either(shape.text(), shape.number())),
        }),
    ),
    chatMessages: shape.list(
        shape.object({
            id: shape.text(),
            /** the line as the game printed it */
            text: shape.text(),
            timestamp: shape.text(),
            /** the player a message, join or leave is about */
            sender: shape.optional(shape.text()),
            /** what was said, without the sender */
            content: shape.optional(shape.text()),
            /** set for a join, a leave or a message from the server console; unset for player chat */
            event: shape.optional(shape.oneOf("join", "leave", "server")),
        }),
    ),
    localIp: shape.text(),
    serverPort: shape.text(),
    /** ports that were taken, so the running server uses others until it stops; its settings keep the chosen ones */
    portMoves: shape.list(shape.object({ label: shape.text(), from: shape.number(), to: shape.number(), primary: shape.boolean() })),
    serverMotd: shape.text(),
    serverSoftware: shape.text(),
    gameSettings: shape.record(shape.json()),
    serverVersion: shape.text(),
    ramAllocation: shape.number(),
    onlinePlayers: texts,
    /** the running server's player cap, from its `list` answer; null while offline or until it has answered */
    maxPlayers: shape.nullable(shape.number()),
    /**
     * when the server came online, in milliseconds since 1970; null while it
     * is not online. Kept with the console history, so it survives a restart
     * of Paperboard that left the server running
     */
    onlineSince: shape.nullable(shape.number()),
    /** the map the running server plays, for games that change maps while running; null while offline or for games without maps */
    serverLevel: shape.nullable(shape.text()),
    seenPlayers: texts,
    playerStats: shape.record(
        shape.object({ health: shape.optional(shape.number()), food: shape.optional(shape.number()), xpLevel: shape.optional(shape.number()), xpProgress: shape.optional(shape.number()) }),
    ),
    /** latest known x/y/z and dimension per player key, read from the running server for the map; empty when offline */
    playerPositions: shape.record(shape.object({ x: shape.number(), y: shape.number(), z: shape.number(), dimension: shape.text() })),
    /** live gamerule values read from the running server (and optimistic offline edits) */
    gamerules: shape.record(shape.text()),
    /**
     * live download progress of an install; null when none is running.
     * "preparing" is work with no measure yet: a downloader starting, or
     * making room for the files before it downloads them
     */
    installProgress: shape.nullable(
        shape.object({
            stage: shape.oneOf("preparing", "downloading", "verifying", "installing", "completed", "error"),
            percent: shape.number(),
            /** how much of how much, when the download says */
            bytes: shape.optional(shape.object({ done: shape.number(), total: shape.number() })),
        }),
    ),
    /** live progress of a modpack install, counting files while downloading; null when none has run */
    modpackProgress: shape.nullable(
        shape.object({
            stage: shape.oneOf("preparing", "downloading", "installing-server", "placing", "completed", "error"),
            done: shape.number(),
            total: shape.number(),
        }),
    ),
    activeIssue: shape.nullable(
        shape.object({
            id: shape.text(),
            title: shape.text(),
            description: shape.text(),
            variant: shape.optional(shape.oneOf("danger", "warning", "brand")),
            actions: shape.list(
                shape.object({
                    label: shape.text(),
                    variant: shape.optional(shape.oneOf("danger", "warning", "brand", "primary")),
                    icon: shape.optional(shape.text()),
                    /** the repair, then a start once the failed one has ended */
                    actionKey: shape.oneOf("killPortAndRetry", "acceptEula"),
                }),
            ),
        }),
    ),
    /** why an interrupted install or modpack change could not be settled; starting and installing refuse while set. null when settled */
    recoveryBlock: shape.nullable(shape.text()),
    /** why the server could not be set up when the service started or it was made; every call but setting it up again refuses while set */
    initFailure: shape.nullable(shape.text()),
});

/** A saved server as the servers list, Home's widgets and the server's own page show it. */
const serverSummary = shape.object({
    id: shape.text(),
    name: shape.text(),
    game: shape.text(),
    directory: shape.text(),
    createdAt: shape.number(),
    configured: shape.boolean(),
    icon: shape.nullable(shape.text()),
    state: shape.object({
        serverStatus,
        serverSoftware: shape.text(),
        serverVersion: shape.text(),
        serverPort: shape.text(),
        recoveryBlock: shape.nullable(shape.text()),
        initFailure: shape.nullable(shape.text()),
        maxPlayers: shape.nullable(shape.number()),
        playerCount: shape.number(),
    }),
});
export type ServerSummary = Infer<typeof serverSummary>;

/**
 * Everything a page asks the service, and the state it mirrors. Every call
 * is about the server the page is open on, which its client is made with,
 * but making a server and the pictures a page shows, which are no one
 * server's: the servers list makes its client without a server, and has
 * only those.
 */
export const gameServerContract = defineContract(PANEL_ID, {
    scope: { server: shape.text() },
    calls: { ...serversCalls, ...minecraftCalls, ...steamCalls, ...sourceCalls, ...terrariaCalls, ...palworldCalls, ...rustCalls },
    state: {
        shape: shape.object({
            servers: shape.list(serverSummary),
            /** why the saved servers could not be read; every call refuses while set */
            serversError: shape.nullable(shape.text()),
            /** the server a widget from before several servers shows */
            legacyServer: shape.nullable(shape.text()),
        }),
        initial: { servers: [], serversError: null, legacyServer: null },
    },
    keyed: { server: serverStateShape },
});

export type CallName = keyof typeof gameServerContract.calls;
/** The calls about the saved servers, which no game answers. */
export const SERVERS_CALLS = Object.keys(serversCalls) as (keyof typeof serversCalls)[];
/** Every game's calls, and Minecraft's own: what a Minecraft server answers. */
export const MINECRAFT_CALLS = Object.keys(minecraftCalls) as (keyof typeof minecraftCalls)[];
