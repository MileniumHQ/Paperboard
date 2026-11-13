import type { GameDefinition, GameOption, OptionSection } from "../types";
import { CALLS as A } from "../../service/contract";
import { gameArt } from "../art";
import { AUTOMATION_CALLS, AUTOMATION_TAB } from "../automation";
import { hostRoutes } from "../host";

/** Steam's id for the Rust Dedicated Server, which SteamCMD downloads anonymously; the game itself is app 252490. */
export const RUST_APP_ID = 258550;

/**
 * An option and the server variable that holds it, given on the command line
 * at each start and, when restartRequired is false, set at once on a running
 * server over its remote console. Options without one are ports and the
 * password, kept in the panel's settings and the vault.
 */
export type RustOption = GameOption & { convar?: string };

const map: OptionSection = { title: "Map", description: "A new size or seed makes a new, empty map. The old map and what players built on it stay in the server folder." };
const advanced = { tab: "advanced" } as const;

export const options: readonly RustOption[] = [
    { id: "hostname", label: "Server name", kind: "text", maxLength: 64, default: "Rust Server", restartRequired: false, convar: "server.hostname" },
    { id: "description", label: "Description", description: "Shown on the server's page in Rust's server browser.", kind: "text", maxLength: 512, default: "", restartRequired: false, convar: "server.description" },
    { id: "maxplayers", label: "Maximum players", kind: "number", min: 1, max: 500, default: 50, restartRequired: false, convar: "server.maxplayers" },
    { id: "port", label: "Port", description: "The UDP port players join on.", kind: "number", min: 1, max: 65535, default: 28015, restartRequired: true },
    {
        id: "gamemode", label: "Game mode", kind: "select", default: "vanilla", restartRequired: true, convar: "server.gamemode",
        choices: [{ value: "vanilla", label: "Vanilla" }, { value: "softcore", label: "Softcore" }, { value: "hardcore", label: "Hardcore" }],
    },
    { id: "pve", label: "PvE", description: "Players can't hurt each other.", kind: "boolean", default: false, restartRequired: false, convar: "server.pve" },
    { id: "worldsize", label: "Map size", description: "Bigger maps take more memory and longer to make on the first start.", kind: "slider", min: 1000, max: 6000, step: 500, unit: "m", marks: [1000, 3000, 4500, 6000], default: 3000, restartRequired: true, section: map, convar: "server.worldsize" },
    { id: "seed", label: "Map seed", description: "The number the map is made from. The same size and seed make the same map.", kind: "number", min: 0, max: 2147483647, restartRequired: true, section: map, convar: "server.seed" },
    { id: "saveinterval", label: "Autosave seconds", description: "How often the world saves itself.", kind: "number", min: 60, max: 3600, default: 600, restartRequired: false, convar: "server.saveinterval", ...advanced },
    { id: "rconPassword", label: "RCON password", description: "Lets RCON tools manage the server: 8 to 64 letters, digits, - and _. Paperboard manages it through RCON too, so it makes a random one when none is set.", kind: "secret", restartRequired: true, ...advanced },
];

/** What the Map tab shows: the map the server makes and plays, and whether it has been made yet. */
export interface RustMapView {
    size: number;
    seed: number;
    /** the map's files are in the server folder: the server has started on it */
    made: boolean;
    /** players' learned blueprints are in the server folder */
    blueprints: boolean;
}

export const rust: GameDefinition = {
    id: "rust", name: "Rust", icon: "forest", art: gameArt("rust"),
    softwareLabel: ({ version }) => (version ? `Rust ${version}` : "Rust"),
    hostSupport: hostRoutes("Rust dedicated server", { os: ["linux", "win32"], arch: ["x64"] }),
    describe() {
        return {
            options, optionsWhileRunning: "next-start", backupWhileRunning: "offline",
            // Rust reads no console input; commands go over its WebSocket remote console
            control: { kind: "rcon" }, widgets: ["status", "console"],
            packages: [{ id: "steamcmd", purpose: "Downloads and updates the Rust dedicated server from Steam" }],
            calls: [A.startServer, A.stopServer, A.restartServer, A.runCommand, A.loadConfig, A.sayChat, A.saveWorld, A.listServerFiles, A.readServerFile, A.writeServerFile, A.listLogFiles, A.readLogFile, A.readGameOptions, A.writeGameOptions, "rust-install", "rust-info", "rust-latest", "rust-metrics", "rust-players", "rust-kick", "rust-ban", "rust-unban", "rust-map", "rust-map-picture", "rust-map-draw", "rust-wipe", ...AUTOMATION_CALLS],
            tabs: [
                { id: "overview", label: "Overview", icon: "dashboard", owner: "game", variant: "fill", compactVariant: "page" },
                { id: "chat", label: "Chat", icon: "chat", group: "Play", owner: "game", variant: "fill" },
                { id: "players", label: "Players", icon: "group", group: "Play", owner: "game", variant: "fill", width: "full" },
                { id: "map", label: "Map", icon: "map", group: "Play", owner: "game" },
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
