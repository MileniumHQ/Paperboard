// The blocks that run Bot Creator itself: turning bots on and off,
// deleting them, and their slash commands, and the panel-wide set that
// holds them with the types and the builders. A bot is added, and its token
// replaced, in Bot Creator only: a token typed into a flow would be saved in
// it as plain text.
import type { BlockCommandDefinition, BlockEventDefinition, BlockSet, BlockTypeDefinition, BlockValueDefinition } from "@mileniumhq/paperapi";
import type { BotSummary } from "../bots";
import { COMMAND_OPTION_TYPES, COMMAND_OPTION_TYPE_LABELS, GLOBAL_SCOPE, type CommandMutationResult, type SlashCommandDefinition } from "../types";
import type { Inputs } from "./bot";
import { builderValues, choice } from "./builders";
import { blockTypes, optionalId, type ConnectedClients } from "./blockTypes";

// ─── the bots themselves: everything the home screen does ──────────────────

/** One bot as the panel's own blocks read it. */
export interface BotView {
    summary: BotSummary;
    /** the servers it is in now; none while it's offline */
    servers: string[];
    commands: SlashCommandDefinition[];
    /** how long it has been online; 0 while it isn't */
    uptime: number;
}

/** What the panel's bot blocks run against: the service's own bot list and the code its home screen uses. */
export interface BotsBlocksHost {
    /** every bot's id, oldest first */
    ids(): string[];
    /** the bot, or why there is none */
    bot(id: unknown): BotView;
    remove(id: string): Promise<void>;
    setOn(id: string, on: boolean): Promise<void>;
    restart(id: string): Promise<void>;
    createCommand(id: string, input: Record<string, unknown>): Promise<CommandMutationResult>;
    deleteCommand(id: string, commandId: string): Promise<CommandMutationResult>;
    inviteLink(id: string, permissions: string[] | undefined): Promise<string>;
    userInstallLink(id: string): string;
}

/** A slash command, as a value carrying the bot it belongs to, so it can be deleted by itself. */
interface SlashCommandValue {
    id: string;
    bot: string;
    name: string;
    description: string;
    server: string | null;
    "usable-in-dms": boolean;
}

function slashCommandValue(bot: string, command: SlashCommandDefinition): SlashCommandValue {
    return {
        id: command.id,
        bot,
        name: command.name,
        description: command.description,
        server: command.scope === GLOBAL_SCOPE ? null : command.scope,
        "usable-in-dms": command.userInstall,
    };
}

export type BotStatus = "online" | "connecting" | "offline" | "turned off";

/** What the Status of a Bot says. */
export function botStatus(summary: BotSummary): BotStatus {
    if (summary.connected) return "online";
    if (summary.connecting) return "connecting";
    return summary.enabled ? "offline" : "turned off";
}

/** The bot types: a Bot, its slash commands, and an option for one. */
function botTypes(host: BotsBlocksHost): BlockTypeDefinition[] {
    const of = (id: string) => host.bot(id);
    return [
        {
            id: "bot",
            name: "Bot",
            icon: "smart_toy",
            description: "One of Bot Creator's bots",
            base: "text",
            choices: () => host.ids().map((id) => choice(host.bot(id).summary.name, id)),
            fields: {
                name: { type: "text", name: "Name", description: "Its Discord username, as of its last login", resolve: (v: string) => of(v).summary.name },
                online: { type: "boolean", name: "Online", description: "Connected to Discord right now", resolve: (v: string) => of(v).summary.connected },
                "turned-on": {
                    type: "boolean",
                    name: "Turned On",
                    description: "Goes online whenever Paperboard runs, until it's turned off",
                    resolve: (v: string) => of(v).summary.enabled,
                },
                status: { type: "text", name: "Status", description: "online, connecting, offline or turned off", resolve: (v: string) => botStatus(of(v).summary) },
                error: {
                    type: "text",
                    name: "Last Error",
                    description: "Why it last failed to connect or run; none when nothing failed",
                    optional: true,
                    resolve: (v: string) => of(v).summary.lastError,
                },
                user: {
                    type: "user",
                    name: "Discord User",
                    description: "None until it has logged in once",
                    optional: true,
                    resolve: (v: string) => of(v).summary.applicationId || null,
                },
                avatar: { type: "url", name: "Avatar", description: "None for Discord's default avatar", optional: true, resolve: (v: string) => of(v).summary.avatar || null },
                servers: { type: "list<server>", name: "Servers", description: "The servers it is in; none while it's offline", resolve: (v: string) => of(v).servers },
                "server-count": { type: "number", name: "Server Count", resolve: (v: string) => of(v).servers.length },
                "slash-commands": {
                    type: "list<slash-command>",
                    name: "Slash Commands",
                    resolve: (v: string) => of(v).commands.map((command) => slashCommandValue(v, command)),
                },
                uptime: { type: "duration", name: "Uptime", description: "0 while it's offline", resolve: (v: string) => of(v).uptime },
                added: { type: "timestamp", name: "Added", description: "When it was added to Bot Creator", resolve: (v: string) => of(v).summary.createdAt },
                "user-install-link": {
                    type: "url",
                    name: "User Install Link",
                    description: "Adds its slash commands to someone's own account. User Install must be on in Discord's developer portal",
                    resolve: (v: string) => host.userInstallLink(of(v).summary.id),
                },
            },
        },
        {
            id: "slash-command",
            name: "Slash Command",
            icon: "terminal",
            description: "One of a bot's slash commands",
            base: "object",
            fields: {
                name: { type: "text", name: "Name" },
                description: { type: "text", name: "Description" },
                bot: { type: "bot", name: "Bot" },
                server: { type: "server", name: "Server", description: "None when it's in every server", optional: true },
                "usable-in-dms": { type: "boolean", name: "Usable in DMs" },
            },
        },
        {
            id: "command-option",
            name: "Command Option",
            icon: "tune",
            description: "Something a slash command asks for",
            base: "object",
            fields: {
                name: { type: "text", name: "Name" },
                description: { type: "text", name: "Description" },
                type: { type: "text", name: "Type" },
                required: { type: "boolean", name: "Required" },
            },
        },
    ];
}

