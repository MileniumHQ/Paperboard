import {
    defineType,
    defineAction,
    defineTrigger,
    type ActionDefinition,
    type TriggerDefinition,
    type CustomTypeDefinition,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import {
    startServerInstance,
    stopServerInstance,
    restartServerInstance,
    sendServerCommand,
    sendChatMessage,
} from "./lifecycle";
import {
    queryOnlinePlayers,
    queryPlayerStats,
    forgetPlayerData,
} from "./players";
import {
    clearActiveIssue,
    killConflictingProcess,
    resetWorldFiles,
} from "./diagnostics";
import { listInstalledPlugins, deletePlugin } from "./plugins";
import { listWorldDirs, deleteActiveWorldDirs } from "./worlds";
import { loadConfigAndProperties, updatePanelConfig } from "./config";
import type { GameServerState } from "./types";

export const playerType = defineType({
    id: "player",
    name: "Player",
    description: "Minecraft player username",
    base: "string",
});

export const messageType = defineType({
    id: "message",
    name: "Chat Message",
    description: "In-game chat message object",
    base: "object",
    defaultField: "content",
    toString: (msg: any) => msg?.content || msg?.text || String(msg || ""),
    fields: {
        content: { type: "string", label: "Message" },
        sender: { type: "player", label: "Sender" },
        timestamp: { type: "string", label: "Timestamp" },
    },
});

export const commandType = defineType({
    id: "command",
    name: "Console Command",
    description: "Minecraft console command string",
    base: "string",
});

export const customTypes: CustomTypeDefinition[] = [
    playerType,
    messageType,
    commandType,
];

export const panelActions: ActionDefinition[] = [
    defineAction({
        id: "run-command",
        name: "Run Command",
        description: "Executes a raw console command on the server instance",
        template: "Execute command {command}",
        inputs: {
            command: {
                type: "string",
                label: "Command",
                placeholder: "say Hello!",
                required: true,
            },
        },
        output: {
            type: "string",
            label: "Command Result",
        },
        quick: false,
        icon: "terminal",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { command: string } | string,
        ) => {
            const cmd = typeof inputs === "string" ? inputs : inputs?.command || "";
            await sendServerCommand(ctx, cmd);
            return `Executed: ${cmd}`;
        },
    }),

    defineAction({
        id: "start-server",
        name: "Start the server",
        description: "Launches the game server process",
        template: "Start the server",
        writtenOut: "Start the server",
        output: {
            type: "boolean",
            label: "Started",
        },
        quick: true,
        icon: "power",
        run: async (ctx: ServiceContext<GameServerState>) => {
            await startServerInstance(ctx);
            return true;
        },
    }),

    defineAction({
        id: "stop-server",
        name: "Stop the server",
        description: "Gracefully stops the game server",
        template: "Stop the server",
        writtenOut: "Stop the server",
        output: {
            type: "boolean",
            label: "Stopped",
        },
        quick: true,
        icon: "stop",
        run: async (ctx: ServiceContext<GameServerState>) => {
            await stopServerInstance(ctx);
            return true;
        },
    }),

    defineAction({
        id: "restart-server",
        name: "Restart the server",
        description: "Restarts the running server",
        template: "Restart the server",
        writtenOut: "Restart the server",
        output: {
            type: "boolean",
            label: "Restarted",
        },
        quick: true,
        icon: "restart_alt",
        run: async (ctx: ServiceContext<GameServerState>) => {
            await restartServerInstance(ctx);
            return true;
        },
    }),

    defineAction({
        id: "load-config",
        name: "Reload Configuration",
        description: "Reloads server properties and panel config",
        template: "Reload server configuration",
        writtenOut: "Reload server configuration",
        output: { type: "boolean", label: "Success" },
        run: async (ctx) => {
            await loadConfigAndProperties(ctx);
            return true;
        },
    }),

    defineAction({
        id: "say-chat",
        name: "Send Chat Message",
        description: "Broadcasts a chat message to all players in game",
        template: "Say {message}",
        inputs: {
            message: {
                type: "string",
                label: "Message",
                placeholder: "Hello everyone!",
                required: true,
            },
        },
        output: {
            type: "string",
            label: "Sent Message",
        },
        quick: false,
        icon: "chat",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { message: string },
        ) => {
            const msg = (inputs?.message || "").trim();
            await sendChatMessage(ctx, msg);
            return msg;
        },
    }),

    defineAction({
        id: "kick-player",
        name: "Kick Player",
        description: "Kicks a player from the server with an optional reason",
        template: "Kick {player}",
        inputs: {
            player: {
                type: "string",
                label: "Player",
                placeholder: "Player",
                required: true,
            },
            reason: {
                type: "string",
                label: "Reason",
                placeholder: "Reason",
            },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        quick: false,
        icon: "person_remove",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { player: string; reason?: string },
        ) => {
            const name = (inputs?.player || "").trim();
            if (!name) throw new Error("Player name is required");
            const reason = (inputs?.reason || "").trim();
            await sendServerCommand(ctx, reason ? `kick ${name} ${reason}` : `kick ${name}`);
            return true;
        },
    }),

    defineAction({
        id: "ban-player",
        name: "Ban Player",
        description: "Bans a player from the server with an optional reason",
        template: "Ban {player}",
        inputs: {
            player: {
                type: "string",
                label: "Player",
                placeholder: "Player",
                required: true,
            },
            reason: {
                type: "string",
                label: "Reason",
                placeholder: "Reason",
            },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        quick: false,
        icon: "gavel",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { player: string; reason?: string },
        ) => {
            const name = (inputs?.player || "").trim();
            if (!name) throw new Error("Player name is required");
            const reason = (inputs?.reason || "").trim();
            await sendServerCommand(ctx, reason ? `ban ${name} ${reason}` : `ban ${name}`);
            return true;
        },
    }),

    defineAction({
        id: "list-players",
        name: "List Online Players",
        description: "Returns the usernames of currently online players",
        template: "List online players",
        writtenOut: "List online players",
        inputs: {},
        output: {
            type: "string",
            label: "Player List",
        },
        quick: false,
        icon: "group",
        run: async (ctx: ServiceContext<GameServerState>) => {
            queryOnlinePlayers(ctx);
            return (ctx.state.onlinePlayers || []).join(", ");
        },
    }),

    defineAction({
        id: "player-count",
        name: "Player Count",
        description: "Returns the number of currently online players",
        template: "Count online players",
        writtenOut: "Count online players",
        inputs: {},
        output: {
            type: "number",
            label: "Player Count",
        },
        quick: false,
        icon: "tag",
        run: async (ctx: ServiceContext<GameServerState>) => {
            return (ctx.state.onlinePlayers || []).length;
        },
    }),
];

