import type { GameDefinition, GameOption, GameTab } from "../types";
import { CALLS as A } from "../../service/contract";
import { gameArt } from "../art";
import { AUTOMATION_CALLS, AUTOMATION_TAB } from "../automation";
import { hostRoutes } from "../host";
import type { ModscanGame } from "../steam/modscan";
import type { SteamIdForm } from "./log";
import type { SourcePlugin } from "./sourcemod";
import type { SourceWorkshopMap } from "./workshop";

/**
 * A Source engine option and how the server takes it. `cvar`: a console
 * variable, written to the generated server.cfg and, when restartRequired is
 * false, set at once on a running server over RCON. Options without one are
 * launch settings in the panel's settings, or passwords in the vault.
 */
export type SourceOption = GameOption & { cvar?: string };

/** What sets one Source dedicated server apart from another. */
export interface SourceGameSpec {
    id: string;
    name: string;
    icon: string;
    /** Steam's id for the dedicated server; SteamCMD downloads it anonymously. */
    appId: number;
    /** The Steam branch the server is installed from, when it is not the public one. */
    branch?: string;
    /** The mod folder under the install, passed as -game. */
    gameDir: string;
    /**
     * The server binary on each operating system it runs on, relative to
     * the install; on Linux, with the folder of the libraries it ships.
     */
    binaries: { linux?: { executable: string; libraryDir: string }; win32?: { executable: string } };
    /**
     * How console commands reach the server. "rcon" (unless said): over its
     * remote console, which is how a Source server run without a terminal is
     * reached. "stdin": written to its input, which a Source 2 server reads,
     * and whose remote console answers nothing.
     */
    control?: "rcon" | "stdin";
    /** How the server writes a player's Steam id, and takes it for a ban; "steam3" unless said. */
    steamIds?: SteamIdForm;
    /**
     * The server drops an RCON packet whose first byte is a TLS hello's, as
     * Garry's Mod's does (rcon.ts): commands are padded past that length by
     * themselves, and an RCON password of that length is refused when it is set.
     */
    rconReadsTls?: boolean;
    /**
     * The game's own launch arguments, from its saved options, after the ones
     * every Source server takes and before `+map`. It refuses a value the
     * server could not start with; `gameDir` is the installed game folder.
     */
    launchArgs?(saved: Record<string, unknown>, gameDir: string): Promise<string[]>;
    /**
     * What the game writes into its game folder that is the server owner's:
     * folders and files, relative to it. They live in the server folder, where
     * backups keep them and an update leaves them, and are linked into the
     * install.
     */
    keeps?: { folders?: readonly string[]; files?: readonly string[] };
    /**
     * The game keeps data that a copy taken while it runs could tear, such as
     * a database: a backup stops the server for the copy and starts it again.
     * Otherwise its files copy as it runs.
     */
    offlineBackups?: boolean;
    /**
     * System libraries the Linux server links that Origami can supply, by
     * file name: the package is installed and put on the library path only
     * when the computer's own libraries leave that name unresolved.
     */
    libraryPackages?: Readonly<Record<string, { id: string; purpose: string }>>;
    /** SourceMod runs on this game's server: the Mods tab offers it and its plugins. */
    sourcemod?: boolean;
    defaultPort: number;
    /**
     * Must include "hostname", "password", "maxplayers", "port", "internet",
     * "rconPassword", "token" and "map": the map the server starts on, edited
     * on the Overview.
     */
    options: readonly SourceOption[];
    /** Class names where the game log's differ from what players call them ("heavyweapons" is the Heavy). */
    roleNames?: Readonly<Record<string, string>>;
    /**
     * Game mode names by map prefix ("ctf" for ctf_2fort), shown beside each
     * map; prefixes of one mode share its name. A game with them plays a map
     * rotation, unless `rotation` says it has none: it has the Maps tab, and
     * setup asks for a mode and a starting map. A game without plays one map
     * until it is changed.
     */
    mapModes?: Readonly<Record<string, string>>;
    /** false for a game whose maps have modes but which reads no map cycle file, as Counter-Strike 2. */
    rotation?: false;
    /**
     * A wiki page listing the game's maps with a picture each, read at runtime
     * (the dedicated server ships none). Maps without one are shown without.
     */
    mapPictures?: SourceMapPictureSource;
    /** Map pictures the game ships in its own install, read on the computer that runs the server. */
    installPictures?: SourceInstallPictures;
    /**
     * The server loads Steam Workshop maps itself, as `workshop/<id>`: the
     * Maps tab searches the Workshop for them and a server can start on, change
     * to and cycle through them. `game` is modscan's name for the game; `base`
     * replaces the search service's address, for tests.
     */
    workshop?: { game: ModscanGame; base?: string };
}

