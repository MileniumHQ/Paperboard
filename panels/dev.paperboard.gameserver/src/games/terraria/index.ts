import type { GameDefinition, GameOption, OptionSection } from "../types";
import { ACTION_IDS as A } from "../../service/contract";
import { gameArt } from "../art";
import { softwareName, terrariaSoftware, tmodloaderReleases } from "./catalog";

export const options: readonly GameOption[] = [
    { id: "maxplayers", label: "Maximum players", kind: "number", min: 1, max: 255, default: 8, restartRequired: true },
    { id: "password", label: "Join password", kind: "secret", restartRequired: true },
    { id: "port", label: "Port", description: "The TCP port players join on.", kind: "number", min: 1, max: 65535, default: 7777, restartRequired: true },
    { id: "autocreate", label: "World size", kind: "select", choices: [{ value: "1", label: "Small" }, { value: "2", label: "Medium" }, { value: "3", label: "Large" }], default: "1", restartRequired: true, scope: "world" },
    { id: "difficulty", label: "Difficulty", kind: "select", choices: [{ value: "0", label: "Classic" }, { value: "1", label: "Expert" }, { value: "2", label: "Master" }, { value: "3", label: "Journey" }], default: "0", restartRequired: true, scope: "world" },
    { id: "seed", label: "Seed", description: "Leave empty for a random world.", kind: "text", default: "", restartRequired: true, scope: "world" },
    { id: "motd", label: "Message of the day", kind: "text", default: "", restartRequired: false, scope: "overview" },
    { id: "secure", label: "Additional cheat protection", kind: "boolean", default: true, restartRequired: true },
    ...journeyPermissions(),
];
function journeyPermissions(): GameOption[] {
    const section: OptionSection = { title: "Journey powers", description: "Who may use each power in a Journey world. The host is a player joining from the computer the server runs on." };
    // Terraria's CreativePowerManager names; each defaults to everyone
    const powers: [string, string][] = [
        ["time_setfrozen", "Freeze time"], ["time_setdawn", "Set time to dawn"], ["time_setnoon", "Set time to noon"],
        ["time_setdusk", "Set time to dusk"], ["time_setmidnight", "Set time to midnight"], ["time_setspeed", "Time speed"],
        ["godmode", "Godmode"], ["increaseplacementrange", "Placement range"], ["setdifficulty", "Difficulty"],
        ["setspawnrate", "Enemy spawn rate"], ["biomespread_setfrozen", "Freeze biome spread"],
        ["rain_setstrength", "Rain strength"], ["rain_setfrozen", "Freeze rain"],
        ["wind_setstrength", "Wind strength"], ["wind_setfrozen", "Freeze wind"],
    ];
    return powers.map(([power, label]) => ({
        id: `journeypermission_${power}`, label, kind: "select", section, default: "2", restartRequired: true,
        choices: [{ value: "2", label: "Everyone" }, { value: "1", label: "Host only" }, { value: "0", label: "No one" }],
    }));
}
/** The options a new world is generated with, asked for in New World rather than Options. */
export const WORLD_GENERATION: readonly string[] = options.filter(o => o.scope === "world").map(o => o.id);
/** Mod actions a tModLoader server adds; a vanilla server refuses them. */
export const MOD_ACTIONS = ["terraria-mods", "terraria-mod-search", "terraria-mod-items", "terraria-mod-install", "terraria-mod-remove", "terraria-mod-upload", "terraria-mod-updates", A.discardAddonUpload] as const;
export const terraria: GameDefinition = {
    id: "terraria", name: "Terraria", icon: "landscape", art: gameArt("terraria"),
    softwareLabel: ({ software, version }) => `${softwareName(terrariaSoftware(software))} ${version}`.trim(),
    hostSupport({ os, arch }) {
        if (arch !== "x64") return { supported: false, reason: "Terraria requires an x64 host. Apple Silicon has no certification machine; Rosetta is not certified." };
        if (os !== "linux") return { supported: false, reason: "This Terraria host route is awaiting Windows x64 / Intel Mac certification. Linux x64 is the verified server route." };
        return { supported: true };
    },
    describe({ software: raw, version }) {
        const software = terrariaSoftware(raw);
        const modded = software === "tmodloader";
        // the runtime of the installed release; before setup, the newest
        const runtime = (tmodloaderReleases.find(r => r.version === version) ?? tmodloaderReleases[0]).runtime;
        return {
            options, optionsWhileRunning: "locked", control: { kind: "stdin" }, widgets: ["status", "console"],
            packages: modded ? [{ id: runtime, purpose: ".NET runtime for tModLoader" }] : [],
            actions: [A.startServer, A.stopServer, A.restartServer, A.runCommand, A.loadConfig, A.sayChat, A.listServerFiles, A.readServerFile, A.writeServerFile, A.listLogFiles, A.readLogFile, A.readGameOptions, A.writeGameOptions, "terraria-versions", "terraria-install", "terraria-worlds", "terraria-world", "terraria-world-delete", "terraria-world-inspect", "terraria-world-import", "terraria-world-discard", A.saveWorld, "terraria-motd", "terraria-players", "terraria-kick", "terraria-ban", "terraria-unban", "backup-server", ...(modded ? MOD_ACTIONS : [])],
            tabs: [
                { id: "overview", label: "Overview", icon: "dashboard", owner: "game", variant: "fill" },
                { id: "chat", label: "Chat", icon: "chat", group: "Play", owner: "game", variant: "fill" },
                { id: "players", label: "Players", icon: "group", group: "Play", owner: "game", variant: "fill", width: "full" },
                { id: "worlds", label: "Worlds", icon: "public", group: "World", owner: "game" },
                { id: "versions", label: "Versions", icon: "deployed_code", group: "Software", owner: "game" },
                ...(modded ? [{ id: "mods", label: "Mods", icon: "extension", group: "Software", owner: "game" } as const] : []),
                { id: "options", label: "Options", icon: "tune", group: "Server", owner: "shared" },
                { id: "files", label: "Files", icon: "folder", group: "Server", owner: "shared", variant: "fill" },
                { id: "logs", label: "Logs", icon: "description", group: "Server", owner: "shared", variant: "fill" },
                { id: "backups", label: "Backups", icon: "backup", group: "Server", owner: "shared" },
            ],
        };
    },
};