export const panelTriggers: TriggerDefinition[] = [
    defineTrigger({
        id: "chat-message",
        name: "When Chat Message Sent",
        description: "Fires whenever an in-game player or server chat message is received",
        template: "When chat message {message} is sent",
        writtenOut: "When chat message {message} is sent",
        output: {
            type: "message",
            label: "message",
            description: "The received chat message object",
        },
        icon: "chat",
    }),

    defineTrigger({
        id: "player-joined",
        name: "When Player Joins",
        description: "Fires when a player connects and joins the game world",
        template: "When player {player} joins the server",
        writtenOut: "When player {player} joins the server",
        output: {
            type: "player",
            label: "Username",
            description: "Username of the connected player",
        },
        icon: "person_add",
    }),

    defineTrigger({
        id: "player-left",
        name: "When Player Leaves",
        description: "Fires when a player disconnects from the server",
        template: "When player {player} leaves the server",
        writtenOut: "When player {player} leaves the server",
        output: {
            type: "player",
            label: "Username",
            description: "Username of the disconnected player",
        },
        icon: "logout",
    }),

    defineTrigger({
        id: "server-started",
        name: "When Server Starts",
        description: "Fires when the server successfully finishes booting",
        template: "When the server starts",
        writtenOut: "When the server starts",
        output: {
            type: "boolean",
            label: "Is Online",
        },
        icon: "play_arrow",
    }),

    defineTrigger({
        id: "server-stopped",
        name: "When Server Stops",
        description: "Fires when the server process shuts down or stops",
        template: "When the server stops",
        writtenOut: "When the server stops",
        output: {
            type: "boolean",
            label: "Is Offline",
        },
        icon: "stop",
    }),
];
