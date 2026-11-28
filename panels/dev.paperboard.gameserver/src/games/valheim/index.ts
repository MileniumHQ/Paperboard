import type { GameDefinition, GameOption, OptionSection } from "../types";
import { gameArt } from "../art";
import { AUTOMATION_CALLS, AUTOMATION_TAB } from "../automation";
import { hostRoutes } from "../host";

/** Steam's id for the Valheim Dedicated Server; SteamCMD downloads it anonymously. */
export const VALHEIM_APP_ID = 896660;
/** The game's own id, which the server reports to Steam as it runs (start_server.sh's SteamAppId). */
export const VALHEIM_CLIENT_APP_ID = 892970;
/** The server turns a player away once ten are on (ZNet.RPC_PeerInfo); no option changes it. */
export const VALHEIM_MAX_PLAYERS = 10;
/** The server's password rule (FejdStartup.m_minimumPasswordLength). */
export const VALHEIM_PASSWORD_MIN = 5;

/** An option, and the server argument that carries it at each start. */
export type ValheimOption = GameOption & { arg?: string };

const modifiers: OptionSection = {
    title: "World modifiers",
    description: "Set at every start, as the game's own world menu sets them. The preset comes first; a modifier set here changes it.",
};
const normal = { value: "default", label: "Normal" } as const;
const choice = (value: string, label: string) => ({ value, label });
/** A world modifier and the values the server takes for it (WorldModifierOption), Normal first. */
const modifier = (id: string, label: string, description: string, choices: { value: string; label: string }[]): ValheimOption => ({
    id, label, description, kind: "select", default: "default", restartRequired: true, section: modifiers, choices: [normal, ...choices],
});
/** A world modifier switch (`-setkey`). */
const key = (id: string, label: string, description: string): ValheimOption => ({ id, label, description, kind: "boolean", default: false, restartRequired: true, section: modifiers });
const advanced = { tab: "advanced", restartRequired: true } as const;

export const PRESETS = ["normal", "casual", "easy", "hard", "hardcore", "immersive", "hammer"] as const;
export const MODIFIERS = ["combat", "deathpenalty", "resources", "raids", "portals"] as const;
export const KEYS = ["nobuildcost", "playerevents", "passivemobs", "nomap"] as const;

export const options: readonly ValheimOption[] = [
    { id: "name", label: "Server name", description: "Shown in Valheim's server list.", kind: "text", maxLength: 64, default: "Valheim", restartRequired: true },
    { id: "world", label: "World", description: "The world the server runs. A name the server has no world of makes a new one at the next start; the others stay in the server folder.", kind: "text", maxLength: 40, default: "Dedicated", restartRequired: true },
    { id: "password", label: "Join password", description: "At least 5 characters, and not part of the world's name. A public server needs one.", kind: "secret", restartRequired: true },
    { id: "port", label: "Port", description: "The UDP port players join on. The server uses the next port too, so both are kept free.", kind: "number", min: 1024, max: 65534, default: 2456, restartRequired: true },
    { id: "public", label: "Public", description: "Lists the server in Valheim's server list. A public server needs a join password.", kind: "boolean", default: false, restartRequired: true },
    { id: "crossplay", label: "Crossplay", description: "Players on Xbox, PC Game Pass and Steam join together through Valheim's relay, with the join code the Overview shows or the server's public address. It can't be joined at a local address.", kind: "boolean", default: false, restartRequired: true },
    {
        id: "preset", label: "Preset", description: "Valheim's difficulty presets, from its world menu.", kind: "select", default: "normal", restartRequired: true, section: modifiers,
        choices: [choice("normal", "Normal"), choice("casual", "Casual"), choice("easy", "Easy"), choice("hard", "Hard"), choice("hardcore", "Hardcore"), choice("immersive", "Immersive"), choice("hammer", "Hammer")],
    },
    modifier("combat", "Combat", "How much damage players give and take, and how dangerous enemies are.", [choice("veryeasy", "Very easy"), choice("easy", "Easy"), choice("hard", "Hard"), choice("veryhard", "Very hard")]),
    modifier("deathpenalty", "Death penalty", "What a player loses when they die.", [choice("casual", "Casual"), choice("veryeasy", "Very easy"), choice("easy", "Easy"), choice("hard", "Hard"), choice("hardcore", "Hardcore")]),
    modifier("resources", "Resource rate", "What players gain from the world and from enemies.", [choice("muchless", "Much less"), choice("less", "Less"), choice("more", "More"), choice("muchmore", "Much more"), choice("most", "Most")]),
    modifier("raids", "Raid rate", "How often enemies raid bases.", [choice("none", "None"), choice("muchless", "Much less"), choice("less", "Less"), choice("more", "More"), choice("muchmore", "Much more")]),
    modifier("portals", "Portals", "How portals work.", [choice("casual", "Portal items"), choice("hard", "No boss portals"), choice("veryhard", "No portals")]),
    key("nobuildcost", "No build cost", "Building takes no materials."),
    key("playerevents", "Player based raids", "Raids follow each player's own progress, not the bosses killed on the server."),
    key("passivemobs", "Passive enemies", "Enemies won't attack until provoked."),
    key("nomap", "No map", "Players have no map or minimap."),
    { id: "saveinterval", label: "Autosave minutes", description: "How often the world saves itself while players are on. It also saves as the server stops.", kind: "number", min: 1, max: 240, default: 30, ...advanced },
    { id: "backups", label: "World backups", description: "How many of its own copies of the world Valheim keeps beside it.", kind: "number", min: 0, max: 20, default: 4, ...advanced },
    { id: "backupshort", label: "First backup minutes", description: "How old Valheim's first copy of the world is.", kind: "number", min: 5, max: 1440, default: 120, ...advanced },
    { id: "backuplong", label: "Later backup minutes", description: "How far apart Valheim's other copies are.", kind: "number", min: 5, max: 10080, default: 720, ...advanced },
];

export const valheim: GameDefinition = {
    id: "valheim", name: "Valheim", icon: "forest", art: gameArt("valheim"),
    softwareLabel: ({ version }) => (version ? `Valheim ${version}` : "Valheim"),
    // the Windows server saves only when Ctrl+C reaches its console, which Paperboard can't send it yet; macOS has no server
    hostSupport: (host, game) => {
        if (host.os === "win32" && host.arch === "x64") return { supported: false, reason: "Paperboard can't stop the Windows Valheim server so that it saves its world yet. Run it on a Linux computer." };
        return hostRoutes("Valheim dedicated server", { os: ["linux"], arch: ["x64"] })(host, game);
    },
    describe() {
        return {
            options, optionsWhileRunning: "next-start", backupWhileRunning: "offline",
            // the server reads no console input; admins and bans are its list files
            control: { kind: "none" }, widgets: ["status"],
            packages: [{ id: "steamcmd", purpose: "Downloads and updates the Valheim dedicated server from Steam" }],
            calls: ["startServer", "stopServer", "restartServer", "loadConfig", "listServerFiles", "readServerFile", "writeServerFile", "listLogFiles", "readLogFile", "readGameOptions", "writeGameOptions", "steamInstall", "steamInfo", "steamSize", "steamLatest", "valheimSession", "valheimPlayers", "valheimList", ...AUTOMATION_CALLS],
            tabs: [
                { id: "overview", label: "Overview", icon: "dashboard", owner: "game", variant: "fill", compactVariant: "page" },
                { id: "players", label: "Players", icon: "group", group: "Play", owner: "game", variant: "fill", width: "full" },
                { id: "versions", label: "Updates", icon: "update", group: "Software", owner: "game" },
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
