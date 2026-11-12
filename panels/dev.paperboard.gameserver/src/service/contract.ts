// canonical names for calls, trigger events, and the panel id. both the daemon
// service and the panel UI import from here so a rename can never silently
// break the other half of the bridge.
//
// Every UI→service call goes through serverBridge.call(CALLS.*), never a
// bare string. A name used by the UI that is missing here is a compile
// error, not a silent failure at runtime (which is how eight
// working-looking buttons did nothing).

export const PANEL_ID = "dev.paperboard.gameserver";

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
    deletePlugin: "delete-plugin",
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
