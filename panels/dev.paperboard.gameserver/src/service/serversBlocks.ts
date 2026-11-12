// Game Server's own blocks for the Blocks panel: the ones
// that run the panel itself, as its home screen does. Each server's own
// blocks are its Blocks project (blocks.ts); these make, rename, remove,
// start and stop servers by picking one.
//
// What the blocks do is the service's: the same code the home screen and
// each server's own blocks run. This file only says what they take and give.
import type { BlockChoice, BlockEventDefinition, BlockSet, BlockTypeDefinition, ServiceContext } from "@mileniumhq/paperapi";
import type { GameServerState } from "./types";
import { TRIGGER_IDS } from "./contract";
import { stopServerInstance } from "./lifecycle";
import { restartFromBlocks, startFromBlocks } from "./blocks";

type Context = ServiceContext<GameServerState>;

/** One server as the panel's own blocks read it. */
export interface ServerView {
    name: string;
    /** the game's name, as Minecraft */
    game: string;
    status: GameServerState["serverStatus"];
}

/** What the panel's own blocks run against: the service's server list and the code its home screen uses. */
export interface ServersBlocksHost {
    /** every server's id, in the home screen's order */
    ids(): string[];
    /** the server, or why there is none */
    server(id: unknown): ServerView;
    /** the games a server can be made for */
    games(): BlockChoice[];
    /** makes a server, as New server does; gives its id */
    create(name: string, game: string): Promise<string>;
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;
    /** runs work on the server as one of its operations, as its own blocks run */
    operate(id: string, work: (ctx: Context) => Promise<void>): Promise<void>;
}

/** The ones the panel's events fire, with the server they happened to. */
export const SERVER_EVENTS: readonly string[] = [TRIGGER_IDS.serverStarted, TRIGGER_IDS.serverStopped, TRIGGER_IDS.serverCrashed];

export function serverType(host: ServersBlocksHost): BlockTypeDefinition<string> {
    return {
        id: "server",
        name: "Server",
        icon: "dns",
        description: "One of the panel's game servers",
        base: "text",
        choices: () => host.ids().map((id) => ({ label: host.server(id).name, value: id })),
        fields: {
            name: { type: "text", name: "Name", resolve: (id) => host.server(id).name },
            game: { type: "text", name: "Game", description: "The game it runs, as Minecraft", resolve: (id) => host.server(id).game },
            status: { type: "text", name: "Status", description: "offline, starting, online, stopping or restarting", resolve: (id) => host.server(id).status },
        },
    };
}

const server = { type: "server", name: "Server" } as const;

/** The blocks that run the panel itself: making, removing, starting and stopping its servers. */
export function serversBlocks(host: ServersBlocksHost): BlockSet {
    const idOf = (value: unknown) => (host.server(value), value as string);
    const event = (id: string, name: string, icon: string, verb: string, description: string): BlockEventDefinition => ({
        id,
        name,
        category: "Servers",
        icon,
        description,
        text: `When {server} ${verb}`,
        inputs: { server: { ...server, optional: true } },
        values: { server },
        filters: { server: "server" },
    });
    return {
        values: [
            {
                id: "servers",
                name: "Servers",
                category: "Servers",
                icon: "dns",
                description: "Every server in the panel, in the order the panel lists them",
                type: "list<server>",
                changes: true,
                read: () => host.ids(),
            },
            {
                id: "server",
                name: "Server",
                category: "Servers",
                icon: "dns",
                text: "Server {server}",
                inputs: {
                    server,
                },
                type: "server",
                read: ({ server }: { server: string }) => idOf(server),
            },
        ],
        commands: [
            {
                id: "create-server",
                name: "Create Server",
                category: "Servers",
                icon: "add",
                description: "Adds a server for the game. It's set up, with its software and version, in the panel or with its own blocks",
                text: "Create a {game} server named {name}",
                inputs: {
                    game: { type: "text", name: "Game", choices: () => host.games() },
                    name: { type: "text", name: "Name", maxLength: 100 },
                },
                output: "server",
                run: ({ name, game }: { name: string; game: string }) => host.create(name, game),
            },
            {
                id: "rename-server",
                name: "Rename Server",
                category: "Servers",
                icon: "edit",
                text: "Rename {server} to {name}",
                inputs: { server, name: { type: "text", name: "Name", maxLength: 100 } },
                run: ({ server, name }: { server: string; name: string }) => host.rename(idOf(server), name),
            },
            {
                id: "remove-server",
                name: "Remove Server",
                category: "Servers",
                icon: "delete",
                description: "Stops the server and removes it from the panel. Its files and backups are kept. Refused while something is still running on it",
                text: "Remove {server}",
                inputs: { server },
                run: ({ server }: { server: string }) => host.remove(idOf(server)),
            },
            {
                id: "start-server",
                name: "Start Server",
                category: "Servers",
                icon: "power",
                description: "Launches the server; it is online once it finishes starting",
                text: "Start {server}",
                inputs: { server },
                run: ({ server }: { server: string }) => host.operate(idOf(server), startFromBlocks),
            },
            {
                id: "stop-server",
                name: "Stop Server",
                category: "Servers",
                icon: "stop",
                description: "Saves and stops the server",
                text: "Stop {server}",
                inputs: { server },
                run: ({ server }: { server: string }) => host.operate(idOf(server), stopServerInstance),
            },
            {
                id: "restart-server",
                name: "Restart Server",
                category: "Servers",
                icon: "restart_alt",
                description: "Stops the running server and starts it again",
                text: "Restart {server}",
                inputs: { server },
                run: ({ server }: { server: string }) => host.operate(idOf(server), restartFromBlocks),
            },
        ],
        events: [
            event(TRIGGER_IDS.serverStarted, "When a Server Starts", "play_arrow", "starts", "Runs once a server has finished starting"),
            event(TRIGGER_IDS.serverStopped, "When a Server Stops", "stop", "stops", "Runs when a server's process ends, however it ended"),
            event(TRIGGER_IDS.serverCrashed, "When a Server Crashes", "error", "crashes", "Runs when a server stops without being asked to"),
        ],
    };
}
