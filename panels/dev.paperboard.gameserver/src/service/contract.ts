// canonical names for calls, trigger events, and the panel id. both the daemon
// service and the panel UI import from here so a rename can never silently
// break the other half of the bridge.
//
// The calls moved onto the panel's contract (gameServerContract) are typed
// on both sides and checked before their handler runs; the rest still go
// through serverBridge.call(CALLS.*) until they move too.
import { defineContract, shape, type Infer } from "@mileniumhq/paperapi";
import { parseModpackRecord } from "../core/modpack";

export const PANEL_ID = "dev.paperboard.gameserver";

/** A call about a server that its game does not answer: the panel's own, made for any game's server. */
export const SETUP_CALLS = {
    retryInitialize: "retry-initialize",
} as const;

/**
 * The panel's call for a picture a page shows from elsewhere: a page never
 * loads an address it was handed, the service fetches it and answers with a
 * data: address (service/pictures.ts).
 */
export const PICTURE_CALL = "served-picture";

/** Where such a picture comes from; each is fetched only from the hosts its source keeps pictures on. */
export type PictureSource = "modrinth" | "steam-workshop" | "web";

export const CALLS = {
    runCommand: "run-command",
    saveWorld: "save-world",
    readGameOptions: "read-game-options",
    writeGameOptions: "write-game-options",
    readAutomation: "read-automation",
    writeAutomation: "write-automation",
    startServer: "start-server",
    stopServer: "stop-server",
    restartServer: "restart-server",
    loadConfig: "load-config",
    sayChat: "say-chat",
    kickPlayer: "kick-player",
    banPlayer: "ban-player",
    opPlayer: "op-player",
    deopPlayer: "deop-player",
    whitelistPlayer: "whitelist-player",
    unwhitelistPlayer: "unwhitelist-player",
    pardonPlayer: "pardon-player",
    killPlayer: "kill-player",
    killConflictingProcess: "kill-conflicting-process",
    resetWorldFiles: "reset-world-files",
    clearActiveIssue: "clear-active-issue",
    retryRecovery: "retry-recovery",
    updatePanelConfig: "update-panel-config",
    listWorldDirs: "list-world-dirs",
    listWorlds: "list-worlds",
    setActiveWorld: "set-active-world",
    installServerVersion: "install-server-version",
    listSoftwareVersions: "list-software-versions",
    readLoaderSettings: "read-loader-settings",
    writeLoaderSetting: "write-loader-setting",
    readCrossplay: "read-crossplay",
    writeCrossplaySetting: "write-crossplay-setting",
    prepareCrossplay: "prepare-crossplay",
    listServerFiles: "list-server-files",
    readServerFile: "read-server-file",
    readServerIcon: "read-server-icon",
    setServerIcon: "set-server-icon",
    removeServerIcon: "remove-server-icon",
    writeServerFile: "write-server-file",
    locateAddonConfig: "locate-addon-config",
    deleteWorld: "delete-world",
    exportWorld: "export-world",
    importWorld: "import-world",
    discardWorldTransfer: "discard-world-transfer",
    listMapRegions: "list-map-regions",
    renderMapTile: "render-map-tile",
    listInstalledPlugins: "list-installed-plugins",
    previewPluginInstall: "preview-plugin-install",
    installPluginVersion: "install-plugin-version",
    deletePlugin: "delete-plugin",
    recordPluginInstalls: "record-plugin-installs",
    uninstallAllPlugins: "uninstall-all-plugins",
    listDatapacks: "list-datapacks",
    listDatapackVersions: "list-datapack-versions",
    installDatapack: "install-datapack",
    removeDatapack: "remove-datapack",
    readResourcePack: "read-resource-pack",
    listResourcePackVersions: "list-resource-pack-versions",
    selectResourcePack: "select-resource-pack",
    removeResourcePack: "remove-resource-pack",
    readModpack: "read-modpack",
    listModpackVersions: "list-modpack-versions",
    installModpack: "install-modpack",
    removeModpack: "remove-modpack",
    uploadPlugins: "upload-plugins",
    uploadDatapacks: "upload-datapacks",
    uploadModpack: "upload-modpack",
    discardAddonUpload: "discard-addon-upload",
    deletePlayerData: "delete-player-data",
    getPlayerSkin: "get-player-skin",
    forgetPlayerData: "forget-player-data",
    queryPlayerStats: "query-player-stats",
    queryPlayerPositions: "query-player-positions",
    listPlayerStats: "list-player-stats",
    listRoster: "list-roster",
    currentPlayerNames: "current-player-names",
    readBedrockNaming: "read-bedrock-naming",
    listLogFiles: "list-log-files",
    readLogFile: "read-log-file",
    queryOnlinePlayers: "query-online-players",
    queryGamerules: "query-gamerules",
    setGamerule: "set-gamerule",
} as const;

export type CallName = (typeof CALLS)[keyof typeof CALLS];

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

/**
 * The page's calls that are on the contract: each is about the server the
 * page is open on, which its client is made with. Installing a pack and
 * removing one run for minutes; their progress arrives through the server's
 * state (modpackProgress).
 */
export const gameServerContract = defineContract(PANEL_ID, {
    scope: { server: shape.text() },
    calls: {
        readModpack: { output: shape.object({ modpack: shape.read(parseModpackRecord) }) },
        listModpackVersions: { input: shape.object({ projectId: shape.text() }), output: shape.list(modrinthVersion) },
        installModpack: { input: shape.object({ projectId: shape.text(), versionId: shape.text() }), output: modpackInstallOutcome, timeoutMs: null },
        removeModpack: { output: shape.object({ removed: shape.number(), forgotten: shape.optional(shape.oneOf(true)) }), timeoutMs: null },
    },
});
