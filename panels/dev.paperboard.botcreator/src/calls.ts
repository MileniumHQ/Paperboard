// How the service is reached: the calls the panel's own page and widgets
// make, and what the panel's bot blocks in Blocks run. Both name the bot and
// run the same code as Bot Creator's home screen.
import { loadDiscord } from "./discord";
import { MessageOps, permissionNames, searchMembers } from "./discordOps";
import type { BotsBlocksHost } from "./blocks/bots";
import { MEMBER_SEARCH_LIMIT } from "./types";
import { DEFAULT_SELECTED_PERMISSIONS } from "./permissions";
import { byCreation, type BotSummary } from "./bots";
import { buildGuildDetail, buildMemberSummaries } from "./explorer";
import { discordPicture } from "./discordCdn";
import { appIdOf, bots, requireBot, requireReadable, summary, type BotEntry } from "./registry";
import { markSetupGuideSeen } from "./persistence";
import { createCommand, deleteCommand } from "./commands";
import { addBot, deleteBot, replaceToken, restart, setEnabled } from "./lifecycle";
import type { CallHandlers } from "@mileniumhq/paperapi";
import type { botCreatorContract } from "./contract";

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

function requireGuild(entry: BotEntry, guildId: string) {
    const id = guildId.trim();
    if (!id) throw new Error("A guild id is required.");
    const guild = entry.session.requireClient().guilds.cache.get(id);
    if (!guild) throw new Error(`Guild ${id} is not available to this bot.`);
    return guild;
}

/**
 * What the panel's own page and widgets ask the service (its contract). Each takes the bot's id in its input, and
 * none of them is a block: what a person automates is in blocks/.
 */
export const serviceCalls: CallHandlers<typeof botCreatorContract> = {
    getBotInfo: ({ bot }) => requireBot(bot).session.info(),
    getWidgetStatus: ({ bot }) => {
        const entry = widgetBot(bot);
        return entry.session.widgetStatus(entry.hasToken, entry.stored);
    },
    getCommandActivity: ({ bot }) => widgetBot(bot).session.activity.snapshot(),
    getInviteUrl: ({ bot, permissions }) => buildInviteUrl(appIdOf(requireBot(bot)), permissions),
    getUserInstallUrl: ({ bot }) => buildUserInstallUrl(appIdOf(requireBot(bot))),
    addBot: ({ bot }) => addBot(bot),
    connectBot: async ({ bot }) => {
        requireReadable();
        await setEnabled(widgetBot(bot), true);
    },
    disconnectBot: async ({ bot }) => {
        requireReadable();
        await setEnabled(requireBot(bot), false);
    },
    replaceToken: ({ bot }) => replaceToken(requireBot(bot)),
    deleteBot: ({ bot, anyway }) => deleteBot(requireBot(bot), anyway === true),
    markSetupGuideSeen: () => markSetupGuideSeen(),
    getHealth: ({ bot }) => requireBot(bot).session.health(),
    getGuildDetail: ({ bot, guildId }) => buildGuildDetail(requireGuild(requireBot(bot), guildId)),
    searchGuildMembers: async ({ bot, guildId, query }) => {
        const guild = requireGuild(requireBot(bot), guildId);
        const members = await searchMembers(guild, query.trim(), MEMBER_SEARCH_LIMIT);
        return buildMemberSummaries(members.values());
    },
    createCommand: (input) => createCommand(requireBot(input.bot), input),
    deleteCommand: ({ bot, id }) => deleteCommand(requireBot(bot), id),
    getPicture: ({ url }) => discordPicture(url),
    sendMessage: ({ bot, channel, content }) => new MessageOps(requireBot(bot).session.requireClient()).send(channel, { content }),
};

// what a widget's "Bot" dropdown offers in Home's gallery
export const botChoices = () => byCreation([...bots.values()].map(summary)).map((bot) => ({ value: bot.id, label: bot.name }));

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
