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
import type { BackupEnded, BackupRecord } from "@mileniumhq/paperapi";
import { MAX_BUFFERED_ENTRIES, type ChatMessage, type GameServerState } from "./types";
import type { ServerScope } from "./scope";
import { currentServer, inServer } from "./scope";
import { ACTION_IDS, TRIGGER_IDS, type TriggerId } from "./contract";
import { restartServerInstance, sendServerCommand, startServerInstance, stopServerInstance } from "./lifecycle";
import { listLogFiles, readLogFile } from "./logs";
import { sayInChat, serverBackups } from "./actions";
import { automationView, readAutomation, writeAutomation } from "./automation";
import { currentGameService } from "../games/service";
import { assertGameAction, gameFor } from "../games";

type Context = ServiceContext<GameServerState>;

/**
 * A player, by the name the server knows them by. The panel's own type.
 * Whether they're online depends on the server asking, so it's per project.
 */
function playerType(onlinePlayers: (server: string) => readonly string[]): BlockTypeDefinition<string> {
    return {
        id: "player",
        name: "Player",
        icon: "person",
        base: "text",
        fields: {
            online: {
                type: "boolean",
                name: "Online",
                description: "On this server, right now",
                perProject: true,
                resolve: (name, { project }) => onlinePlayers(project!).includes(name),
            },
        },
    };
}

// A backup is its record as Paperboard keeps it: a block that backs up or
// restores is answered with the record by Paperboard itself when the backup
// stopped the service, so every backup block passes the record as it is.
const BACKUP_TYPE: BlockTypeDefinition<BackupRecord> = {
    id: "backup",
    name: "Backup",
    icon: "backup",
    base: "object",
    fields: {
        id: { type: "text", name: "ID" },
        name: { type: "text", name: "Name", description: "A backup nobody named has none", optional: true, resolve: (record) => record.label ?? null },
        created: { type: "timestamp", name: "Created", resolve: (record) => Date.parse(record.createdAt) },
        size: { type: "number", name: "Size", description: "In bytes" },
    },
};

const BACKUP_EVENTS = { finished: "backup-finished", failed: "backup-failed" } as const;

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

const AUTOMATION_TYPE: BlockTypeDefinition = {
    id: "automation",
    name: "Automation",
    icon: "autorenew",
    description: "What a server does on its own",
    base: "object",
    fields: {
        "restart-after-crash": { type: "boolean", name: "Restart After a Crash" },
        "daily-restart": { type: "text", name: "Daily Restart", description: "The hour it restarts each day, as 04:00; none when it doesn't", optional: true },
        "automatic-updates": { type: "boolean", name: "Automatic Updates", description: "Always off for a game that can't update itself" },
        "time-zone": { type: "text", name: "Time Zone", description: "The computer's, which the daily restart hour is on" },
    },
};

/** The types every game's blocks use, reading who's online on each server. A game adds its own through blockTypes(). */
export function sharedTypes(onlinePlayers: (server: string) => readonly string[]): BlockTypeDefinition[] {
    return [playerType(onlinePlayers), BACKUP_TYPE, LOG_FILE_TYPE, AUTOMATION_TYPE];
}

/** The server's automation as its value reads. */
async function automationValue() {
    const view = automationView(await readAutomation());
    return {
        "restart-after-crash": view.restartAfterCrash,
        "daily-restart": view.dailyRestart,
        "automatic-updates": view.canUpdate && view.autoUpdate,
        "time-zone": view.timeZone,
    };
}

const DAILY_RESTART_CHOICES = [
    { label: "never", value: "never" },
    ...Array.from({ length: 24 }, (_, hour) => {
        const at = `${String(hour).padStart(2, "0")}:00`;
        return { label: `at ${at}`, value: at };
    }),
];

/** Launches the server and waits for it to be online, as Start the Server does. */
export async function startFromBlocks(ctx: Context): Promise<void> {
    await startServerInstance(ctx);
    // a launch that fails says why in the console and leaves the server offline
    if (ctx.state.serverStatus === "offline") throw new Error("The server did not start; its console says why");
}

/** Restarts a server that is online, as Restart the Server does. */
export async function restartFromBlocks(ctx: Context): Promise<void> {
    if (ctx.state.serverStatus !== "online") throw new Error("The server is not online, so it can't restart");
    await restartServerInstance(ctx);
}

