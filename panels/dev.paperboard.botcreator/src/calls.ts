// How the service is reached: the calls the panel's own page and widgets
// make, and what the panel's bot blocks in Blocks run. Both name the bot and
// run the same code as Bot Creator's home screen.
import { loadDiscord } from "./discord";
import { MessageOps, permissionNames, searchMembers } from "./discordOps";
import type { BotsBlocksHost } from "./blocks/bots";
import { DEFAULT_SELECTED_PERMISSIONS, MEMBER_SEARCH_LIMIT } from "./types";
import { byCreation, type BotSummary } from "./bots";
import { buildGuildDetail, buildMemberSummaries } from "./explorer";
import { discordPicture } from "./discordCdn";
import { appIdOf, bots, requireBot, requireReadable, summary, type BotEntry } from "./registry";
import { markSetupGuideSeen } from "./persistence";
import { createCommand, deleteCommand } from "./commands";
import { addBot, deleteBot, replaceToken, restart, setEnabled } from "./lifecycle";

async function buildInviteUrl(appId: string, permissions: string[]): Promise<string> {
    if (!appId) {
        throw new Error("Cannot build an invite URL: no application ID is known.");
    }
    // typo'd permission names must fail loud, never silently vanish
    const names = await permissionNames(permissions);
    const { PermissionsBitField } = await loadDiscord();
    const bitfield = new PermissionsBitField(names);
    // applications.commands is requested because the panel registers slash
    // commands (see syncSlashCommands); an invite without it produces a bot
    // that registers commands it can never receive interactions for
    return `https://discord.com/api/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${bitfield.bitfield.toString()}`;
}

// User installs carry no bot permissions: the link authorizes
// applications.commands for the user's own account. It only works once
// User Install is enabled for the app in the Discord developer portal.
function buildUserInstallUrl(appId: string): string {
    if (!appId) {
        throw new Error("Cannot build a user-install URL: no application ID is known.");
    }
    return `https://discord.com/api/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands`;
}

// a widget with no bot chosen can't say which one to show
function widgetBot(id: unknown): BotEntry {
    if (id === undefined || id === "") throw new Error("No bot is chosen for this widget. Remove it and add it again to pick one.");
    return requireBot(id);
}

function requireGuild(entry: BotEntry, guildId: unknown) {
    const id = typeof guildId === "string" ? guildId.trim() : "";
    if (!id) throw new Error("A guild id is required.");
    const guild = entry.session.requireClient().guilds.cache.get(id);
    if (!guild) throw new Error(`Guild ${id} is not available to this bot.`);
    return guild;
}

/**
 * What the panel's own page and widgets ask the service (serviceApi.call). Each takes the bot's id in its input, and
 * none of them is a block: what a person automates is in blocks/.
 */