/** Where a game's map pictures come from: a MediaWiki list page of maps, a file name and a thumbnail to a row. */
export interface SourceMapPictureSource {
    /** who the pictures are credited to, named beside them */
    name: string;
    /** the page, an https address */
    page: string;
}

/**
 * Where a game's install keeps its map pictures, from the folder its files
 * are in (gameDir), with {map} for a map's name. Each is a PNG, or a Source 2
 * texture (.vtex_c) that holds one.
 */
export interface SourceInstallPictures {
    /** the VPK directory file holding them: "garrysmod_dir.vpk" */
    archive: string;
    /** a map's picture inside it: "maps/thumb/{map}.png" */
    path: string;
    /** a map's picture as a file of its own, which a map someone adds brings: "maps/thumb/{map}.png" */
    loose?: string;
}

/** The pictures a game's wiki shows, by map name, and where they came from. */
export interface SourceMapPictures {
    source: { name: string; url: string };
    pictures: Record<string, string>;
    /** the maps' real names ("2Fort" for ctf_2fort), by file name in lower case; a map the wiki names by its file name has none */
    titles: Record<string, string>;
}

/** Whether the game plays a rotation of maps by mode: the Maps tab and setup's questions are for those that do. */
export const rotatesMaps = (spec: Pick<SourceGameSpec, "mapModes" | "rotation">) => spec.mapModes !== undefined && spec.rotation !== false;

/** The game mode a map's prefix names, if the game lists it. */
export function mapMode(spec: Pick<SourceGameSpec, "mapModes">, map: string): string | undefined {
    return spec.mapModes?.[map.split("_")[0]!.toLowerCase()];
}

/** Call names every Source game answers, prefixed with its game id. */
export const sourceCalls = (id: string) => ({
    info: `${id}-info`,
    latest: `${id}-latest`,
    install: `${id}-install`,
    players: `${id}-players`,
    metrics: `${id}-metrics`,
    kick: `${id}-kick`,
    ban: `${id}-ban`,
    unban: `${id}-unban`,
    changeMap: `${id}-change-map`,
    maps: `${id}-maps`,
    mapPictures: `${id}-map-pictures`,
    mapPicture: `${id}-map-picture`,
    mapCycle: `${id}-map-cycle`,
    mapCycleSet: `${id}-map-cycle-set`,
    play: `${id}-play`,
    workshopMaps: `${id}-workshop-maps`,
    workshopFind: `${id}-workshop-find`,
    workshopAdd: `${id}-workshop-add`,
    workshopRemove: `${id}-workshop-remove`,
    sourcemod: `${id}-sourcemod`,
    sourcemodSet: `${id}-sourcemod-set`,
    plugin: `${id}-plugin`,
    pluginRemove: `${id}-plugin-remove`,
    pluginUpload: `${id}-plugin-upload`,
    admin: `${id}-admin`,
});

/** A running server's figures for its Overview. */
export interface SourceMetrics {
    /** bots on the server; they are not counted as players */
    bots: number;
}

/** The calls a game's server answers: every game's, and those of what the game has (a map rotation, Workshop maps, SourceMod). */
export function describedCalls(spec: SourceGameSpec): string[] {
    const ids = sourceCalls(spec.id);
    return [
        ids.info, ids.latest, ids.install, ids.players, ids.metrics, ids.kick, ids.ban, ids.unban, ids.changeMap, ids.maps,
        ...(spec.mapPictures ? [ids.mapPictures] : []),
        ...(spec.installPictures ? [ids.mapPicture] : []),
        ...(rotatesMaps(spec) ? [ids.mapCycle, ids.mapCycleSet, ids.play] : []),
        ...(spec.workshop ? [ids.workshopMaps, ids.workshopFind, ids.workshopAdd, ids.workshopRemove] : []),
        ...(spec.sourcemod ? [ids.sourcemod, ids.sourcemodSet, ids.plugin, ids.pluginRemove, ids.pluginUpload, ids.admin] : []),
    ];
}

