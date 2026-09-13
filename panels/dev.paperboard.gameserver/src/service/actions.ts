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
    deletePlayerData,
} from "./players";
import {
    clearActiveIssue,
    killConflictingProcess,
    resetWorldFiles,
} from "./diagnostics";
import { listInstalledPlugins, deletePlugin } from "./plugins";
import { listWorldDirs, deleteActiveWorldDirs } from "./worlds";
import { loadConfigAndProperties, updatePanelConfig } from "./config";
import { queryGamerules, setGamerule } from "./gamerules";
import { assertPlayerName, assertSingleLine } from "../core/players";
import type { GameServerState } from "./types";
import { ACTION_IDS, TRIGGER_IDS } from "./contract";

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
        id: ACTION_IDS.runCommand,
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
        id: ACTION_IDS.startServer,
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
        id: ACTION_IDS.stopServer,
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
        id: ACTION_IDS.restartServer,
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
        id: ACTION_IDS.loadConfig,
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
        id: ACTION_IDS.sayChat,
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
            // single-line: a line break would inject a second console command
            const msg = assertSingleLine((inputs?.message || "").trim(), "chat message", 500);
            if (!msg) throw new Error("Message is required");
            await sendChatMessage(ctx, msg);
            return msg;
        },
    }),

    defineAction({
        id: ACTION_IDS.kickPlayer,
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
            const name = assertPlayerName(inputs?.player);
            const reason = inputs?.reason
                ? assertSingleLine(inputs.reason.trim(), "kick reason")
                : "";
            await sendServerCommand(ctx, reason ? `kick ${name} ${reason}` : `kick ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.banPlayer,
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
            const name = assertPlayerName(inputs?.player);
            const reason = inputs?.reason
                ? assertSingleLine(inputs.reason.trim(), "ban reason")
                : "";
            await sendServerCommand(ctx, reason ? `ban ${name} ${reason}` : `ban ${name}`);
            return true;
        },
    }),

    // player-flag actions: every one validates at this boundary — the UI
    // may never compose console commands from raw player names. Validated
    // kick/ban above set the pattern; op/deop/whitelist/pardon/kill follow it.
    defineAction({
        id: ACTION_IDS.opPlayer,
        name: "Op Player",
        description: "Grants operator status to a player",
        template: "Op {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "shield",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `op ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.deopPlayer,
        name: "Deop Player",
        description: "Revokes operator status from a player",
        template: "Deop {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "shield_person",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `deop ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.whitelistPlayer,
        name: "Whitelist Player",
        description: "Adds a player to the server whitelist",
        template: "Whitelist {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "verified_user",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `whitelist add ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.unwhitelistPlayer,
        name: "Unwhitelist Player",
        description: "Removes a player from the server whitelist",
        template: "Unwhitelist {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "user_off",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `whitelist remove ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.pardonPlayer,
        name: "Pardon Player",
        description: "Removes a player from the ban list",
        template: "Pardon {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "undo",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `pardon ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.killPlayer,
        name: "Kill Player",
        description: "Kills an online player in-game",
        template: "Kill {player}",
        inputs: {
            player: { type: "string", label: "Player", placeholder: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "heart_broken",
        run: async (ctx: ServiceContext<GameServerState>, inputs: { player: string }) => {
            const name = assertPlayerName(inputs?.player);
            await sendServerCommand(ctx, `kill ${name}`);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.listPlayers,
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
        id: ACTION_IDS.playerCount,
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

    // service-boundary actions: the panel UI calls every one of these
    // through serverBridge.call(ACTION_IDS.*). They are registered here —
    // never reached through the stringly actions.* proxy — so a missing
    // registration is a contract-test failure, not a silent no-op.

    defineAction({
        id: ACTION_IDS.killConflictingProcess,
        name: "Kill Conflicting Process",
        description: "Kills the process bound to the server port",
        template: "Kill conflicting process on {port}",
        inputs: {
            port: { type: "string", label: "Port", placeholder: "25565" },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "skull",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { port?: string },
        ) => {
            // the boolean is the real outcome: a failed kill is a false,
            // never a laundered true
            return killConflictingProcess(ctx, inputs?.port);
        },
    }),

    defineAction({
        id: ACTION_IDS.resetWorldFiles,
        name: "Reset World Files",
        description: "Deletes the live world directories (trash-first, recoverable on crash)",
        template: "Reset world files",
        writtenOut: "Reset world files",
        inputs: {},
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "restart_alt",
        run: async (ctx: ServiceContext<GameServerState>) => {
            return resetWorldFiles(ctx);
        },
    }),

    defineAction({
        id: ACTION_IDS.clearActiveIssue,
        name: "Clear Active Issue",
        description: "Dismisses the currently detected server issue",
        template: "Clear active issue",
        inputs: {},
        output: { type: "boolean", label: "Success" },
        quick: true,
        icon: "check",
        run: async (ctx: ServiceContext<GameServerState>) => {
            clearActiveIssue(ctx);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.updatePanelConfig,
        name: "Update Panel Config",
        description: "Merges a patch into the panel config and reloads",
        template: "Update panel config",
        inputs: {
            patch: { type: "object", label: "Patch" },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "settings",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { patch?: Record<string, unknown> },
        ) => {
            await updatePanelConfig(ctx, inputs?.patch ?? {});
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.listWorldDirs,
        name: "List World Directories",
        description: "Lists world directories on disk",
        template: "List world directories",
        inputs: {},
        output: { type: "object", label: "Worlds" },
        quick: false,
        icon: "folder",
        run: async () => {
            return listWorldDirs();
        },
    }),

    defineAction({
        id: ACTION_IDS.deleteWorld,
        name: "Delete World",
        description: "Deletes a world's directories (trash-first, recoverable on crash)",
        template: "Delete world {levelName}",
        inputs: {
            levelName: { type: "string", label: "World Name", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "delete",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { levelName: string },
        ) => {
            if (!inputs?.levelName) throw new Error("World name is required");
            await deleteActiveWorldDirs(ctx, inputs.levelName);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.listInstalledPlugins,
        name: "List Installed Plugins",
        description: "Lists installed server plugins",
        template: "List installed plugins",
        inputs: {},
        output: { type: "object", label: "Plugins" },
        quick: false,
        icon: "extension",
        run: async (ctx: ServiceContext<GameServerState>) => {
            return listInstalledPlugins(ctx);
        },
    }),

    defineAction({
        id: ACTION_IDS.deletePlugin,
        name: "Delete Plugin",
        description: "Deletes a plugin jar (trash-first, recoverable on crash)",
        template: "Delete plugin {filename}",
        inputs: {
            filename: { type: "string", label: "Filename", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "delete",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { filename: string },
        ) => {
            if (!inputs?.filename) throw new Error("Filename is required");
            await deletePlugin(ctx, inputs.filename);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.deletePlayerData,
        name: "Delete Player Data",
        description: "Deletes a player's data files (trash-first, recoverable on crash)",
        template: "Delete data for {player}",
        inputs: {
            player: { type: "string", label: "Player", required: true },
            uuid: { type: "string", label: "UUID", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "person_remove",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { player: string; uuid: string },
        ) => {
            await deletePlayerData(ctx, inputs?.player, inputs?.uuid);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.forgetPlayerData,
        name: "Forget Player",
        description: "Drops a player from the panel's tracked presence",
        template: "Forget player {player}",
        inputs: {
            player: { type: "string", label: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "person_off",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { player: string },
        ) => {
            forgetPlayerData(ctx, inputs?.player);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.queryPlayerStats,
        name: "Query Player Stats",
        description: "Queries a player's live stats from the server",
        template: "Query stats for {player}",
        inputs: {
            player: { type: "string", label: "Player", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "query_stats",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { player: string },
        ) => {
            queryPlayerStats(ctx, inputs?.player);
            return true;
        },
    }),

    defineAction({
        id: ACTION_IDS.queryOnlinePlayers,
        name: "Query Online Players",
        description: "Refreshes the online player list from the server",
        template: "Query online players",
        inputs: {},
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "group",
        run: async (ctx: ServiceContext<GameServerState>) => {
            queryOnlinePlayers(ctx);
            return true;
        },
    }),

    // game rules: the service owns the console and the config, so the UI
    // never writes gamerule commands itself — offline edits persist and
    // re-apply at next boot instead of looking applied and vanishing
    defineAction({
        id: ACTION_IDS.queryGamerules,
        name: "Query Game Rules",
        description: "Reads current game rule values from the running server",
        template: "Query game rules",
        inputs: {
            names: { type: "object", label: "Rule names" },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "list_alt_check",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { names?: string[] },
        ) => {
            return queryGamerules(ctx, Array.isArray(inputs?.names) ? inputs.names : []);
        },
    }),

    defineAction({
        id: ACTION_IDS.setGamerule,
        name: "Set Game Rule",
        description: "Sets a game rule live, or saves it for the next server start when offline",
        template: "Set game rule {name} to {value}",
        inputs: {
            name: { type: "string", label: "Rule", required: true },
            value: { type: "string", label: "Value", required: true },
        },
        output: { type: "boolean", label: "Success" },
        quick: false,
        icon: "list_alt_check",
        run: async (
            ctx: ServiceContext<GameServerState>,
            inputs: { name?: string; value?: string },
        ) => {
            if (!inputs?.name || !inputs?.value) {
                throw new Error("Game rule name and value are required");
            }
            return setGamerule(ctx, inputs.name, inputs.value);
        },
    }),
];

export const panelTriggers: TriggerDefinition[] = [
    defineTrigger({
        id: TRIGGER_IDS.chatMessage,
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
        id: TRIGGER_IDS.playerJoined,
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
        id: TRIGGER_IDS.playerLeft,
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
        id: TRIGGER_IDS.serverStarted,
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
        id: TRIGGER_IDS.serverStopped,
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