export const serviceCalls = {
    /** Identity and recent messages, for a bot's Overview. */
    getBotInfo: (_ctx: unknown, input: any) => requireBot(input?.bot).session.info(),

    /** Identity, connection and server count, for the home widget. */
    getWidgetStatus: (_ctx: unknown, input: any) => {
        const entry = widgetBot(input?.bot);
        return entry.session.widgetStatus(entry.hasToken, entry.stored);
    },

    /** Slash commands run per hour over the last day, for the home widget. */
    getCommandActivity: (_ctx: unknown, input: any) => widgetBot(input?.bot).session.activity.snapshot(),

    /** The invite URL for the chosen permissions. */
    getInviteUrl: (_ctx: unknown, input: any) => {
        const entry = requireBot(input?.bot);
        const permissions = Array.isArray(input?.permissions) ? input.permissions : [];
        return buildInviteUrl(appIdOf(entry), permissions);
    },

    /** The account-install URL for user-app commands. */
    getUserInstallUrl: (_ctx: unknown, input: any) => buildUserInstallUrl(appIdOf(requireBot(input?.bot))),

    /** Adds a bot whose token the page saved in the vault under the bot's id, once it logs in. */
    addBot: (_ctx: unknown, input: any): Promise<BotSummary> => addBot(input?.bot),

    /** Turns a bot on with its vault token. Never accepts a token over the wire. */
    connectBot: async (_ctx: unknown, input: any) => {
        requireReadable();
        await setEnabled(widgetBot(input?.bot), true);
        return true;
    },

    /** Turns a bot off. */
    disconnectBot: async (_ctx: unknown, input: any) => {
        requireReadable();
        await setEnabled(requireBot(input?.bot), false);
        return true;
    },

    /** The page saved a new token for the same bot in the vault; reconnects with it when the bot is on. */
    replaceToken: async (_ctx: unknown, input: any) => {
        await replaceToken(requireBot(input?.bot));
        return true;
    },

    /** Stops a bot and removes it, its token, its commands and its Blocks project; `anyway` leaves its commands on Discord. */
    deleteBot: (_ctx: unknown, input: any) => deleteBot(requireBot(input?.bot), input?.anyway === true),

    /** The setup guide was finished or skipped: it never shows again. Saved with the bots. */
    markSetupGuideSeen: async () => {
        await markSetupGuideSeen();
        return true;
    },

    /** Gateway, cache and memory health. */
    getHealth: (_ctx: unknown, input: any) => requireBot(input?.bot).session.health(),

    /** Channels and roles, for the server explorer. */
    getGuildDetail: (_ctx: unknown, input: any) => buildGuildDetail(requireGuild(requireBot(input?.bot), input?.guildId)),

    /** One bounded member-search page. */
    searchGuildMembers: async (_ctx: unknown, input: any) => {
        const guild = requireGuild(requireBot(input?.bot), input?.guildId);
        const query = typeof input?.query === "string" ? input.query.trim() : "";
        const members = await searchMembers(guild, query, MEMBER_SEARCH_LIMIT);
        return buildMemberSummaries(members.values());
    },

    /** Stores a command and registers its event and Discord definition. */
    createCommand: (_ctx: unknown, input: any) => createCommand(requireBot(input?.bot), input),

    /** Removes a stored command, its event and its Discord definition. */
    deleteCommand: (_ctx: unknown, input: any) => deleteCommand(requireBot(input?.bot), input?.id),

    /** An avatar or server icon from Discord's CDN, as a data: address: a page never loads a picture someone else chose. */
    getPicture: (_ctx: unknown, input: any) => discordPicture(input?.url),

    /** Sends a message as the bot, from the server explorer. */
    sendMessage: (_ctx: unknown, input: any) =>
        new MessageOps(requireBot(input?.bot).session.requireClient()).send(String(input?.channel ?? ""), { content: input?.content }),
};

// what a widget's "Bot" dropdown offers in Home's gallery
export const botChoices = () =>
    [...bots.values()]
        .sort((a, b) => a.stored.createdAt - b.stored.createdAt)
        .map((entry) => ({ value: entry.stored.id, label: entry.stored.name }));

/** A bot a Blocks block names, or why it can't be found. */
function blocksBot(id: unknown): BotEntry {
    const entry = typeof id === "string" ? bots.get(id) : undefined;
    if (entry) return entry;
    if (typeof id !== "string" || !id.trim()) throw new Error("Pick a bot with the Bot block.");
    throw new Error(`There's no bot "${id}" in Bot Creator: it was deleted, or that isn't a bot. Pick one with the Bot block.`);
}

/** What the panel's own bot blocks run: the same code as Bot Creator's home screen. */
export const blocksBots: BotsBlocksHost = {
    ids: () => byCreation([...bots.values()].map(summary)).map((bot) => bot.id),
    bot: (id) => {
        const entry = blocksBot(id);
        const client = entry.session.connected() ? entry.session.client : null;
        return {
            summary: summary(entry),
            servers: client ? [...client.guilds.cache.keys()] : [],
            commands: entry.stored.commands,
            uptime: entry.session.health().uptimeMs,
        };
    },
    remove: async (id) => {
        const result = await deleteBot(blocksBot(id));
        if ("refused" in result) throw new Error(`Couldn't remove its slash commands from Discord, so the bot is kept: ${result.refused} Delete it in Bot Creator to remove it anyway.`);
    },
    setOn: async (id, on) => {
        requireReadable();
        await setEnabled(blocksBot(id), on);
    },
    restart: async (id) => {
        requireReadable();
        await restart(blocksBot(id));
    },
    createCommand: (id, input) => createCommand(blocksBot(id), input),
    deleteCommand: (id, commandId) => deleteCommand(blocksBot(id), commandId),
    inviteLink: (id, permissions) => buildInviteUrl(appIdOf(blocksBot(id)), permissions ?? DEFAULT_SELECTED_PERMISSIONS),
    userInstallLink: (id) => buildUserInstallUrl(appIdOf(blocksBot(id))),
};
