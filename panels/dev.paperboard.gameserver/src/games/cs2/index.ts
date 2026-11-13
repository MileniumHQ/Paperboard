import type { OptionSection } from "../types";
import { sourceGame, type SourceGameSpec, type SourceOption } from "../source";

/** Steam's id for Counter-Strike 2. Its dedicated server is the game's own download, run with -dedicated. */
export const CS2_APP_ID = 730;

/**
 * A way to play: the game_type and game_mode the server starts with, and the
 * config the game runs for it. The game runs `gamemode_<cfg>.cfg` after
 * server.cfg and `gamemode_<cfg>_server.cfg` after that, so the last is where
 * a server's own settings hold.
 */
export const MODES = {
    competitive: { label: "Competitive", type: 0, mode: 1, cfg: "competitive" },
    casual: { label: "Casual", type: 0, mode: 0, cfg: "casual" },
    wingman: { label: "Wingman", type: 0, mode: 2, cfg: "competitive2v2" },
    deathmatch: { label: "Deathmatch", type: 1, mode: 2, cfg: "deathmatch" },
    armsrace: { label: "Arms Race", type: 1, mode: 0, cfg: "armsrace" },
} as const;
export type Cs2Mode = keyof typeof MODES;

const gameplay: OptionSection = { title: "Gameplay" };
const advanced = { tab: "advanced" } as const;

const options: readonly SourceOption[] = [
    { id: "hostname", label: "Server name", kind: "text", maxLength: 64, default: "Counter-Strike 2 Server", restartRequired: false, cvar: "hostname" },
    { id: "password", label: "Join password", kind: "secret", restartRequired: false },
    { id: "maxplayers", label: "Maximum players", kind: "number", min: 2, max: 64, default: 10, restartRequired: true },
    { id: "port", label: "Port", description: "The UDP port players join on.", kind: "number", min: 1, max: 65535, default: 27015, restartRequired: true },
    { id: "internet", label: "Internet server", description: "Off keeps the server to players on its own network.", kind: "boolean", default: true, restartRequired: true },
    { id: "map", label: "Map", kind: "text", maxLength: 64, default: "de_dust2", restartRequired: true, scope: "overview" },
    { id: "gamemode", label: "Game mode", kind: "select", default: "competitive", restartRequired: true, choices: Object.entries(MODES).map(([value, { label }]) => ({ value, label })) },
    { id: "bot_quota", label: "Bots", description: "Bots fill the teams up to this many players.", kind: "number", min: 0, max: 32, default: 0, restartRequired: false, section: gameplay, cvar: "bot_quota" },
    {
        id: "bot_difficulty", label: "Bot difficulty", kind: "select", default: "1", restartRequired: false, section: gameplay, cvar: "bot_difficulty",
        choices: [{ value: "0", label: "Easy" }, { value: "1", label: "Normal" }, { value: "2", label: "Hard" }, { value: "3", label: "Expert" }],
    },
    { id: "mp_autoteambalance", label: "Team balance", description: "Moves players to keep the teams even.", kind: "boolean", default: true, restartRequired: false, section: gameplay, cvar: "mp_autoteambalance" },
    { id: "token", label: "Game server login token", description: "Runs the server under a persistent Steam account, made for app 730 at steamcommunity.com/dev/managegameservers. Counter-Strike 2 lists a server in its browser only with one.", kind: "secret", noun: "token", restartRequired: true, ...advanced },
];

export const CS2: SourceGameSpec = {
    id: "counter-strike-2",
    name: "Counter-Strike 2",
    icon: "sports_esports",
    appId: CS2_APP_ID,
    gameDir: "game/csgo",
    binaries: { linux: { executable: "game/bin/linuxsteamrt64/cs2", libraryDir: "game/bin/linuxsteamrt64" } },
    // the server reads its console on stdin; its remote console runs commands but answers with nothing
    control: "stdin",
    defaultPort: 27015,
    options,
    mapModes: { de: "Bomb Defusal", cs: "Hostage Rescue", ar: "Arms Race" },
    // it plays the map it is on, round after round; there is no map cycle file
    rotation: false,
};

export const cs2 = sourceGame(CS2);
