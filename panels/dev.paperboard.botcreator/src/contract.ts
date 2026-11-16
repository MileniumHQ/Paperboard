// What Bot Creator's page and widgets say to its service: the calls they
// make, the message events a bot's Overview hears, and the bot list every
// window mirrors. Both sides import this file; what a person automates is a
// block of its own (blocks/).
import { defineContract, shape, type Infer } from "@mileniumhq/paperapi";
import { COMMAND_OPTION_TYPES } from "./types";
import { PANEL_ID } from "./bots";

// a server Discord lists as unavailable at login has no name or owner until it sends the server
const guildSummary = shape.object({
    id: shape.text(),
    name: shape.optional(shape.text()),
    icon: shape.text(),
    memberCount: shape.number(),
    channelCount: shape.number(),
    roleCount: shape.number(),
    ownerId: shape.optional(shape.text()),
});
export type GuildSummary = Infer<typeof guildSummary>;

const slashCommandOption = shape.object({
    id: shape.text(),
    name: shape.text(),
    description: shape.text(),
    type: shape.oneOf(...COMMAND_OPTION_TYPES),
    required: shape.boolean(),
});
export type SlashCommandOption = Infer<typeof slashCommandOption>;

const slashCommandFields = {
    name: shape.text(),
    description: shape.text(),
    /** GLOBAL_SCOPE or a Discord guild id */
    scope: shape.text(),
    options: shape.list(slashCommandOption),
    /**
     * Also available to users who installed the app on their account, not
     * just servers the bot is in. Discord only honors installation contexts
     * on globally-scoped commands, so this is global-only.
     */
    userInstall: shape.boolean(),
};
const slashCommand = shape.object({ id: shape.text(), ...slashCommandFields });
export type SlashCommandDefinition = Infer<typeof slashCommand>;

const commandMutation = shape.object({
    command: slashCommand,
    /** true when the command is live on Discord right now */
    registered: shape.boolean(),
    /** why it is not live, if it is not */
    syncError: shape.nullable(shape.text()),
    /** why its trigger is not registered, if it is not */
    triggerError: shape.nullable(shape.text()),
});
export type CommandMutationResult = Infer<typeof commandMutation>;

/** What every window sees of a bot: its saved identity and its live state. */
const botSummary = shape.object({
    id: shape.text(),
    name: shape.text(),
    avatar: shape.text(),
    applicationId: shape.text(),
    enabled: shape.boolean(),
    connected: shape.boolean(),
    /** logging in to Discord, not connected yet */
    connecting: shape.boolean(),
    /** a token is in the vault; without one the bot can't connect */
    hasToken: shape.boolean(),
    lastError: shape.nullable(shape.text()),
    guildCount: shape.number(),
    /** the servers it is in now (the first 100); none while it isn't connected */
    guilds: shape.list(guildSummary),
    createdAt: shape.number(),
    /**
     * Its saved slash commands, however they were made (the Commands tab, a
     * Blocks flow, another window): announced with every change, so an open
     * Commands tab follows them
     */
    commands: shape.list(slashCommand),
    /** why its commands aren't all on Discord, as of the last sync; null when they are */
    commandSyncError: shape.nullable(shape.text()),
});
export type BotSummary = Infer<typeof botSummary>;

const recentMessageFields = {
    content: shape.text(),
    author: shape.text(),
    authorId: shape.text(),
    channelId: shape.text(),
    guildId: shape.nullable(shape.text()),
    messageId: shape.text(),
};
const recentMessage = shape.object(recentMessageFields);
export type RecentMessage = Infer<typeof recentMessage>;

const botInfo = shape.object({
    name: shape.text(),
    avatar: shape.text(),
    tag: shape.text(),
    guildCount: shape.number(),
    applicationId: shape.text(),
    connected: shape.boolean(),
    lastError: shape.nullable(shape.text()),
    recentMessages: shape.list(recentMessage),
});

const widgetStatus = shape.object({
    /** a token is saved for this bot; false means it needs one */
    configured: shape.boolean(),
    connected: shape.boolean(),
    lastError: shape.nullable(shape.text()),
    name: shape.text(),
    avatar: shape.text(),
    guildCount: shape.number(),
});
export type BotWidgetStatus = Infer<typeof widgetStatus>;

const commandActivity = shape.object({
    /** counts per hour, oldest first; the last bucket is the current hour */
    counts: shape.list(shape.number()),
    /** start of the last (current) bucket, epoch ms */
    currentBucketStart: shape.number(),
    bucketMs: shape.number(),
    /** when recording began, epoch ms: buckets before it were not observed */
    since: shape.number(),
    total: shape.number(),
});
export type CommandActivity = Infer<typeof commandActivity>;

const health = shape.object({
    connected: shape.boolean(),
    lastError: shape.nullable(shape.text()),
    uptimeMs: shape.number(),
    wsPing: shape.number(),
    wsStatus: shape.number(),
    guildCount: shape.number(),
    cachedUsers: shape.number(),
    cachedChannels: shape.number(),
    commandsReceived: shape.number(),
    pendingInteractions: shape.number(),
});
export type Health = Infer<typeof health>;

// the service maps Discord's numeric ChannelType to these names so the UI
// never has to import discord.js
const channelKind = shape.oneOf("text", "voice", "category", "announcement", "stage", "forum", "media", "other");
export type DiscordChannelKind = Infer<typeof channelKind>;

