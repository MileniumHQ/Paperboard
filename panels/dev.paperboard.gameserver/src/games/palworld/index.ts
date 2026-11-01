import type { GameDefinition, GameOption, OptionSection } from "../types";
import { ACTION_IDS as A } from "../../service/contract";
import { gameArt } from "../art";
import { hostRoutes } from "../host";
import { VISUAL_CPP_X64 } from "../windowsRuntime";
import type { IniType } from "./ini";

/** Steam's id for the Palworld Dedicated Server; SteamCMD downloads it anonymously. */
export const PALWORLD_APP_ID = 2394010;

/** An option and the PalWorldSettings.ini key that stores it; options without one live in the panel's settings or the vault. */
export type PalworldOption = GameOption & { ini?: { key: string; type: IniType } };

const ini = (key: string, type: IniType) => ({ ini: { key, type } });
const balance: OptionSection = { title: "Game balance", description: "Multipliers on Palworld's normal rates. 1 is the game's default." };
const rate = (key: string, label: string, max = 5, min = 0.1): PalworldOption => ({ id: key, label, kind: "number", min, max, step: 0.1, default: 1, restartRequired: true, section: balance, ...ini(key, "float") });
const advanced = { tab: "advanced" } as const;

export const options: readonly PalworldOption[] = [
    { id: "ServerName", label: "Server name", kind: "text", maxLength: 64, default: "Default Palworld Server", restartRequired: true, ...ini("ServerName", "string") },
    { id: "ServerDescription", label: "Description", kind: "text", maxLength: 256, default: "", restartRequired: true, scope: "overview", ...ini("ServerDescription", "string") },
    { id: "password", label: "Join password", kind: "secret", restartRequired: true },
    { id: "ServerPlayerMaxNum", label: "Maximum players", kind: "number", min: 1, max: 32, default: 32, restartRequired: true, ...ini("ServerPlayerMaxNum", "int") },
    { id: "port", label: "Port", description: "The UDP port players join on.", kind: "number", min: 1, max: 65535, default: 8211, restartRequired: true },
    { id: "community", label: "Community server", description: "Lists the server in Palworld's community server browser. Players on the server's own network may not reach it from the list.", kind: "boolean", default: false, restartRequired: true },
    {
        id: "DeathPenalty", label: "Death penalty", description: "What a player drops when they die.", kind: "select", default: "Item", restartRequired: true, ...ini("DeathPenalty", "enum"),
        choices: [{ value: "None", label: "Nothing" }, { value: "Item", label: "Items, not equipment" }, { value: "ItemAndEquipment", label: "Items and equipment" }, { value: "All", label: "Items, equipment and Pals" }],
    },
    { id: "bIsPvP", label: "PvP", description: "Players can fight each other.", kind: "boolean", default: false, restartRequired: true, ...ini("bIsPvP", "bool") },
    { id: "bEnablePlayerToPlayerDamage", label: "Player damage", description: "Players hurt each other.", kind: "boolean", default: false, restartRequired: true, ...ini("bEnablePlayerToPlayerDamage", "bool") },
    { id: "bEnableFriendlyFire", label: "Friendly fire", description: "Guild members hurt each other.", kind: "boolean", default: false, restartRequired: true, ...ini("bEnableFriendlyFire", "bool") },
    { id: "bHardcore", label: "Hardcore", description: "Players can't respawn after dying.", kind: "boolean", default: false, restartRequired: true, ...ini("bHardcore", "bool") },
    { id: "bPalLost", label: "Lose Pals on death", description: "Pals are lost for good when they die.", kind: "boolean", default: false, restartRequired: true, ...ini("bPalLost", "bool") },
    { id: "bEnableInvaderEnemy", label: "Raids", description: "Enemies attack bases.", kind: "boolean", default: true, restartRequired: true, ...ini("bEnableInvaderEnemy", "bool") },
    { id: "bEnableFastTravel", label: "Fast travel", kind: "boolean", default: true, restartRequired: true, ...ini("bEnableFastTravel", "bool") },
    { id: "bIsStartLocationSelectByMap", label: "Choose start location", description: "New players pick where they start on the map.", kind: "boolean", default: false, restartRequired: true, ...ini("bIsStartLocationSelectByMap", "bool") },
    { id: "bShowPlayerList", label: "Player list", description: "Players see who is online in the menu.", kind: "boolean", default: false, restartRequired: true, ...ini("bShowPlayerList", "bool") },
    { id: "bIsShowJoinLeftMessage", label: "Join and leave messages", description: "Players see a message when someone joins or leaves.", kind: "boolean", default: true, restartRequired: true, ...ini("bIsShowJoinLeftMessage", "bool") },
    { id: "bEnableVoiceChat", label: "Voice chat", kind: "boolean", default: false, restartRequired: true, ...ini("bEnableVoiceChat", "bool") },
    rate("ExpRate", "Experience", 20),
    rate("PalCaptureRate", "Capture rate", 2, 0.5),
    rate("PalSpawnNumRate", "Pal spawns", 3, 0.5),
    rate("DayTimeSpeedRate", "Day speed"),
    rate("NightTimeSpeedRate", "Night speed"),
    rate("PalDamageRateAttack", "Damage by Pals"),
    rate("PalDamageRateDefense", "Damage to Pals"),
    rate("PlayerDamageRateAttack", "Damage by players"),
    rate("PlayerDamageRateDefense", "Damage to players"),
    rate("PlayerStomachDecreaceRate", "Player hunger"),
    rate("PlayerStaminaDecreaceRate", "Player stamina use"),
    rate("PalStomachDecreaceRate", "Pal hunger"),
    rate("PalStaminaDecreaceRate", "Pal stamina use"),
    rate("WorkSpeedRate", "Work speed"),
    rate("CollectionDropRate", "Gathered items", 3, 0.5),
    rate("EnemyDropItemRate", "Enemy drops", 3, 0.5),
    rate("PalEggDefaultHatchingTime", "Egg hatching hours", 240, 0),
    { id: "adminPassword", label: "Admin password", description: "Typing /AdminPassword with it in the game's chat gives a player admin commands. Paperboard manages the server through it, so it makes a random one when none is set.", kind: "secret", restartRequired: true, ...advanced },
    { id: "BaseCampMaxNumInGuild", label: "Bases per guild", kind: "number", min: 1, max: 10, default: 4, restartRequired: true, ...advanced, ...ini("BaseCampMaxNumInGuild", "int") },
    { id: "BaseCampWorkerMaxNum", label: "Pals per base", description: "More working Pals load the server more.", kind: "number", min: 1, max: 50, default: 15, restartRequired: true, ...advanced, ...ini("BaseCampWorkerMaxNum", "int") },
    { id: "GuildPlayerMaxNum", label: "Players per guild", kind: "number", min: 1, max: 100, default: 20, restartRequired: true, ...advanced, ...ini("GuildPlayerMaxNum", "int") },
    { id: "AutoSaveSpan", label: "Autosave seconds", description: "How often the world saves itself.", kind: "number", min: 30, max: 3600, default: 30, restartRequired: true, ...advanced, ...ini("AutoSaveSpan", "float") },
    { id: "bIsUseBackupSaveData", label: "World backups", description: "Palworld keeps its own copies of the world as it saves. Turning this off saves disk space.", kind: "boolean", default: true, restartRequired: true, ...advanced, ...ini("bIsUseBackupSaveData", "bool") },
    { id: "DropItemMaxNum", label: "Dropped items", description: "Items on the ground at once across the world.", kind: "number", min: 100, max: 10000, default: 3000, restartRequired: true, ...advanced, ...ini("DropItemMaxNum", "int") },
    { id: "MaxBuildingLimitNum", label: "Buildings per player", description: "0 places no limit.", kind: "number", min: 0, max: 100000, default: 0, restartRequired: true, ...advanced, ...ini("MaxBuildingLimitNum", "int") },
    { id: "ChatPostLimitPerMinute", label: "Chat messages per minute", kind: "number", min: 1, max: 600, default: 30, restartRequired: true, ...advanced, ...ini("ChatPostLimitPerMinute", "int") },
    { id: "SupplyDropSpan", label: "Supply drop minutes", description: "How often meteorites and supply drops land.", kind: "number", min: 1, max: 1440, default: 180, restartRequired: true, ...advanced, ...ini("SupplyDropSpan", "int") },
    { id: "bAllowClientMod", label: "Modded players", description: "Players with mods installed may join.", kind: "boolean", default: true, restartRequired: true, ...advanced, ...ini("bAllowClientMod", "bool") },
    { id: "bUseAuth", label: "Verify players", description: "Checks each player with Palworld's account service.", kind: "boolean", default: true, restartRequired: true, ...advanced, ...ini("bUseAuth", "bool") },
];

