import type { OptionSection } from "../types";
import { sourceGame, type SourceGameSpec, type SourceOption } from "../source";

const gameplay: OptionSection = { title: "Gameplay" };
const advanced = { tab: "advanced" } as const;

const options: readonly SourceOption[] = [
    { id: "hostname", label: "Server name", kind: "text", maxLength: 64, default: "Team Fortress 2 Server", restartRequired: false, cvar: "hostname" },
    { id: "password", label: "Join password", kind: "secret", restartRequired: false },
    { id: "maxplayers", label: "Maximum players", kind: "number", min: 2, max: 32, default: 24, restartRequired: true },
    { id: "port", label: "Port", description: "The UDP port players join on. RCON listens on the same TCP port.", kind: "number", min: 1, max: 65535, default: 27015, restartRequired: true },
    { id: "internet", label: "Internet server", description: "Off keeps the server to players on its own network.", kind: "boolean", default: true, restartRequired: true },
    { id: "map", label: "Map", kind: "text", maxLength: 64, default: "ctf_2fort", restartRequired: true, scope: "overview" },
    { id: "mp_timelimit", label: "Time limit", description: "Minutes on a map before the next one. 0 plays until the win limit.", kind: "number", min: 0, max: 600, default: 0, restartRequired: false, section: gameplay, cvar: "mp_timelimit" },
    { id: "mp_winlimit", label: "Win limit", description: "Rounds a team wins before the map changes. 0 places no limit.", kind: "number", min: 0, max: 100, default: 0, restartRequired: false, section: gameplay, cvar: "mp_winlimit" },
    { id: "tf_bot_quota", label: "Bots", description: "Bots fill the server up to this many players, leaving as people join. They wait for the first person.", kind: "number", min: 0, max: 31, default: 0, restartRequired: false, section: gameplay, cvar: "tf_bot_quota" },
    { id: "mp_autoteambalance", label: "Team balance", description: "Moves players to keep the teams even.", kind: "boolean", default: true, restartRequired: false, section: gameplay, cvar: "mp_autoteambalance" },
    { id: "tf_weapon_criticals", label: "Random crits", kind: "boolean", default: true, restartRequired: false, section: gameplay, cvar: "tf_weapon_criticals" },
    { id: "mp_friendlyfire", label: "Friendly fire", description: "Teammates hurt each other.", kind: "boolean", default: false, restartRequired: false, section: gameplay, cvar: "mp_friendlyfire" },
    { id: "sv_alltalk", label: "All talk", description: "Both teams hear each other's voice chat.", kind: "boolean", default: false, restartRequired: false, section: gameplay, cvar: "sv_alltalk" },
    { id: "rconPassword", label: "RCON password", description: "Lets RCON tools manage the server. Paperboard manages it through RCON too, so it makes a random one when none is set.", kind: "secret", restartRequired: true, ...advanced },
    { id: "token", label: "Game server login token", description: "Runs the server under a persistent Steam account, made for app 440 at steamcommunity.com/dev/managegameservers. Without one, Steam gives it a new anonymous account each start.", kind: "secret", noun: "token", restartRequired: true, ...advanced },
];

export const TF2: SourceGameSpec = {
    id: "team-fortress-2",
    name: "Team Fortress 2",
    icon: "sports_esports",
    appId: 232250,
    gameDir: "tf",
    binaries: { linux: { executable: "srcds_linux64", libraryDir: "bin/linux64" }, win32: { executable: "srcds_win64.exe" } },
    // replay_srv.so links it; Debian and Ubuntu have it, Arch and Fedora don't
    libraryPackages: { "libcurl-gnutls.so.4": { id: "libcurl-gnutls", purpose: "The curl library Team Fortress 2's Linux server links, on computers without it" } },
    sourcemod: true,
    defaultPort: 27015,
    options,
    roleNames: { heavyweapons: "Heavy" },
    mapModes: {
        arena: "Arena", cp: "Control Point", cppl: "Control Point and Payload", ctf: "Capture the Flag", koth: "King of the Hill",
        mvm: "Mann vs. Machine", pass: "PASS Time", pd: "Player Destruction", pl: "Payload", plr: "Payload Race", rd: "Robot Destruction",
        sd: "Special Delivery", tc: "Territorial Control", tow: "Tug of War", tr: "Training", vsh: "Versus Saxton Hale", zi: "Zombie Infection",
    },
};

export const tf2 = sourceGame(TF2);