/** What the Mods tab shows. */
export interface SourceModView {
    /** SourceMod loads when the server next starts */
    on: boolean;
    /** SourceMod loaded with the running server, so plugin changes apply at once */
    active: boolean;
    /** on, but its files are gone from the server folder, so the next start fails */
    missing: boolean;
    plugins: SourcePlugin[];
}

/** What the Maps tab shows of the server's map rotation. */
export interface SourceMapCycle {
    /** the maps the server plays through, in order, then starts over */
    maps: string[];
    /** the rotation was set on the Maps tab; otherwise the server reads `file` */
    custom: boolean;
    /** where the rotation is read from, relative to the game folder; null while the server has none */
    file: string | null;
    /** the maps the server can load, for choosing and for marking what the rotation lists but the server lacks; Workshop maps added to the server are `workshop/<id>` */
    installed: string[];
    /** the Steam Workshop maps added to the server, for their titles and pictures */
    workshop: SourceWorkshopMap[];
    /** why each of those can't be removed right now, by item id: the server starts on it, cycles through it or is playing it; a map not listed can go */
    workshopHeld: Record<string, string>;
    /** a mapcyclefile in the server folder's server.cfg, which the server follows over this page; null when none */
    overriddenBy: string | null;
}

/** The packages SourceMod comes from, as Origami names them. */
export const SOURCEMOD_PACKAGES = [
    { id: "metamod-source", purpose: "Metamod:Source, which loads SourceMod into the server" },
    { id: "sourcemod", purpose: "SourceMod, the server's plugin platform" },
] as const;

export function sourceGame(spec: SourceGameSpec): GameDefinition {
    const ids = sourceCalls(spec.id);
    const tabs: GameTab[] = [
        { id: "overview", label: "Overview", icon: "dashboard", owner: "game", variant: "fill", compactVariant: "page" },
        { id: "chat", label: "Chat", icon: "chat", group: "Play", owner: "game", variant: "fill" },
        { id: "players", label: "Players", icon: "group", group: "Play", owner: "game", variant: "fill", width: "full" },
        ...(rotatesMaps(spec) ? [{ id: "maps", label: "Maps", icon: "map", group: "Play", owner: "game" } as const] : []),
        { id: "versions", label: "Updates", icon: "update", group: "Software", owner: "game" },
        ...(spec.sourcemod ? [{ id: "mods", label: "Mods", icon: "extension", group: "Software", owner: "game" } as const] : []),
        { id: "options", label: "Options", icon: "tune", group: "Server", owner: "shared" },
        { id: "files", label: "Files", icon: "folder", group: "Server", owner: "shared", variant: "fill" },
        { id: "logs", label: "Logs", icon: "description", group: "Server", owner: "shared", variant: "fill" },
        { id: "backups", label: "Backups", icon: "backup", group: "Server", owner: "shared" },
        AUTOMATION_TAB,
        { id: "advanced", label: "Advanced", icon: "settings", group: "Server", owner: "shared" },
    ];
    return {
        id: spec.id, name: spec.name, icon: spec.icon, art: gameArt(spec.id),
        softwareLabel: ({ version }) => (version ? `${spec.name} ${version}` : spec.name),
        hostSupport: hostRoutes(`${spec.name} dedicated server`, { os: (["linux", "win32"] as const).filter((os) => spec.binaries[os]), arch: ["x64"] }),
        describe() {
            return {
                options: spec.options,
                optionsWhileRunning: "next-start",
                // most Source servers keep no world, and their files copy as they run
                backupWhileRunning: spec.offlineBackups ? "offline" : "quiesce",
                control: { kind: spec.control ?? "rcon" },
                widgets: ["status", "console"],
                packages: [{ id: "steamcmd", purpose: `Downloads and updates the ${spec.name} dedicated server from Steam` }, ...Object.values(spec.libraryPackages ?? {}), ...(spec.sourcemod ? SOURCEMOD_PACKAGES : [])],
                calls: [A.startServer, A.stopServer, A.restartServer, A.runCommand, A.loadConfig, A.sayChat, A.listServerFiles, A.readServerFile, A.writeServerFile, A.listLogFiles, A.readLogFile, A.readGameOptions, A.writeGameOptions, ...describedCalls(spec), ...(spec.sourcemod ? [A.discardAddonUpload] : []), ...AUTOMATION_CALLS],
                tabs,
            };
        },
    };
}