/** The backup a block was given, as one this server has. */
function backupId(backup: unknown): string {
    const id = (backup as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !id) throw new Error("Give a backup of this server");
    return id;
}

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
                read: () => serverBackups().list(),
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
            {
                id: "console-output",
                name: "Console Output",
                category: "Logs",
                icon: "terminal",
                description: "The last lines the server's console showed, oldest first",
                text: "last {lines} lines of the console",
                inputs: { lines: { type: "number", name: "Lines", integer: true, min: 1, max: MAX_BUFFERED_ENTRIES, default: 50 } },
                type: "text",
                read: ({ lines }: { lines: number }) =>
                    ctx.state.serverEntries
                        .slice(-lines)
                        .map((entry) => (typeof entry.content === "string" ? entry.content : ""))
                        .join("\n"),
            },
            needsAction(ctx, ACTION_IDS.readAutomation, {
                id: "automation",
                name: "Automation",
                category: "Automation",
                icon: "autorenew",
                description: "Whether the server restarts after a crash, the hour it restarts each day, and whether it updates itself",
                type: "automation",
                read: () => automationValue(),
            }),
        ],
        commands: [
            {
                id: "start-server",
                name: "Start the Server",
                category: "Server",
                icon: "power",
                description: "Launches the server; it is online once it finishes starting",
                run: () => startFromBlocks(ctx),
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
                run: () => restartFromBlocks(ctx),
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
                run: ({ name }: { name?: string }) => serverBackups().create(name ? { label: name } : {}),
            },
            {
                id: "restore-backup",
                name: "Restore Backup",
                category: "Backups",
                icon: "settings_backup_restore",
                description: "Puts the server's files and settings back as they were in one of its backups. A running server is stopped for it",
                text: "Restore {backup}",
                inputs: { backup: { type: "backup", name: "Backup" } },
                output: "backup",
                run: ({ backup }: { backup: unknown }) => serverBackups().restore(backupId(backup)),
            },
            {
                id: "delete-backup",
                name: "Delete Backup",
                category: "Backups",
                icon: "delete",
                description: "Deletes one of the server's backups from where its backups go. It can't be brought back",
                text: "Delete {backup}",
                inputs: { backup: { type: "backup", name: "Backup" } },
                run: async ({ backup }: { backup: unknown }) => {
                    await serverBackups().delete(backupId(backup));
                },
            },
            needsAction(ctx, ACTION_IDS.writeAutomation, {
                id: "set-restart-after-crash",
                name: "Set Restart After a Crash",
                category: "Automation",
                icon: "restart_alt",
                description: "Whether the server starts again on its own after it crashes",
                text: "{restart} after a crash",
                inputs: {
                    restart: {
                        type: "boolean",
                        name: "Restart After a Crash",
                        choices: [{ label: "restart", value: true }, { label: "stay offline", value: false }],
                    },
                },
                run: async ({ restart }: { restart: boolean }) => {
                    await writeAutomation(ctx, { restartAfterCrash: restart }, restartServerInstance);
                },
            }),
            needsAction(ctx, ACTION_IDS.writeAutomation, {
                id: "set-daily-restart",
                name: "Set Daily Restart",
                category: "Automation",
                icon: "schedule",
                description: "The hour a running server restarts each day, on the computer's clock. Players are warned before it does",
                text: "Restart the server daily {hour}",
                inputs: { hour: { type: "text", name: "Daily Restart", choices: DAILY_RESTART_CHOICES } },
                run: async ({ hour }: { hour: string }) => {
                    await writeAutomation(ctx, { dailyRestart: hour === "never" ? null : hour }, restartServerInstance);
                },
            }),
            needsAction(ctx, ACTION_IDS.writeAutomation, {
                id: "set-automatic-updates",
                name: "Set Automatic Updates",
                category: "Automation",
                icon: "update",
                description: "Whether the server installs a newer build before each start, restarting a running server for one. Only for games that can update themselves",
                text: "{update} automatically",
                inputs: {
                    update: {
                        type: "boolean",
                        name: "Automatic Updates",
                        choices: [{ label: "update", value: true }, { label: "don't update", value: false }],
                    },
                },
                run: async ({ update }: { update: boolean }) => {
                    if (!automationView(await readAutomation()).canUpdate) throw new Error("This game can't update itself, so it has no automatic updates");
                    await writeAutomation(ctx, { autoUpdate: update }, restartServerInstance);
                },
            }),
        ],
        events: [
            { id: TRIGGER_IDS.serverStarted, name: "When the Server Starts", category: "Server", icon: "play_arrow", description: "Runs once the server has finished starting" },
            { id: TRIGGER_IDS.serverStopped, name: "When the Server Stops", category: "Server", icon: "stop", description: "Runs when the server's process ends, however it ended" },
            { id: TRIGGER_IDS.serverCrashed, name: "When the Server Crashes", category: "Server", icon: "error", description: "Runs when the server stops without being asked to" },
            {
                id: BACKUP_EVENTS.finished,
                name: "When a Backup Finishes",
                category: "Backups",
                icon: "backup",
                description: "Runs once a backup of the server is saved where its backups go, whoever started it",
                values: { backup: { type: "backup", name: "Backup" } },
            },
            {
                id: BACKUP_EVENTS.failed,
                name: "When a Backup Fails",
                category: "Backups",
                icon: "error",
                description: "Runs when a backup of the server could not be made, whoever started it",
                values: { error: { type: "text", name: "Error" } },
            },
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

/** Runs one of the game's Actions (v1) the way its tab does, so a block is checked as the tab's edit is. */
export async function runGameAction<T>(ctx: Context, id: string, inputs: Record<string, unknown>): Promise<T> {
    const action = (await currentGameService().actions()).find((a) => a.id === id);
    if (!action?.run) throw new Error(`${gameFor(currentServer()!.server.game).name} has no "${id}" action`);
    return (await action.run(ctx, inputs)) as T;
}

/** How a game kicks, bans and unbans a player by the name Blocks knows them by, and who it has banned. */
export interface PlayerRoster {
    kick(player: string): Promise<unknown>;
    ban(player: string): Promise<unknown>;
    unban(player: string): Promise<unknown>;
    banned(): Promise<string[]>;
}

/** Kick, ban and unban, and the banned players, for a game whose Players tab has them. */
export function rosterBlocks(roster: PlayerRoster): BlockSet {
    const player = { type: "player", name: "Player" } as const;
    const command = (id: string, name: string, icon: string, description: string, text: string, run: (player: string) => Promise<unknown>): BlockCommandDefinition => ({
        id, name, category: "Players", icon, description, text, inputs: { player }, run: async ({ player }: { player: string }) => void (await run(player)),
    });
    return {
        commands: [
            command("kick-player", "Kick Player", "person_remove", "Disconnects a player from the server", "Kick {player}", roster.kick),
            command("ban-player", "Ban Player", "gavel", "Bans a player from the server, and disconnects them if they're on it", "Ban {player}", roster.ban),
            command("unban-player", "Unban Player", "undo", "Lets a banned player join again", "Unban {player}", roster.unban),
        ],
        values: [
            {
                id: "banned-players",
                name: "Banned Players",
                category: "Players",
                icon: "block",
                description: "The players banned from the server, as the Players tab lists them",
                type: "list<player>",
                read: () => roster.banned(),
            },
        ],
    };
}

/**
 * The one id a game knows a player by, from the players with that name; a
 * name two players share is refused, since a block can't tell them apart.
 */
export function onlyIdNamed<T>(name: string, players: readonly T[], nameOf: (p: T) => string, idOf: (p: T) => string, where: string): string {
    const ids = [...new Set(players.filter((p) => nameOf(p) === name).map(idOf))];
    if (ids.length === 0) throw new Error(`There's no player named ${name} ${where}`);
    if (ids.length > 1) throw new Error(`${ids.length} players are named ${name}; use the Players tab to pick one`);
    return ids[0]!;
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

const live = (scope: ServerScope) => {
    if (scope.removing) throw new Error("This server was removed or is being removed");
};

/**
 * Runs work as one of the server's operations: in its scope, refused once
 * it is being removed, and counted while it runs (removal waits for it).
 */
export async function serverOperation<T>(scope: ServerScope, work: () => T | Promise<T>): Promise<T> {
    live(scope);
    scope.activeOperations++;
    try {
        return await inServer(scope, work);
    } finally {
        scope.activeOperations--;
    }
}

/**
 * The set as it runs for one server: a command is one of its operations,
 * and a value is read in its scope, refused once it is being removed.
 */
export function bindBlocks(scope: ServerScope, set: BlockSet): BlockSet {
    // choices worked out on demand are asked in the server too
    const inputs = <T extends { inputs?: BlockCommandDefinition["inputs"] }>(def: T): T => {
        if (!def.inputs) return def;
        const bound = Object.fromEntries(
            Object.entries(def.inputs).map(([key, input]) => {
                const choices = input.choices;
                if (typeof choices !== "function") return [key, input];
                return [key, { ...input, choices: (ctx: Parameters<typeof choices>[0]) => (live(scope), inServer(scope, () => choices(ctx))) }];
            }),
        );
        return { ...def, inputs: bound };
    };
    return {
        ...set,
        events: set.events?.map(inputs),
        commands: set.commands?.map(inputs).map((command) => ({
            ...command,
            run: (inputs, ctx) => serverOperation(scope, () => command.run(inputs, ctx)),
        })),
        values: set.values?.map(inputs).map((value) => ({
            ...value,
            read: (inputs, ctx) => {
                live(scope);
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

/** Fires When a Backup Finishes or When a Backup Fails for how a backup of the server ended. */
export function fireBackupEnded(blocks: BlocksProjectHandle | undefined, ended: BackupEnded, serverName: string): void {
    if (!blocks) return;
    const event = ended.ok ? BACKUP_EVENTS.finished : BACKUP_EVENTS.failed;
    blocks.fire(event, ended.ok ? { backup: ended.backup } : { error: ended.error })
        .catch((err) => console.error(`[gameserver] ${serverName}: ${event} did not reach Blocks:`, err));
}

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
