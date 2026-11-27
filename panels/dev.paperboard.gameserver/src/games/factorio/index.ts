import type { GameDefinition, GameOption, OptionSection } from "../types";
import { gameArt } from "../art";
import { AUTOMATION_CALLS, AUTOMATION_TAB } from "../automation";
import { hostRoutes } from "../host";

export const FACTORIO_DEFAULT_PORT = 34197;

/** An option, and the key of server-settings.json that carries it, when one does. */
export type FactorioOption = GameOption & { setting?: string };

const listing: OptionSection = {
    title: "Server list",
    description: "Where players find the server in the game's multiplayer menu. A direct connection to its address always works.",
};
const gameplay: OptionSection = { title: "Gameplay" };
const advanced = { tab: "advanced" } as const;

/** The game's own map presets (data/base/prototypes/map-gen-presets.lua), with its English names. */
export const PRESETS = [
    { value: "default", label: "Default" },
    { value: "rich-resources", label: "Rich resources" },
    { value: "marathon", label: "Marathon" },
    { value: "death-world", label: "Death world" },
    { value: "death-world-marathon", label: "Death world marathon" },
    { value: "rail-world", label: "Rail world" },
    { value: "ribbon-world", label: "Ribbon world" },
    { value: "lakes", label: "Lakes" },
    { value: "island", label: "Island" },
] as const;

export const options: readonly FactorioOption[] = [
    { id: "name", label: "Server name", description: "Shown in the game's server list.", kind: "text", maxLength: 50, default: "Factorio", restartRequired: true, setting: "name" },
    { id: "description", label: "Description", description: "Shown with the name in the server list.", kind: "text", maxLength: 500, default: "", restartRequired: true, setting: "description" },
    { id: "password", label: "Join password", kind: "secret", restartRequired: true },
    { id: "port", label: "Port", description: "The UDP port players join on.", kind: "number", min: 1024, max: 65535, default: FACTORIO_DEFAULT_PORT, restartRequired: true },
    { id: "maxPlayers", label: "Maximum players", description: "0 for no limit. Admins can join a full server.", kind: "number", min: 0, max: 65535, default: 0, restartRequired: true, setting: "max_players" },
    { id: "verifyUsers", label: "Verify players", description: "Only players signed in to a factorio.com account can join, as the game sets it.", kind: "boolean", default: true, restartRequired: true, setting: "require_user_verification" },
    { id: "whitelist", label: "Whitelist", description: "Only players on the whitelist can join. Add them in Players.", kind: "boolean", default: false, restartRequired: true },
    { id: "lan", label: "Show on the local network", kind: "boolean", default: true, restartRequired: true, section: listing },
    { id: "public", label: "List publicly", description: "Lists the server in the game's public server list. That takes a factorio.com account's username and token.", kind: "boolean", default: false, restartRequired: true, section: listing },
    { id: "username", label: "factorio.com username", kind: "text", maxLength: 100, default: "", restartRequired: true, section: listing, setting: "username" },
    { id: "token", label: "factorio.com token", description: "From your profile on factorio.com. It is kept in Paperboard's vault.", kind: "secret", noun: "token", restartRequired: true, section: listing },
    {
        id: "allowCommands", label: "Lua commands", description: "Who can run Lua in the game's console. Running it turns achievements off for the map.", kind: "select",
        choices: [{ value: "admins-only", label: "Admins" }, { value: "true", label: "Everyone" }, { value: "false", label: "No one" }],
        default: "admins-only", restartRequired: true, section: gameplay, setting: "allow_commands",
    },
    { id: "autoPause", label: "Pause when empty", description: "The map stops while no one is on.", kind: "boolean", default: true, restartRequired: true, section: gameplay, setting: "auto_pause" },
    { id: "autoPauseConnect", label: "Pause while someone joins", kind: "boolean", default: false, restartRequired: true, section: gameplay, setting: "auto_pause_when_players_connect" },
    { id: "onlyAdminsPause", label: "Only admins can pause", kind: "boolean", default: true, restartRequired: true, section: gameplay, setting: "only_admins_can_pause_the_game" },
    { id: "afkKick", label: "Kick idle players", description: "Minutes a player can do nothing before they are kicked; 0 never kicks.", kind: "number", min: 0, max: 1440, default: 0, restartRequired: true, section: gameplay, setting: "afk_autokick_interval" },
    { id: "autosaveInterval", label: "Autosave minutes", description: "How often the map saves itself; 0 turns autosaves off. It also saves as the server stops.", kind: "number", min: 0, max: 1440, default: 10, restartRequired: true, setting: "autosave_interval", ...advanced },
    { id: "autosaveSlots", label: "Autosaves kept", description: "Autosaves take turns in this many files beside the maps.", kind: "number", min: 1, max: 100, default: 5, restartRequired: true, setting: "autosave_slots", ...advanced },
    { id: "returningPlayers", label: "Returning players join a full server", kind: "boolean", default: false, restartRequired: true, setting: "ignore_player_limit_for_returning_players", ...advanced },
    { id: "uploadSlots", label: "Upload slots", description: "How many players can download the map at once; 0 for no limit.", kind: "number", min: 0, max: 100, default: 5, restartRequired: true, setting: "max_upload_slots", ...advanced },
    { id: "uploadSpeed", label: "Upload speed limit", description: "Kilobytes a second for map downloads; 0 for no limit.", kind: "number", min: 0, max: 1_000_000, default: 0, restartRequired: true, setting: "max_upload_in_kilobytes_per_second", ...advanced },
    { id: "preset", label: "Map preset", description: "The game's own presets, as its new game menu offers them.", kind: "select", choices: PRESETS, default: "default", restartRequired: true, scope: "world" },
    { id: "seed", label: "Seed", description: "Leave empty for a random map.", kind: "text", maxLength: 10, default: "", restartRequired: true, scope: "world" },
    { id: "spaceAge", label: "Space Age", description: "Makes the map with the Space Age expansion, which every player then needs to join. The map keeps it.", kind: "boolean", default: true, restartRequired: true, scope: "world" },
];

