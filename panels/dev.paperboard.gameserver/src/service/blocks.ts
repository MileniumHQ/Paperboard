// Game Server's blocks for the Blocks panel (Actions API v2). Each server is
// a Blocks project of its own; what every game shares is here, and a game
// adds its own through its service's blocks().
import type {
    BlockCommandDefinition,
    BlockEventDefinition,
    BlockSet,
    BlockTypeDefinition,
    BlockValueDefinition,
    BlocksProjectHandle,
    ServiceContext,
} from "@mileniumhq/paperapi";
import type { BackupRecord } from "@mileniumhq/paperapi";
import type { ChatMessage, GameServerState } from "./types";
import type { ServerScope } from "./scope";
import { currentServer, inServer } from "./scope";
import { TRIGGER_IDS, type TriggerId } from "./contract";
import { restartServerInstance, sendServerCommand, startServerInstance, stopServerInstance } from "./lifecycle";
import { listLogFiles, readLogFile } from "./logs";
import { sayInChat, serverBackups } from "./actions";
import { currentGameService } from "../games/service";
import { assertGameAction, gameFor } from "../games";

type Context = ServiceContext<GameServerState>;

/** A player, by the name the server knows them by. The panel's own type. */
export const PLAYER_TYPE: BlockTypeDefinition<string> = {
    id: "player",
    name: "Player",
    icon: "person",
    base: "text",
};

const BACKUP_TYPE: BlockTypeDefinition = {
    id: "backup",
    name: "Backup",
    icon: "backup",
    base: "object",
    fields: {
        id: { type: "text", name: "ID" },
        name: { type: "text", name: "Name", description: "Empty when the backup was not named" },
        created: { type: "timestamp", name: "Created" },
        size: { type: "number", name: "Size", description: "In bytes" },
    },
};

const LOG_FILE_TYPE: BlockTypeDefinition = {
    id: "log-file",
    name: "Log File",
    icon: "description",
    base: "object",
    fields: {
        name: { type: "text", name: "Name" },
        size: { type: "number", name: "Size", description: "In bytes" },
        modified: { type: "timestamp", name: "Modified" },
    },
};

/** The types every game's blocks use. A game adds its own through blockTypes(). */
export const SHARED_TYPES: BlockTypeDefinition[] = [PLAYER_TYPE, BACKUP_TYPE, LOG_FILE_TYPE];

const backupValue = (record: BackupRecord) => ({
    id: record.id,
    name: record.label ?? "",
    created: Date.parse(record.createdAt),
    size: record.size,
});

