// canonical names for actions, triggers, and the panel id. both the daemon
// service and the panel UI import from here so a rename can never silently
// break the other half of the bridge.
//
// Every UI→service call goes through serverBridge.call(ACTION_IDS.*) —
// never the stringly serverBridge.actions.* proxy. A name used by the UI
// that is missing here is a compile error, not a silent debug-log at
// runtime (which is how eight working-looking buttons did nothing).

export const PANEL_ID = "dev.paperboard.gameserver";

export const ACTION_IDS = {
    runCommand: "run-command",
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
    listPlayers: "list-players",
    playerCount: "player-count",
    killConflictingProcess: "kill-conflicting-process",
    resetWorldFiles: "reset-world-files",
    clearActiveIssue: "clear-active-issue",
    updatePanelConfig: "update-panel-config",
    listWorldDirs: "list-world-dirs",
    deleteWorld: "delete-world",
    listInstalledPlugins: "list-installed-plugins",
    deletePlugin: "delete-plugin",
    deletePlayerData: "delete-player-data",
    forgetPlayerData: "forget-player-data",
    queryPlayerStats: "query-player-stats",
    queryOnlinePlayers: "query-online-players",
    queryGamerules: "query-gamerules",
    setGamerule: "set-gamerule",
} as const;

export type ActionId = (typeof ACTION_IDS)[keyof typeof ACTION_IDS];

export const TRIGGER_IDS = {
    chatMessage: "chat-message",
    playerJoined: "player-joined",
    playerLeft: "player-left",
    serverStarted: "server-started",
    serverStopped: "server-stopped",
} as const;

export type TriggerId = (typeof TRIGGER_IDS)[keyof typeof TRIGGER_IDS];
