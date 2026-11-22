import { gameFor } from "./games";
// A server's id is also its Blocks project id.
export const PANEL_ID = "dev.paperboard.gameserver";
export const SERVERS_VERSION = 2;
export const MAX_SERVERS = 50;
export interface StoredServer {
    id: string;
    name: string;
    game: string;
    directory: string;
    createdAt: number;
    settings: Record<string, unknown>;
}
export interface ServersConfig {
    version: number;
    serversDirectory: string;
    servers: StoredServer[];
}
export function isServerId(id: unknown): id is string {
    return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id);
}
export function createServerId(): string {
    return `s-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
/** the longest name a server takes; its name field stops there */
export const SERVER_NAME_MAX = 100;
export function serverName(name: unknown): string {
    if (typeof name !== "string" || !name.trim() || name.trim().length > SERVER_NAME_MAX)
        throw new Error(`Give the server a name of 1–${SERVER_NAME_MAX} characters`);
    return name.trim();
}
const newServersDirectory = () => `servers-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
export function readServersConfig(saved: unknown): ServersConfig {
    if (saved == null)
        return { version: SERVERS_VERSION, serversDirectory: newServersDirectory(), servers: [] };
    if (typeof saved !== "object" || Array.isArray(saved))
        throw new Error("The saved servers are damaged");
    const raw = saved as any;
    if (raw.servers === undefined) {
        if (!Object.keys(raw).length)
            return {
                version: SERVERS_VERSION,
                serversDirectory: newServersDirectory(),
                servers: [],
            };
        throw new Error("The saved servers are damaged");
    }
    if (raw.version !== SERVERS_VERSION)
        throw new Error(
            "The saved servers use an unsupported version; update Game Server before opening them",
        );
    if (
        typeof raw.serversDirectory !== "string" ||
        !/^servers-[a-f0-9]{12}$/.test(raw.serversDirectory)
    )
        throw new Error("The saved server directory is damaged");
    if (!Array.isArray(raw.servers) || raw.servers.length > MAX_SERVERS)
        throw new Error("The saved servers are damaged");
    const ids = new Set<string>();
    const directories = new Set<string>();
    const servers = raw.servers.map((s: any): StoredServer => {
        if (
            !s ||
            !isServerId(s.id) ||
            ids.has(s.id) ||
            typeof s.game !== "string" ||
            !s.game ||
            s.directory !== `${raw.serversDirectory}/${s.id}` ||
            directories.has(s.directory) ||
            !s.settings ||
            typeof s.settings !== "object" ||
            Array.isArray(s.settings) ||
            !Number.isFinite(s.createdAt)
        )
            throw new Error("The saved servers are damaged");
        gameFor(s.game);
        ids.add(s.id);
        directories.add(s.directory);
        return {
            id: s.id,
            name: serverName(s.name),
            game: s.game,
            directory: s.directory,
            createdAt: s.createdAt,
            settings: s.settings,
        };
    });
    return {
        version: SERVERS_VERSION,
        serversDirectory: raw.serversDirectory,
        servers,
    };
}