export const palworld: GameDefinition = {
    id: "palworld", name: "Palworld", icon: "pets", art: gameArt("palworld"),
    softwareLabel: ({ version }) => (version ? `Palworld ${version}` : "Palworld"),
    hostSupport: hostRoutes("Palworld dedicated server", { os: ["linux", "win32"], arch: ["x64"] }),
    describe() {
        return {
            options, optionsWhileRunning: "next-start", backupWhileRunning: "offline",
            // Palworld reads no console input; Paperboard reaches it over its REST API
            control: { kind: "broadcast" }, widgets: ["status"],
            packages: [{ id: "steamcmd", purpose: "Downloads and updates the Palworld dedicated server from Steam" }, VISUAL_CPP_X64.package],
            actions: [A.startServer, A.stopServer, A.restartServer, A.loadConfig, A.sayChat, A.saveWorld, A.listServerFiles, A.readServerFile, A.writeServerFile, A.listLogFiles, A.readLogFile, A.readGameOptions, A.writeGameOptions, "palworld-install", "palworld-info", "palworld-metrics", "palworld-players", "palworld-kick", "palworld-ban", "palworld-unban", "backup-server"],
            tabs: [
                { id: "overview", label: "Overview", icon: "dashboard", owner: "game", variant: "fill" },
                { id: "chat", label: "Chat", icon: "chat", group: "Play", owner: "game", variant: "fill" },
                { id: "players", label: "Players", icon: "group", group: "Play", owner: "game", variant: "fill", width: "full" },
                { id: "versions", label: "Updates", icon: "update", group: "Software", owner: "game" },
                { id: "options", label: "Options", icon: "tune", group: "Server", owner: "shared" },
                { id: "files", label: "Files", icon: "folder", group: "Server", owner: "shared", variant: "fill" },
                { id: "logs", label: "Logs", icon: "description", group: "Server", owner: "shared", variant: "fill" },
                { id: "backups", label: "Backups", icon: "backup", group: "Server", owner: "shared" },
                { id: "advanced", label: "Advanced", icon: "settings", group: "Server", owner: "shared" },
            ],
        };
    },
};