const botInput = { type: "bot", name: "Bot" } as const;

/** Every command a block made, or why Discord or Blocks didn't take it. */
function committed(result: CommandMutationResult, what: string): CommandMutationResult {
    if (result.syncError) throw new Error(`${what} is saved, but Discord refused it: ${result.syncError}`);
    if (result.triggerError) throw new Error(`${what} is saved, but its event isn't: ${result.triggerError}`);
    return result;
}

/** The blocks that run Bot Creator itself: its bots and their slash commands. */
export function botsBlocks(host: BotsBlocksHost): BlockSet {
    const idOfBot = (value: unknown) => host.bot(value).summary.id;
    const commands: BlockCommandDefinition<Inputs>[] = [
        {
            id: "turn-on-bot",
            name: "Turn On Bot",
            category: "Bots",
            icon: "power",
            description: "Logs the bot in. It stays on whenever Paperboard runs, until it's turned off",
            text: "Turn on {bot}",
            inputs: { bot: botInput },
            run: (i) => host.setOn(idOfBot(i.bot), true),
        },
        {
            id: "turn-off-bot",
            name: "Turn Off Bot",
            category: "Bots",
            icon: "power_settings_new",
            description: "Logs the bot out. It stays off until it's turned on again",
            text: "Turn off {bot}",
            inputs: { bot: botInput },
            run: (i) => host.setOn(idOfBot(i.bot), false),
        },
        {
            id: "restart-bot",
            name: "Restart Bot",
            category: "Bots",
            icon: "restart_alt",
            description: "Logs a bot that's on out of Discord and back in",
            text: "Restart {bot}",
            inputs: { bot: botInput },
            run: (i) => host.restart(idOfBot(i.bot)),
        },
        {
            id: "delete-bot",
            name: "Delete Bot",
            category: "Bots",
            icon: "delete",
            description: "Removes the bot's slash commands from Discord, stops it, and removes it and its token from Bot Creator. Its flows stop working. If Discord won't take its commands off, the bot is kept",
            text: "Delete {bot}",
            inputs: { bot: botInput },
            run: (i) => host.remove(idOfBot(i.bot)),
        },
        {
            id: "create-slash-command",
            name: "Add Slash Command",
            category: "Slash Commands",
            icon: "terminal",
            description:
                "Adds a slash command to a bot and registers it with Discord. Its name is lowercase; required options come first. " +
                "The bot's When /name Is Used starts a flow from it",
            text: "Add /{name} to {bot} saying {description} in {server} with {options}, {dms}",
            inputs: {
                name: { type: "text", name: "Name", maxLength: 32 },
                bot: botInput,
                description: { type: "text", name: "Description", maxLength: 100 },
                server: { type: "server", name: "Server", optional: true, description: "Left empty, it's in every server" },
                options: { type: "list<command-option>", name: "Options", optional: true },
                dms: {
                    type: "boolean",
                    name: "Usable in DMs",
                    description: "Also usable by people who added the bot to their own account. Only for a command in every server",
                    choices: [choice("in servers only", false), choice("in DMs too", true)],
                },
            },
            output: "slash-command",
            run: async (i) => {
                const bot = idOfBot(i.bot);
                const result = committed(
                    await host.createCommand(bot, {
                        name: i.name,
                        description: i.description,
                        scope: optionalId(i.server, "Server") ?? GLOBAL_SCOPE,
                        options: i.options ?? [],
                        userInstall: i.dms,
                    }),
                    `/${i.name}`,
                );
                return slashCommandValue(bot, result.command);
            },
        },
        {
            id: "delete-slash-command",
            name: "Delete Slash Command",
            category: "Slash Commands",
            icon: "delete",
            description: "Removes the command from its bot and from Discord. Flows that start from it stop firing",
            text: "Delete {command}",
            inputs: { command: { type: "slash-command", name: "Slash Command" } },
            run: async (i) => {
                const command = i.command as SlashCommandValue;
                committed(await host.deleteCommand(idOfBot(command.bot), command.id), `/${command.name}`);
            },
        },
    ];
    const values: BlockValueDefinition<Inputs>[] = [
        {
            id: "create-command-option",
            name: "Command Option",
            category: "Slash Commands",
            icon: "tune",
            description: "Something Add Slash Command asks for. Its name is lowercase",
            text: "{type} option {name} saying {description}, {required}",
            inputs: {
                type: { type: "text", name: "Type", choices: COMMAND_OPTION_TYPES.map((t) => choice(COMMAND_OPTION_TYPE_LABELS[t], t)) },
                name: { type: "text", name: "Name", maxLength: 32 },
                description: { type: "text", name: "Description", maxLength: 100 },
                required: { type: "boolean", name: "Required", choices: [choice("required", true), choice("optional", false)] },
            },
            type: "command-option",
            read: (i) => ({ name: i.name, description: i.description, type: i.type, required: i.required }),
        },
        {
            id: "bots",
            name: "Bots",
            category: "Bots",
            icon: "smart_toy",
            description: "Every bot in Bot Creator, oldest first",
            type: "list<bot>",
            changes: true,
            read: () => host.ids(),
        },
        {
            id: "bot",
            name: "Bot",
            category: "Bots",
            icon: "smart_toy",
            text: "Bot {bot}",
            inputs: { bot: { type: "bot", name: "Bot" } },
            type: "bot",
            read: (i) => idOfBot(i.bot),
        },
        {
            id: "invite-link",
            name: "Invite Link",
            category: "Bots",
            icon: "link",
            description:
                "Adds the bot to a server, asking for these permissions by Discord's names (SendMessages, ManageRoles...). " +
                "Left out, it asks for the ones Bot Creator's Invite page starts with",
            text: "Invite link for {bot} asking for {permissions}",
            inputs: { bot: botInput, permissions: { type: "list<text>", name: "Permissions", optional: true } },
            type: "url",
            read: (i) => host.inviteLink(idOfBot(i.bot), i.permissions),
        },
    ];
    const bot = { type: "bot", name: "Bot" } as const;
    const events: BlockEventDefinition[] = [
        { id: "bot-added", name: "When a Bot Is Added", category: "Bots", icon: "add", values: { bot } },
        { id: "bot-online", name: "When a Bot Goes Online", category: "Bots", icon: "wifi", values: { bot } },
        {
            id: "bot-offline",
            name: "When a Bot Goes Offline",
            category: "Bots",
            icon: "wifi_off",
            values: { bot, error: { type: "text", name: "Error", description: "None when it was turned off", optional: true } },
        },
        {
            id: "bot-connection-failed",
            name: "When a Bot's Connection Fails",
            category: "Bots",
            icon: "error",
            values: { bot, error: { type: "text", name: "Error" } },
        },
        {
            id: "bot-deleted",
            name: "When a Bot Is Deleted",
            category: "Bots",
            icon: "delete",
            values: { name: { type: "text", name: "Name", description: "What the bot was called" } },
        },
    ];
    return { commands, values, events };
}

/** The sections the panel's and its bots' blocks sit in; registered with the types, before any bot's blocks. */
const BLOCK_CATEGORIES = [
    { name: "Bots", icon: "smart_toy" },
    { name: "Bot", icon: "settings" },
    { name: "Server", icon: "dns" },
    { name: "Channels", icon: "tag" },
    { name: "Messages", icon: "chat" },
    { name: "Reactions", icon: "add_reaction" },
    { name: "Embeds", icon: "featured_play_list" },
    { name: "Members", icon: "group" },
    { name: "Roles", icon: "shield_person" },
    { name: "Slash Commands", icon: "terminal" },
    { name: "Responses", icon: "reply" },
    { name: "Buttons & Menus", icon: "smart_button" },
    { name: "Modals", icon: "dialogs" },
];

/** Bot Creator's panel-wide blocks: the types, the builders, and the bots themselves. */
export function panelBlocks(clients: ConnectedClients, bots: BotsBlocksHost): BlockSet {
    const own = botsBlocks(bots);
    return { categories: BLOCK_CATEGORIES, types: [...blockTypes(clients), ...botTypes(bots)], commands: own.commands, values: [...builderValues, ...own.values!], events: own.events };
}