/** What every server has, whatever its game. */
export function sharedBlocks(ctx: Context): BlockSet {
    return {
        values: [
            {
                id: "server-status",
                name: "Server Status",
                category: "Server",
                icon: "dns",
                description: "offline, starting, online, stopping or restarting",
                type: "text",
                changes: true,
                read: () => ctx.state.serverStatus,
            },
            {
                id: "player-count",
                name: "Player Count",
                category: "Players",
                icon: "tag",
                type: "number",
                changes: true,
                read: () => ctx.state.onlinePlayers.length,
            },
            {
                id: "online-players",
                name: "Online Players",
                category: "Players",
                icon: "group",
                type: "list<player>",
                changes: true,
                read: () => [...ctx.state.onlinePlayers],
            },
            {
                id: "backups",
                name: "Backups",
                category: "Backups",
                icon: "backup",
                description: "The server's backups, newest first",
                type: "list<backup>",
                read: async () => (await serverBackups().list()).map(backupValue),
            },
            {
                id: "log-files",
                name: "Log Files",
                category: "Logs",
                icon: "description",
                description: "The server's log files, newest first",
                type: "list<log-file>",
                read: async () => (await listLogFiles(ctx)).map((file) => ({ name: file.name, size: file.size, modified: file.mtimeMs })),
            },
            {
                id: "log",
                name: "Log",
                category: "Logs",
                icon: "article",
                description: "What a log file says: the end of a long one, all of an archived one",
                text: "Log {file}",
                inputs: { file: { type: "text", name: "Log File" } },
                type: "text",
                read: async ({ file }: { file: string }) => (await readLogFile(ctx, file)).content,
            },
        ],
        commands: [
            {
                id: "start-server",
                name: "Start the Server",
                category: "Server",
                icon: "power",
                description: "Launches the server; it is online once it finishes starting",
                run: async () => {
                    await startServerInstance(ctx);
                    // a launch that fails says why in the console and leaves the server offline
                    if (ctx.state.serverStatus === "offline") throw new Error("The server did not start; its console says why");
                },
            },
            {
                id: "stop-server",
                name: "Stop the Server",
                category: "Server",
                icon: "stop",
                description: "Saves and stops the server",
                run: () => stopServerInstance(ctx),
            },
            {
                id: "restart-server",
                name: "Restart the Server",
                category: "Server",
                icon: "restart_alt",
                description: "Stops the running server and starts it again",
                run: async () => {
                    if (ctx.state.serverStatus !== "online") throw new Error("The server is not online, so it can't restart");
                    await restartServerInstance(ctx);
                },
            },
            {
                id: "save-world",
                name: "Save the World",
                category: "Server",
                icon: "save",
                description: "Writes the running world to disk, once the server confirms it",
                run: () => currentGameService().saveWorld(ctx),
            },
            {
                id: "run-command",
                name: "Run Command",
                category: "Server",
                icon: "terminal",
                description: "Runs a console command on the server",
                text: "Run {command}",
                inputs: { command: { type: "text", name: "Command" } },
                run: ({ command }: { command: string }) => sendServerCommand(ctx, command),
            },
            {
                id: "say",
                name: "Say",
                category: "Chat",
                icon: "chat",
                description: "Says a message to everyone in the game",
                text: "Say {message}",
                inputs: { message: { type: "text", name: "Message", maxLength: 500 } },
                run: async ({ message }: { message: string }) => {
                    await sayInChat(ctx, message);
                },
            },
            {
                id: "back-up",
                name: "Back Up the Server",
                category: "Backups",
                icon: "backup",
                description: "Backs the server up to where its backups go",
                text: "Back up the server as {name}",
                inputs: { name: { type: "text", name: "Name", optional: true, maxLength: 128 } },
                output: "backup",
                run: async ({ name }: { name?: string }) => backupValue(await serverBackups().create(name ? { label: name } : {})),
            },
        ],
        events: [
            { id: TRIGGER_IDS.serverStarted, name: "When the Server Starts", category: "Server", icon: "play_arrow", description: "Runs once the server has finished starting" },
            { id: TRIGGER_IDS.serverStopped, name: "When the Server Stops", category: "Server", icon: "stop", description: "Runs when the server's process ends, however it ended" },
            { id: TRIGGER_IDS.serverCrashed, name: "When the Server Crashes", category: "Server", icon: "error", description: "Runs when the server stops without being asked to" },
        ],
    };
}

/**
 * Joins, leaves and chat, for a game that tells them apart in its console
 * or its API. A game includes these in its blocks() once it emits them.
 */
export function playerEvents(): BlockEventDefinition[] {
    return [
        {
            id: TRIGGER_IDS.playerJoined,
            name: "When a Player Joins",
            category: "Players",
            icon: "person_add",
            text: "When {player} joins",
            inputs: { player: { type: "player", name: "Player", optional: true } },
            values: { player: { type: "player", name: "Player" } },
            filters: { player: "player" },
        },
        {
            id: TRIGGER_IDS.playerLeft,
            name: "When a Player Leaves",
            category: "Players",
            icon: "logout",
            text: "When {player} leaves",
            inputs: { player: { type: "player", name: "Player", optional: true } },
            values: { player: { type: "player", name: "Player" } },
            filters: { player: "player" },
        },
        {
            id: TRIGGER_IDS.chatMessage,
            name: "When a Player Chats",
            category: "Chat",
            icon: "chat",
            text: "When {player} says {message}",
            inputs: {
                player: { type: "player", name: "Player", optional: true },
                message: { type: "text", name: "Message", optional: true },
            },
            values: {
                player: { type: "player", name: "Player" },
                message: { type: "text", name: "Message" },
            },
            filters: { player: "player", message: "message" },
        },
    ];
}