/** The options a new map is made with, asked for in New World rather than Options. */
export const MAP_GENERATION: readonly string[] = options.filter((o) => o.scope === "world").map((o) => o.id);

export const factorio: GameDefinition = {
    id: "factorio", name: "Factorio", icon: "factory", art: gameArt("factorio"),
    softwareLabel: ({ version }) => (version ? `Factorio ${version}` : "Factorio"),
    // Wube publishes the headless server for Linux only, for x64 and arm64; the arm64 build hasn't been run here
    hostSupport: (host, game) => {
        if (host.os === "linux" && host.arch === "arm64") return { supported: false, reason: "Paperboard hasn't been tested with Factorio's server for ARM computers yet. Run it on an x64 Linux computer." };
        return hostRoutes("Factorio headless server", { os: ["linux"], arch: ["x64"] })(host, game);
    },
    describe() {
        return {
            options, optionsWhileRunning: "locked", backupWhileRunning: "offline", control: { kind: "rcon" }, widgets: ["status", "console"],
            packages: [],
            calls: [
                "startServer", "stopServer", "restartServer", "runCommand", "loadConfig", "sayChat", "saveWorld",
                "listServerFiles", "readServerFile", "writeServerFile", "listLogFiles", "readLogFile", "readGameOptions", "writeGameOptions",
                "factorioRelease", "factorioInstall", "factorioStatus",
                "factorioWorlds", "factorioWorld", "factorioWorldDelete", "factorioWorldInspect", "factorioWorldImport", "factorioWorldDiscard",
                "factorioPlayers", "factorioKick", "factorioBan", "factorioUnban", "factorioList",
                ...AUTOMATION_CALLS,
            ],
            tabs: [
                { id: "overview", label: "Overview", icon: "dashboard", owner: "game", variant: "fill", compactVariant: "page" },
                { id: "chat", label: "Chat", icon: "chat", group: "Play", owner: "game", variant: "fill" },
                { id: "players", label: "Players", icon: "group", group: "Play", owner: "game", variant: "fill", width: "full" },
                { id: "worlds", label: "Worlds", icon: "public", group: "World", owner: "game" },
                { id: "versions", label: "Versions", icon: "deployed_code", group: "Software", owner: "game" },
                { id: "options", label: "Options", icon: "tune", group: "Server", owner: "shared" },
                { id: "files", label: "Files", icon: "folder", group: "Server", owner: "shared", variant: "fill" },
                { id: "logs", label: "Logs", icon: "description", group: "Server", owner: "shared", variant: "fill" },
                { id: "backups", label: "Backups", icon: "backup", group: "Server", owner: "shared" },
                AUTOMATION_TAB,
                { id: "advanced", label: "Advanced", icon: "settings", group: "Server", owner: "shared" },
            ],
        };
    },
};