const guildChannel = shape.object({
    id: shape.text(),
    name: shape.text(),
    kind: channelKind,
    parentId: shape.nullable(shape.text()),
    position: shape.number(),
});
export type GuildChannel = Infer<typeof guildChannel>;

const guildDetail = shape.object({
    id: shape.text(),
    name: shape.text(),
    icon: shape.text(),
    memberCount: shape.number(),
    ownerId: shape.text(),
    createdAt: shape.text(),
    channels: shape.list(guildChannel),
    roles: shape.list(
        shape.object({ id: shape.text(), name: shape.text(), color: shape.number(), position: shape.number(), managed: shape.boolean() }),
    ),
});
export type GuildDetail = Infer<typeof guildDetail>;

const memberSummary = shape.object({
    id: shape.text(),
    username: shape.text(),
    displayName: shape.text(),
    avatar: shape.text(),
    joinedAt: shape.nullable(shape.text()),
    bot: shape.boolean(),
});
export type MemberSummary = Infer<typeof memberSummary>;

/** What deleting a bot came to: deleted, or kept because Discord refused to take its slash commands off. */
const deleteBotResult = shape.either(shape.object({ deleted: shape.text() }), shape.object({ refused: shape.text() }));
export type DeleteBotResult = Infer<typeof deleteBotResult>;

const state = shape.object({
    bots: shape.list(botSummary),
    /** why the saved bots could not be read; nothing is written over them meanwhile */
    botsError: shape.nullable(shape.text()),
    /** the setup guide for making a Discord application has been finished or skipped; it shows once */
    setupGuideSeen: shape.boolean(),
});
export type BotsServiceState = Infer<typeof state>;

// a widget's bot is its option, "" while unset: the service says so in words
const ofBot = shape.object({ bot: shape.text() });
const ofGuild = { bot: shape.text(), guildId: shape.text() };

export const botCreatorContract = defineContract(PANEL_ID, {
    calls: {
        /** identity and recent messages, for a bot's Overview */
        getBotInfo: { input: ofBot, output: botInfo },
        /** identity, connection and server count, for the home widget */
        getWidgetStatus: { input: ofBot, output: widgetStatus },
        /** slash commands run per hour over the last day, for the home widget */
        getCommandActivity: { input: ofBot, output: commandActivity },
        /** the invite link for the chosen permissions */
        getInviteUrl: { input: shape.object({ bot: shape.text(), permissions: shape.list(shape.text()) }), output: shape.text() },
        /** the account-install link for user-app commands */
        getUserInstallUrl: { input: ofBot, output: shape.text() },
        /** adds a bot whose token the page saved in the vault under the bot's id, once it logs in */
        addBot: { input: ofBot, output: botSummary },
        /** turns a bot on with its vault token; a token never travels over the wire */
        connectBot: { input: ofBot, output: shape.nothing() },
        disconnectBot: { input: ofBot, output: shape.nothing() },
        /** the page saved a new token for the same bot in the vault; reconnects with it when the bot is on */
        replaceToken: { input: ofBot, output: shape.nothing() },
        /** stops a bot and removes it, its token, its commands and its Blocks project; `anyway` leaves its commands on Discord */
        deleteBot: { input: shape.object({ bot: shape.text(), anyway: shape.optional(shape.boolean()) }), output: deleteBotResult },
        /** the setup guide was finished or skipped: it never shows again */
        markSetupGuideSeen: { output: shape.nothing() },
        /** reads the saved bots again after they couldn't be read at the start; throws why when they still can't be */
        readBotsAgain: { output: shape.nothing() },
        /** gateway, cache and memory health */
        getHealth: { input: ofBot, output: health },
        /** channels and roles, for the server explorer */
        getGuildDetail: { input: shape.object(ofGuild), output: guildDetail },
        /** one bounded member-search page */
        searchGuildMembers: { input: shape.object({ ...ofGuild, query: shape.text() }), output: shape.list(memberSummary) },
        /** stores a command and registers its event and Discord definition */
        /** a new option's id, its scope (global) and userInstall (off) may be left out */
        createCommand: {
            input: shape.object({
                bot: shape.text(),
                name: shape.text(),
                description: shape.text(),
                scope: shape.optional(shape.text()),
                options: shape.list(shape.object({ ...slashCommandOption.fields, id: shape.optional(shape.text()) })),
                userInstall: shape.optional(shape.boolean()),
            }),
            output: commandMutation,
        },
        /** removes a stored command, its event and its Discord definition */
        deleteCommand: { input: shape.object({ bot: shape.text(), id: shape.text() }), output: commandMutation },
        /** an avatar or server icon from Discord's CDN, as a data: address: a page never loads a picture someone else chose */
        getPicture: { input: shape.object({ url: shape.text() }), output: shape.text() },
        /** sends a message as the bot, from the server explorer; the message's id */
        sendMessage: { input: shape.object({ bot: shape.text(), channel: shape.text(), content: shape.text() }), output: shape.text() },
    },
    events: {
        /** a message one of the bots heard, for its Overview */
        message: shape.object({ bot: shape.text(), ...recentMessageFields }),
    },
    state: { shape: state, initial: { bots: [], botsError: null, setupGuideSeen: true } },
});