/** Every set as one: a game's blocks beside the shared ones. */
export function mergeBlocks(...sets: (BlockSet | undefined)[]): BlockSet {
    return {
        commands: sets.flatMap((s) => s?.commands ?? []),
        values: sets.flatMap((s) => s?.values ?? []),
        events: sets.flatMap((s) => s?.events ?? []),
    };
}

/**
 * A block that only works where the game offers the Action (v1) it shares
 * its work with, such as plugins on a server software that has them.
 */
export function needsAction<T extends BlockCommandDefinition | BlockValueDefinition>(ctx: Context, actionId: string, def: T): T {
    const check = () => {
        const scope = currentServer();
        if (!scope) throw new Error(`${def.name} needs a server`);
        assertGameAction(gameFor(scope.server.game), { settings: ctx.state.gameSettings, software: ctx.state.serverSoftware, version: ctx.state.serverVersion }, actionId);
    };
    if ("run" in def) {
        const run = def.run;
        return { ...def, run: (inputs: unknown, block: unknown) => (check(), run(inputs, block as never)) };
    }
    const read = def.read;
    return { ...def, read: (inputs: unknown, block: unknown) => (check(), read(inputs, block as never)) };
}

/**
 * The set as it runs for one server: in that server's scope, refused once
 * it is being removed, and a command counts as the server's operation while
 * it runs (removal waits for it).
 */
export function bindBlocks(scope: ServerScope, set: BlockSet): BlockSet {
    const live = () => {
        if (scope.removing) throw new Error("This server was removed or is being removed");
    };
    return {
        ...set,
        commands: set.commands?.map((command) => ({
            ...command,
            run: async (inputs, ctx) => {
                live();
                scope.activeOperations++;
                try {
                    return await inServer(scope, () => command.run(inputs, ctx));
                } finally {
                    scope.activeOperations--;
                }
            },
        })),
        values: set.values?.map((value) => ({
            ...value,
            read: (inputs, ctx) => {
                live();
                return inServer(scope, () => value.read(inputs, ctx));
            },
        })),
    };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((p, i) => p === b[i]);

/** Tells the Blocks panel which values changed with this state change. */
export function announceChanges(blocks: BlocksProjectHandle | undefined, before: GameServerState, after: GameServerState, serverName: string): void {
    if (!blocks) return;
    const changed: string[] = [];
    if (before.serverStatus !== after.serverStatus) changed.push("server-status");
    if (before.onlinePlayers !== after.onlinePlayers && !sameList(before.onlinePlayers, after.onlinePlayers)) {
        changed.push("online-players");
        if (before.onlinePlayers.length !== after.onlinePlayers.length) changed.push("player-count");
    }
    for (const value of changed) {
        blocks.changed(value).catch((err) => console.error(`[gameserver] ${serverName}: the change to ${value} did not reach Blocks:`, err));
    }
}

// what each trigger the games emit fires in Blocks: the event of the same id, with its values
const EVENT_VALUES: Record<TriggerId, (output: unknown) => Record<string, unknown>> = {
    [TRIGGER_IDS.playerJoined]: (player) => ({ player }),
    [TRIGGER_IDS.playerLeft]: (player) => ({ player }),
    [TRIGGER_IDS.chatMessage]: (chat) => ({ player: (chat as ChatMessage).sender, message: (chat as ChatMessage).content }),
    [TRIGGER_IDS.serverStarted]: () => ({}),
    [TRIGGER_IDS.serverStopped]: () => ({}),
    [TRIGGER_IDS.serverCrashed]: () => ({}),
};

/** Fires the Blocks event for a trigger a game emitted. */
export function fireTrigger(blocks: BlocksProjectHandle | undefined, id: string, output: unknown, serverName: string): void {
    if (!blocks) return;
    const values = EVENT_VALUES[id as TriggerId];
    if (!values) {
        console.error(`[gameserver] ${serverName}: the trigger ${id} has no Blocks event`);
        return;
    }
    blocks.fire(id, values(output)).catch((err) => console.error(`[gameserver] ${serverName}: ${id} did not reach Blocks:`, err));
}
