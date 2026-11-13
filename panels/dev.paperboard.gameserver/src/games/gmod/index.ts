import type { OptionSection } from "../types";
import { sourceGame, type SourceGameSpec, type SourceOption } from "../source";

const sandbox: OptionSection = { title: "Sandbox", description: "Rules of the Sandbox game mode. Other game modes ignore them." };
const advanced = { tab: "advanced" } as const;

const options: readonly SourceOption[] = [
    { id: "hostname", label: "Server name", kind: "text", maxLength: 64, default: "Garry's Mod Server", restartRequired: false, cvar: "hostname" },
    { id: "password", label: "Join password", kind: "secret", restartRequired: false },
    { id: "maxplayers", label: "Maximum players", kind: "number", min: 2, max: 128, default: 16, restartRequired: true },
    { id: "port", label: "Port", description: "The UDP port players join on. RCON listens on the same TCP port.", kind: "number", min: 1, max: 65535, default: 27015, restartRequired: true },
    { id: "internet", label: "Internet server", description: "Off keeps the server to players on its own network.", kind: "boolean", default: true, restartRequired: true },
    { id: "map", label: "Map", kind: "text", maxLength: 64, default: "gm_construct", restartRequired: true, scope: "overview" },
    { id: "gamemode", label: "Game mode", description: "The folder name of a game mode, such as sandbox or terrortown. One from the Workshop collection works once the server has downloaded it.", kind: "text", maxLength: 64, default: "sandbox", restartRequired: true },
    { id: "workshopCollection", label: "Workshop collection", description: "A Steam Workshop collection's link or id. The server downloads its add-ons each time it starts. Empty for none.", kind: "text", maxLength: 200, default: "", restartRequired: true },
    { id: "sbox_noclip", label: "Noclip", description: "Players can fly through walls.", kind: "boolean", default: true, restartRequired: false, section: sandbox, cvar: "sbox_noclip" },
    { id: "sbox_godmode", label: "God mode", description: "Nothing hurts players.", kind: "boolean", default: false, restartRequired: false, section: sandbox, cvar: "sbox_godmode" },
    { id: "sbox_playershurtplayers", label: "Player damage", description: "Players hurt each other.", kind: "boolean", default: true, restartRequired: false, section: sandbox, cvar: "sbox_playershurtplayers" },
    { id: "sbox_weapons", label: "Starting weapons", description: "Players spawn with the Half-Life 2 weapons.", kind: "boolean", default: true, restartRequired: false, section: sandbox, cvar: "sbox_weapons" },
    { id: "sbox_maxprops", label: "Props per player", kind: "number", min: 0, max: 10000, default: 200, restartRequired: false, section: sandbox, cvar: "sbox_maxprops" },
    { id: "rconPassword", label: "RCON password", description: "Lets RCON tools manage the server. Paperboard manages it through RCON too, so it makes a random one when none is set.", kind: "secret", restartRequired: true, ...advanced },
    { id: "token", label: "Game server login token", description: "Runs the server under a persistent Steam account, made for app 4000 at steamcommunity.com/dev/managegameservers. Without one, Steam gives it a new anonymous account each start and ranks it lower in the server browser.", kind: "secret", noun: "token", restartRequired: true, ...advanced },
];

/** Steam's id for the Garry's Mod Dedicated Server; the game itself is app 4000. */
export const GMOD_APP_ID = 4020;

export const GMOD: SourceGameSpec = {
    id: "garrys-mod",
    name: "Garry's Mod",
    icon: "construction",
    appId: GMOD_APP_ID,
    // the public branch's Linux server is 32-bit: it needs 32-bit system libraries, and
    // holds its console output where stdbuf (a 64-bit library) can't reach it. Players on
    // either branch join a server on either.
    branch: "x86-64",
    gameDir: "garrysmod",
    // the game's thumbnails, and those a map someone adds brings
    installPictures: { archive: "garrysmod_dir.vpk", path: "maps/thumb/{map}.png", loose: "maps/thumb/{map}.png" },
    binaries: { linux: { executable: "bin/linux64/srcds", libraryDir: "bin/linux64" }, win32: { executable: "srcds_win64.exe" } },
    steamIds: "steam2",
    rconReadsTls: true,
    // add-ons and what they save, and the database the game keeps players' data in
    keeps: { folders: ["addons", "data"], files: ["sv.db"] },
    offlineBackups: true,
    defaultPort: 27015,
    options,
};

export const gmod = sourceGame(GMOD);
