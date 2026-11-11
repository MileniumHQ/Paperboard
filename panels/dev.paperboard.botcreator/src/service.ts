// Bot Creator's service: every bot the panel runs, each with its own
// session, its own Actions project and its own Blocks project. A bot's
// Discord actions and events live in its project ("<bot>/send-message"), so
// two bots share nothing in a flow; the builders that never touch Discord
// (embeds, buttons, menus) are global. The panel's own controls reach the
// service through internal actions that name the bot.
import type { Client } from "discord.js";
import { loadDiscord } from "./discord";
import {
    INPUTS,
    MessageOps,
    InteractionOps,
    buildDiscordEmbed,
    buildButtonComponent,
    buildComponentRow,
    buildModalField,
    buildModalPayload,
    buildSelectMenuComponent,
    MAX_MODAL_FIELDS,
    MAX_SELECT_OPTIONS,
    MAX_FOUND_MEMBERS,
    MAX_RECENT_MESSAGES,
    MAX_POLL_ANSWERS,
    MAX_POLL_HOURS,
    findMembers,
    permissionNames,
    resolveGuild,
    resolveMember,
    type DiscordEmbedData,
    type DiscordButtonData,
} from "./discordOps";
import {
    MAX_LISTED_MEMBERS,
    PRESENCE_STATUSES,
    addRole,
    banUser,
    createChannel,
    createInvite,
    createRole,
    createScheduledEvent,
    deleteChannel,
    deleteRole,
    describeMember,
    disconnectMember,
    editChannel,
    editRole,
    editThread,
    fetchMessageIn,
    kickMember,
    messageReactions,
    moveMember,
    pinnedMessages,
    pollResults,
    removeRole,
    removeTimeout,
    roleMembers,
    sendFile,
    sendPoll,
    setActivity,
    setChannelPermissions,
    setNickname,
    showTyping,
    timeoutMember,
    unbanUser,
    verifyChannel,
    verifyUser,
} from "./botOps";
import {
    definePanelService,
    defineAction,
    defineType,
    secretsApi,
    actionsApi,
    blocksApi,
    projectActionId,
    resolveItemCategory,
    config,
    type ActionDefinition,
    type ActionProjectHandle,
    type BlocksProjectHandle,
    type ServiceContext,
} from "@mileniumhq/paperapi";
import {
    BLOCKS_ONLY_TRIGGERS,
    blockEvent,
    botBlocks,
    botStatus,
    commandEvent,
    commandEventId,
    panelBlocks,
    valueChanges,
    type BotBlocksHost,
    type BotsBlocksHost,
} from "./blocks";
import { randomUUID } from "node:crypto";
import {
    DEFAULT_SELECTED_PERMISSIONS,
    extractApplicationIdFromToken,
    GLOBAL_SCOPE,
    MAX_COMMANDS_PER_SCOPE,
    MAX_COMMAND_OPTIONS,
    SNOWFLAKE_PATTERN,
    MEMBER_SEARCH_LIMIT,
    describeCommandProblem,
    describeCommandOptionProblem,
    normalizeCommandName,
    commandTriggerId,
    errorToMessage,
    type SlashCommandDefinition,
    type SlashCommandOption,
    type CommandOptionType,
    type CommandMutationResult,
} from "./types";
import {
    BOTS_VERSION,
    LEGACY_TOKEN_NAME,
    MAX_BOTS,
    PANEL_ID,
    byCreation,
    createBotId,
    isBotId,
    readBotsConfig,
    tokenName,
    type BotSummary,
    type BotsServiceState,
    type StoredBot,
} from "./bots";
import {
    BotSession,
    buildGuildDetail,
    buildMemberSummaries,
} from "./session";

export {
    PRESENCE_STATUSES,
    validatePresenceStatus,
    channelPermissionChanges,
    scheduledEventOptions,
    type PresenceStatus,
} from "./botOps";

export {
    BotSession,
    buildGuildDetail,
    buildMemberSummaries,
    commandPayload,
    describeChannelKind,
    syncSlashCommands,
} from "./session";

export const discordChannelType = defineType({
    id: "discord-channel",
    name: "Channel",
    icon: "tag",
    description: "A Discord text channel reference",
    base: "string",
});

export const discordUserType = defineType({
    id: "discord-user",
    name: "User",
    icon: "person",
    description: "A Discord user reference",
    base: "string",
});

export const discordMessageType = defineType({
    id: "discord-message",
    name: "Message",
    icon: "chat",
    description: "A Discord message reference",
    base: "string",
});

export const discordEmbedType = defineType({
    id: "discord-embed",
    name: "Embed",
    icon: "article",
    description: "A rich Discord embed payload",
    base: "object",
});

export const discordComponentType = defineType({
    id: "discord-component",
    name: "Component",
    icon: "smart_button",
    description: "A button, select menu, or interaction row for a message",
    base: "object",
});

export const discordModalFieldType = defineType({
    id: "discord-modal-field",
    name: "Text Field",
    icon: "text_fields",
    description: "A text field for a modal",
    base: "object",
});

export const discordInteractionType = defineType({
    id: "discord-interaction",
    name: "Interaction",
    icon: "reply",
    description: "A pending interaction reference (slash command, click, or modal)",
    base: "string",
});

export const discordRoleType = defineType({
    id: "discord-role",
    name: "Role",
    icon: "badge",
    description: "A Discord role reference",
    base: "string",
});

export const urlType = defineType({
    id: "url",
    name: "URL",
    icon: "link",
    description: "A URL string",
    base: "string",
});

export const colorType = defineType({
    id: "color",
    name: "Color",
    icon: "palette",
    description: "A hex or named color string",
    base: "string",
});

export const customTypes = [
    discordChannelType,
    discordUserType,
    discordMessageType,
    discordEmbedType,
    discordComponentType,
    discordModalFieldType,
    discordInteractionType,
    discordRoleType,
    urlType,
    colorType,
];

// declared once: actions and triggers name a category, this array supplies
// its icon and sort order for the Actions library
export const DISCORD_CATEGORIES = [
    { name: "Messages", icon: "chat", order: 1 },
    { name: "Users", icon: "person", order: 2 },
    { name: "Channels", icon: "tag", order: 3 },
    { name: "Reactions", icon: "add_reaction", order: 4 },
    { name: "Interactions", icon: "reply", order: 5 },
    { name: "Commands", icon: "terminal", order: 6 },
    { name: "Members", icon: "group", order: 7 },
    { name: "Roles", icon: "workspace_premium", order: 8 },
    { name: "Bot", icon: "smart_toy", order: 9 },
];

function discordCategory(name: string): { name: string; icon: string; order: number } {
    const found = DISCORD_CATEGORIES.find((category) => category.name === name);
    return found ? { ...found } : { name, icon: "category", order: 999 };
}

// ---------------------------------------------------------------------------
// which bot an action runs as
// ---------------------------------------------------------------------------

// a bot's actions run with its session as their context; the service binds
// it when it registers them into the bot's project
interface BotActionContext {
    session: BotSession;
}

function sessionOf(ctx: unknown): BotSession {
    const session = (ctx as Partial<BotActionContext> | undefined)?.session;
    if (!session) {
        throw new Error("This action belongs to a bot. Place it from the bot's project in the Actions library.");
    }
    return session;
}

function clientOf(ctx: unknown): Client {
    return sessionOf(ctx).requireClient();
}

function interactionsOf(ctx: unknown): InteractionOps {
    const session = sessionOf(ctx);
    return new InteractionOps((id) => session.takeInteraction(id));
}

export async function buildInviteUrl(appId: string, permissions: string[]): Promise<string> {
    if (!appId) {
        throw new Error("Cannot build an invite URL: no application ID is known.");
    }
    // typo'd permission names must fail loud, never silently vanish
    const names = await permissionNames(permissions);
    const { PermissionsBitField } = await loadDiscord();
    const bitfield = new PermissionsBitField(names);
    // applications.commands is requested because the panel now registers
    // slash commands (see syncSlashCommands); an invite without it produces
    // a bot that registers commands it can never receive interactions for
    return `https://discord.com/api/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${bitfield.bitfield.toString()}`;
}

// User installs carry no bot permissions: the link authorizes
// applications.commands for the user's own account. It only works once
// User Install is enabled for the app in the Discord developer portal.
export function buildUserInstallUrl(appId: string): string {
    if (!appId) {
        throw new Error("Cannot build a user-install URL: no application ID is known.");
    }
    return `https://discord.com/api/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands`;
}

// ---------------------------------------------------------------------------
// slash command triggers
// ---------------------------------------------------------------------------

const OPTION_FIELD_TYPES: Record<
    CommandOptionType,
    { type: string; typeName: string }
> = {
    string: { type: "string", typeName: "Text" },
    integer: { type: "number", typeName: "Integer" },
    number: { type: "number", typeName: "Number" },
    boolean: { type: "boolean", typeName: "True / False" },
    user: { type: "discord-user", typeName: "User" },
    channel: { type: "discord-channel", typeName: "Channel" },
    role: { type: "discord-role", typeName: "Role" },
    mentionable: { type: "string", typeName: "User or Role" },
};

export function commandTriggerDefinition(command: SlashCommandDefinition) {
    // the command's own parameters become typed variables, so a flow reads
    // them directly instead of digging through one "Command Data" object
    const optionFields: Record<
        string,
        { type: string; label: string; typeName: string }
    > = {};
    for (const option of command.options) {
        const mapped = OPTION_FIELD_TYPES[option.type];
        optionFields[`values.${option.name}`] = {
            type: mapped.type,
            label: option.name,
            typeName: mapped.typeName,
        };
    }

    return defineAction({
        id: commandTriggerId(command),
        name: `When /${command.name} is used`,
        category: discordCategory("Commands"),
        description:
            command.scope === GLOBAL_SCOPE
                ? command.userInstall
                    ? `Fires when /${command.name} is used anywhere it is installed — servers, DMs, and group chats`
                    : `Fires when /${command.name} is used in any server`
                : `Fires when /${command.name} is used in the server it is registered to`,
        template: `When /${command.name} is used`,
        output: { type: "object", label: "Command Data" },
        outputFields: {
            interactionId: {
                type: "discord-interaction",
                label: "Interaction",
                typeName: "Interaction",
            },
            commandName: { type: "string", label: "Command", typeName: "Text" },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            channelId: {
                type: "discord-channel",
                label: "Channel",
                typeName: "Channel",
            },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            ...optionFields,
        },
        icon: "terminal",
    });
}

export const actions = [
    defineAction({
        id: "get-channel",
        name: "Get Channel",
        category: "Channels",
        description: "Resolves a raw channel ID into a reusable channel reference",
        template: "Get channel {channelId}",
        inputs: {
            channelId: {
                type: "string",
                label: "Channel ID",
                placeholder: "Channel ID",
                required: true,
            },
        },
        output: {
            type: "discord-channel",
            label: "Channel",
        },
        icon: "tag",
        run: async (ctx, inputs: { channelId: string }) => verifyChannel(clientOf(ctx), inputs.channelId),
    }),

    defineAction({
        id: "get-user",
        name: "Get User",
        category: "Users",
        description: "Resolves a raw user ID into a reusable user reference",
        template: "Get user {userId}",
        inputs: {
            userId: {
                type: "string",
                label: "User ID",
                placeholder: "User ID",
                required: true,
            },
        },
        output: {
            type: "discord-user",
            label: "User",
        },
        icon: "person",
        run: async (ctx, inputs: { userId: string }) => verifyUser(clientOf(ctx), inputs.userId),
    }),

    defineAction({
        id: "get-message",
        name: "Get Message",
        category: "Messages",
        description: "Fetches a message from a channel into a reusable message reference",
        template: "Get message {messageId} from {channel}",
        inputs: {
            channel: {
                type: "discord-channel",
                label: "Channel",
                placeholder: "Channel",
                required: true,
            },
            messageId: {
                type: "string",
                label: "Message ID",
                placeholder: "Message ID",
                required: true,
            },
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "chat",
        run: async (
            ctx,
            inputs: { channel: string; messageId: string },
        ) => (await fetchMessageIn(clientOf(ctx), inputs.channel, inputs.messageId)).id,
    }),

    defineAction({
        id: "create-embed",
        name: "Create Embed",
        category: "Messages",
        description: "Builds a rich embed payload for use with Send Message",
        template: "Create embed {title}",
        inputs: {
            title: {
                type: "string",
                label: "Title",
                placeholder: "Title",
                required: true,
            },
            description: {
                type: "string",
                label: "Description",
                placeholder: "Description",
            },
            color: {
                type: "color",
                label: "Color",
                placeholder: "Color",
            },
            url: {
                type: "url",
                label: "URL",
                placeholder: "URL",
            },
            footer: {
                type: "string",
                label: "Footer",
                placeholder: "Footer",
            },
            image: {
                type: "string",
                label: "Image URL",
                placeholder: "Image URL",
            },
        },
        output: {
            type: "discord-embed",
            label: "Embed",
        },
        icon: "article",
        run: async (ctx, inputs: DiscordEmbedData) => {
            const embed = await buildDiscordEmbed(inputs || {});
            return embed.toJSON();
        },
    }),

    defineAction({
        id: "send-message",
        name: "Send Message",
        category: "Messages",
        description: "Sends a text message to a Discord channel",
        template: "Send message {content} to {channel}",
        inputs: {
            channel: INPUTS.channel,
            content: { ...INPUTS.content, required: true },
            reply: { ...INPUTS.message, label: "Reply", required: false },
            embeds: INPUTS.embeds,
            components: INPUTS.components,
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "send",
        run: async (
            ctx,
            inputs: {
                channel: string;
                content: string;
                reply?: string;
                embeds?: unknown;
                components?: unknown;
            },
        ) => {
            const ops = new MessageOps(clientOf(ctx));
            if (inputs.reply) {
                return ops.reply(inputs.channel, inputs.reply, inputs);
            }
            return ops.send(inputs.channel, inputs);
        },
    }),

    defineAction({
        id: "send-dm",
        name: "Send Direct Message",
        category: "Users",
        description:
            "Sends a private direct message to a Discord user. Discord only lets a bot DM people who share a server with it, or who installed it",
        template: "Send DM {content} to {user}",
        inputs: {
            user: INPUTS.user,
            content: { ...INPUTS.content, required: true },
            embeds: INPUTS.embeds,
            components: INPUTS.components,
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "person",
        run: async (ctx, inputs: { user: string; content: string }) => {
            const ops = new MessageOps(clientOf(ctx));
            return ops.dm(inputs.user, inputs);
        },
    }),

    defineAction({
        id: "add-reaction",
        name: "Add Reaction",
        category: "Reactions",
        description: "Adds an emoji reaction to a Discord message",
        template: "Add reaction {emoji} to {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
            emoji: INPUTS.emoji,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "add_reaction",
        run: async (ctx, inputs: { channel: string; message: string; emoji: string }) => {
            const ops = new MessageOps(clientOf(ctx));
            await ops.react(inputs.channel, inputs.message, inputs.emoji);
            return true;
        },
    }),

    defineAction({
        id: "set-status",
        name: "Set Bot Activity",
        category: "Bot",
        description: "Updates the bot presence and activity",
        template: "Set bot activity to {activity}",
        inputs: {
            activity: {
                type: "string",
                label: "Activity",
                placeholder: "Activity",
                required: true,
            },
            status: {
                type: "string",
                label: "Status",
                placeholder: "Status",
                default: "online",
                options: PRESENCE_STATUSES.map((status) => ({
                    label: status === "dnd" ? "Do Not Disturb" : status.charAt(0).toUpperCase() + status.slice(1),
                    value: status,
                })),
            },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "tune",
        run: async (ctx, inputs: { activity: string; status?: string }) => {
            await setActivity(clientOf(ctx), inputs.activity, inputs.status);
            return true;
        },
    }),

    defineAction({
        id: "respond-to-interaction",
        name: "Respond to Interaction",
        category: "Interactions",
        description:
            "Answers a slash command, button, select menu, or modal. Responding again edits the answer",
        template: "Respond to interaction {interactionId} with {content}",
        inputs: {
            interactionId: INPUTS.interaction,
            content: INPUTS.content,
            embeds: INPUTS.embeds,
            components: INPUTS.components,
            ephemeral: INPUTS.ephemeral,
        },
        output: {
            type: "discord-interaction",
            label: "Interaction",
        },
        icon: "reply",
        run: async (
            ctx,
            inputs: {
                interactionId: string;
                content?: string;
                embeds?: unknown;
                components?: unknown;
                ephemeral?: boolean;
            },
        ) => {
            const ops = interactionsOf(ctx);
            return ops.respond(inputs.interactionId, inputs);
        },
    }),

    defineAction({
        id: "follow-up-interaction",
        name: "Follow Up to Interaction",
        category: "Interactions",
        description: "Sends another message after the answer to an interaction",
        template: "Follow up to interaction {interactionId} with {content}",
        inputs: {
            interactionId: INPUTS.interaction,
            content: INPUTS.content,
            embeds: INPUTS.embeds,
            components: INPUTS.components,
            ephemeral: INPUTS.ephemeral,
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "forward",
        run: async (
            ctx,
            inputs: {
                interactionId: string;
                content?: string;
                embeds?: unknown;
                components?: unknown;
                ephemeral?: boolean;
            },
        ) => {
            const ops = interactionsOf(ctx);
            return ops.followUp(inputs.interactionId, inputs);
        },
    }),

    defineAction({
        id: "create-button",
        name: "Create Button",
        category: "Interactions",
        description:
            "Builds a button for a Components field. Loose buttons share a row, five at most; use Create Interaction Row to arrange them yourself",
        template: "Create button {label}",
        inputs: {
            label: {
                type: "string",
                label: "Label",
                placeholder: "Label",
                required: true,
                maxLength: 80,
            },
            style: {
                type: "string",
                label: "Style",
                placeholder: "Button style",
                default: "primary",
                options: [
                    { label: "Primary", value: "primary" },
                    { label: "Secondary", value: "secondary" },
                    { label: "Success", value: "success" },
                    { label: "Danger", value: "danger" },
                    { label: "Link", value: "link" },
                ],
            },
            customId: {
                type: "string",
                label: "Interaction ID",
                placeholder: "Interaction ID",
                maxLength: 100,
            },
            url: {
                type: "url",
                label: "URL",
                placeholder: "URL",
            },
            emoji: {
                type: "string",
                label: "Emoji",
                placeholder: "Emoji",
            },
            disabled: {
                type: "boolean",
                label: "Disabled",
                default: false,
            },
        },
        output: {
            type: "discord-component",
            label: "Button",
        },
        icon: "smart_button",
        run: async (ctx, inputs: DiscordButtonData) =>
            buildButtonComponent(inputs || {}),
    }),

    defineAction({
        id: "create-select-menu",
        name: "Create Select Menu",
        category: "Interactions",
        description:
            "Builds a dropdown for a Components field. It fills a row of its own; picks fire When an Interaction is Triggered",
        template: "Create select menu {customId} with {options}",
        inputs: {
            customId: {
                type: "string",
                label: "Interaction ID",
                placeholder: "Interaction ID",
                required: true,
                maxLength: 100,
            },
            options: {
                type: "list<string>",
                label: "Options",
                placeholder: "Option",
                maxItems: MAX_SELECT_OPTIONS,
                maxLength: 100,
            },
            menu: {
                type: "string",
                label: "Pick from",
                placeholder: "Menu kind",
                default: "text",
                options: [
                    { label: "The options listed", value: "text" },
                    { label: "Users", value: "user" },
                    { label: "Roles", value: "role" },
                    { label: "Channels", value: "channel" },
                ],
            },
            placeholder: {
                type: "string",
                label: "Placeholder",
                placeholder: "Placeholder",
                maxLength: 150,
            },
            minValues: {
                type: "number",
                label: "Minimum picks",
                placeholder: "Count",
                integer: true,
                min: 0,
                max: MAX_SELECT_OPTIONS,
            },
            maxValues: {
                type: "number",
                label: "Maximum picks",
                placeholder: "Count",
                integer: true,
                min: 1,
                max: MAX_SELECT_OPTIONS,
            },
            disabled: { type: "boolean", label: "Disabled", default: false },
        },
        output: {
            type: "discord-component",
            label: "Select Menu",
        },
        icon: "arrow_drop_down_circle",
        run: async (ctx, inputs: Parameters<typeof buildSelectMenuComponent>[0]) =>
            buildSelectMenuComponent(inputs || {}),
    }),

    defineAction({
        id: "create-interaction-row",
        name: "Create Interaction Row",
        category: "Interactions",
        description:
            "Groups up to five buttons, or one select menu, into one row. Components before or after it go on their own rows",
        template: "Create interaction row with {components}",
        inputs: {
            components: { ...INPUTS.components, required: true },
        },
        output: {
            type: "discord-component",
            label: "Interaction Row",
        },
        icon: "view_week",
        run: async (ctx, inputs: { components?: unknown }) =>
            buildComponentRow(inputs?.components),
    }),

    defineAction({
        id: "create-text-field",
        name: "Create Text Field",
        category: "Interactions",
        description:
            "Builds a question for Show Modal. Answers arrive in order as Field 1 to Field 5 of When a Modal is Submitted",
        template: "Create text field {label}",
        inputs: {
            label: {
                type: "string",
                label: "Label",
                placeholder: "Question",
                required: true,
                maxLength: 45,
            },
            style: {
                type: "string",
                label: "Style",
                placeholder: "Field style",
                default: "short",
                options: [
                    { label: "One line", value: "short" },
                    { label: "Paragraph", value: "paragraph" },
                ],
            },
            placeholder: {
                type: "string",
                label: "Placeholder",
                placeholder: "Placeholder",
                maxLength: 100,
            },
            value: {
                type: "string",
                label: "Prefilled answer",
                placeholder: "Answer",
                maxLength: 4000,
            },
            required: { type: "boolean", label: "Required", default: true },
            minLength: {
                type: "number",
                label: "Minimum length",
                placeholder: "Characters",
                integer: true,
                min: 0,
                max: 4000,
            },
            maxLength: {
                type: "number",
                label: "Maximum length",
                placeholder: "Characters",
                integer: true,
                min: 1,
                max: 4000,
            },
        },
        output: {
            type: "discord-modal-field",
            label: "Text Field",
        },
        icon: "text_fields",
        run: async (ctx, inputs: Parameters<typeof buildModalField>[0]) =>
            buildModalField(inputs || {}),
    }),

    defineAction({
        id: "show-modal",
        name: "Show Modal",
        category: "Interactions",
        description:
            "Opens a form for the user who used a slash command, button, or select menu. It must be the first answer; the reply arrives through When a Modal is Submitted",
        template: "Show modal {title} for {interactionId}",
        inputs: {
            interactionId: INPUTS.interaction,
            title: {
                type: "string",
                label: "Title",
                placeholder: "Title",
                required: true,
                maxLength: 45,
            },
            modalId: {
                type: "string",
                label: "Modal ID",
                placeholder: "Modal ID",
                required: true,
                maxLength: 100,
            },
            fields: {
                type: "list<discord-modal-field>",
                label: "Fields",
                placeholder: "Text Field",
                typeName: "Text Field",
                required: true,
                maxItems: MAX_MODAL_FIELDS,
            },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "dynamic_form",
        run: async (
            ctx,
            inputs: { interactionId: string; title?: string; modalId?: string; fields?: unknown },
        ) => {
            const modal = await buildModalPayload(inputs);
            const ops = interactionsOf(ctx);
            return ops.showModal(inputs.interactionId, modal);
        },
    }),

    defineAction({
        id: "edit-message",
        name: "Edit Message",
        category: "Messages",
        description: "Edits a message the bot previously sent",
        template: "Edit message {message} to {content}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
            content: INPUTS.content,
            embeds: INPUTS.embeds,
            components: INPUTS.components,
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "edit",
        run: async (
            ctx,
            inputs: {
                channel: string;
                message: string;
                content?: string;
                embeds?: unknown;
            },
        ) => {
            const ops = new MessageOps(clientOf(ctx));
            return ops.edit(inputs.channel, inputs.message, inputs);
        },
    }),

    defineAction({
        id: "delete-message",
        name: "Delete Message",
        category: "Messages",
        description: "Deletes a message from a Discord channel",
        template: "Delete message {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "delete",
        run: async (
            ctx,
            inputs: { channel: string; message: string },
        ) => {
            const ops = new MessageOps(clientOf(ctx));
            await ops.delete(inputs.channel, inputs.message);
            return true;
        },
    }),

    defineAction({
        id: "purge-messages",
        name: "Purge Messages",
        category: "Messages",
        description: "Deletes the newest messages in a channel",
        template: "Purge {count} messages in {channel}",
        inputs: {
            channel: INPUTS.channel,
            count: INPUTS.count,
        },
        output: {
            type: "number",
            label: "Deleted",
        },
        icon: "delete_sweep",
        run: async (ctx, inputs: { channel: string; count?: number }) => {
            const ops = new MessageOps(clientOf(ctx));
            return ops.bulkDelete(inputs.channel, inputs.count);
        },
    }),

    defineAction({
        id: "pin-message",
        name: "Pin Message",
        category: "Messages",
        description: "Pins a message in its channel",
        template: "Pin message {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "push_pin",
        run: async (ctx, inputs: { channel: string; message: string }) => {
            const ops = new MessageOps(clientOf(ctx));
            await ops.pin(inputs.channel, inputs.message);
            return true;
        },
    }),

    defineAction({
        id: "unpin-message",
        name: "Unpin Message",
        category: "Messages",
        description: "Removes a message from the channel's pinned messages",
        template: "Unpin message {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "keep_off",
        run: async (ctx, inputs: { channel: string; message: string }) => {
            const ops = new MessageOps(clientOf(ctx));
            await ops.unpin(inputs.channel, inputs.message);
            return true;
        },
    }),

    defineAction({
        id: "crosspost-message",
        name: "Crosspost Message",
        category: "Messages",
        description: "Publishes a message in an announcement channel to all servers following it",
        template: "Crosspost message {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "podcasts",
        run: async (ctx, inputs: { channel: string; message: string }) => {
            const ops = new MessageOps(clientOf(ctx));
            await ops.crosspost(inputs.channel, inputs.message);
            return true;
        },
    }),

    defineAction({
        id: "remove-reaction",
        name: "Remove Reaction",
        category: "Reactions",
        description: "Removes an emoji reaction from a message, optionally only from one user",
        template: "Remove reaction {emoji} from {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
            emoji: INPUTS.emoji,
            user: { ...INPUTS.user, required: false },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "heart_broken",
        run: async (
            ctx,
            inputs: { channel: string; message: string; emoji: string; user?: string },
        ) => {
            const ops = new MessageOps(clientOf(ctx));
            await ops.removeReaction(inputs.channel, inputs.message, inputs.emoji, inputs.user);
            return true;
        },
    }),

    defineAction({
        id: "add-role",
        name: "Add Role",
        category: "Roles",
        description: "Gives a role to a member",
        template: "Add role {role} to {user}",
        inputs: {
            user: INPUTS.user,
            role: INPUTS.role,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "how_to_reg",
        run: async (
            ctx,
            inputs: { user: string; role: string; guildId?: string },
        ) => {
            await addRole(clientOf(ctx), inputs.user, inputs.role, inputs.guildId);
            return true;
        },
    }),

    defineAction({
        id: "remove-role",
        name: "Remove Role",
        category: "Roles",
        description: "Takes a role away from a member",
        template: "Remove role {role} from {user}",
        inputs: {
            user: INPUTS.user,
            role: INPUTS.role,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "do_not_disturb_on",
        run: async (
            ctx,
            inputs: { user: string; role: string; guildId?: string },
        ) => {
            await removeRole(clientOf(ctx), inputs.user, inputs.role, inputs.guildId);
            return true;
        },
    }),

    defineAction({
        id: "create-role",
        name: "Create Role",
        category: "Roles",
        description: "Creates a server role and returns its id",
        template: "Create role {name}",
        inputs: {
            name: INPUTS.name,
            color: INPUTS.color,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "discord-role",
            label: "Role",
        },
        icon: "add_moderator",
        run: async (
            ctx,
            inputs: { name: string; color?: string; guildId?: string },
        ) => (await createRole(clientOf(ctx), inputs)).id,
    }),

    defineAction({
        id: "delete-role",
        name: "Delete Role",
        category: "Roles",
        description: "Deletes a role from the server",
        template: "Delete role {role}",
        inputs: {
            role: INPUTS.role,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "remove_moderator",
        run: async (ctx, inputs: { role: string; guildId?: string }) => {
            await deleteRole(clientOf(ctx), inputs.role, inputs.guildId);
            return true;
        },
    }),

    defineAction({
        id: "ban-member",
        name: "Ban Member",
        category: "Members",
        description: "Bans a user from the server",
        template: "Ban {user}",
        inputs: {
            user: INPUTS.user,
            deleteDays: INPUTS.deleteDays,
            reason: INPUTS.reason,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "block",
        run: async (
            ctx,
            inputs: { user: string; deleteDays?: number; reason?: string; guildId?: string },
        ) => {
            await banUser(clientOf(ctx), inputs.user, inputs);
            return true;
        },
    }),

    defineAction({
        id: "unban-member",
        name: "Unban User",
        category: "Members",
        description: "Lifts a ban for a user",
        template: "Unban {user}",
        inputs: {
            user: INPUTS.user,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "person_remove",
        run: async (ctx, inputs: { user: string; guildId?: string }) => {
            await unbanUser(clientOf(ctx), inputs.user, inputs.guildId);
            return true;
        },
    }),

    defineAction({
        id: "kick-member",
        name: "Kick Member",
        category: "Members",
        description: "Removes a member from the server",
        template: "Kick {user}",
        inputs: {
            user: INPUTS.user,
            reason: INPUTS.reason,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "logout",
        run: async (
            ctx,
            inputs: { user: string; reason?: string; guildId?: string },
        ) => {
            await kickMember(clientOf(ctx), inputs.user, inputs.reason, inputs.guildId);
            return true;
        },
    }),

    defineAction({
        id: "timeout-member",
        name: "Timeout Member",
        category: "Members",
        description: "Mutes a member for a set number of minutes",
        template: "Timeout {user} for {minutes} minutes",
        inputs: {
            user: INPUTS.user,
            minutes: INPUTS.minutes,
            reason: INPUTS.reason,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "timer",
        run: async (
            ctx,
            inputs: { user: string; minutes?: number; reason?: string; guildId?: string },
        ) => {
            await timeoutMember(clientOf(ctx), inputs.user, inputs);
            return true;
        },
    }),

    defineAction({
        id: "create-channel",
        name: "Create Channel",
        category: "Channels",
        description: "Creates a text, voice, announcement, or category channel",
        template: "Create channel {name}",
        inputs: {
            name: INPUTS.name,
            kind: INPUTS.kind,
            topic: INPUTS.topic,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "discord-channel",
            label: "Channel",
        },
        icon: "add_comment",
        run: async (
            ctx,
            inputs: { name: string; kind?: string; topic?: string; guildId?: string },
        ) => (await createChannel(clientOf(ctx), inputs)).id,
    }),

    defineAction({
        id: "delete-channel",
        name: "Delete Channel",
        category: "Channels",
        description: "Deletes a channel",
        template: "Delete channel {channel}",
        inputs: {
            channel: INPUTS.channel,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "delete_forever",
        run: async (ctx, inputs: { channel: string }) => {
            await deleteChannel(clientOf(ctx), inputs.channel);
            return true;
        },
    }),

    defineAction({
        id: "edit-channel",
        name: "Edit Channel",
        category: "Channels",
        description: "Renames a channel or changes its topic or slowmode",
        template: "Edit channel {channel}",
        inputs: {
            channel: INPUTS.channel,
            name: { ...INPUTS.name, required: false },
            topic: INPUTS.topic,
            slowmode: INPUTS.slowmode,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "tune",
        run: async (
            ctx,
            inputs: { channel: string; name?: string; topic?: string; slowmode?: number },
        ) => {
            await editChannel(clientOf(ctx), inputs.channel, inputs);
            return true;
        },
    }),

    defineAction({
        id: "create-thread",
        name: "Create Thread",
        category: "Channels",
        description: "Starts a thread from a message",
        template: "Create thread {name} from {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
            name: INPUTS.name,
        },
        output: {
            type: "discord-channel",
            label: "Thread",
        },
        icon: "forum",
        run: async (
            ctx,
            inputs: { channel: string; message: string; name: string },
        ) => {
            const ops = new MessageOps(clientOf(ctx));
            return ops.startThread(inputs.channel, inputs.message, inputs.name);
        },
    }),

    defineAction({
        id: "move-member",
        name: "Move Member",
        category: "Members",
        description: "Moves a connected member to another voice channel",
        template: "Move {user} to {channel}",
        inputs: {
            user: INPUTS.user,
            channel: INPUTS.channel,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "swap_horiz",
        run: async (
            ctx,
            inputs: { user: string; channel: string; guildId?: string },
        ) => {
            await moveMember(clientOf(ctx), inputs.user, inputs.channel, inputs.guildId);
            return true;
        },
    }),

    defineAction({
        id: "disconnect-member",
        name: "Disconnect Member",
        category: "Members",
        description: "Disconnects a member from voice",
        template: "Disconnect {user}",
        inputs: {
            user: INPUTS.user,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "voice_over_off",
        run: async (
            ctx,
            inputs: { user: string; guildId?: string },
        ) => {
            await disconnectMember(clientOf(ctx), inputs.user, inputs.guildId);
            return true;
        },
    }),

    defineAction({
        id: "create-invite",
        name: "Create Invite",
        category: "Channels",
        description: "Creates an invite link for a channel",
        template: "Create invite for {channel}",
        inputs: {
            channel: INPUTS.channel,
            maxUses: INPUTS.maxUses,
        },
        output: {
            type: "url",
            label: "Invite",
        },
        icon: "link",
        run: async (ctx, inputs: { channel: string; maxUses?: number }) =>
            createInvite(clientOf(ctx), inputs.channel, inputs.maxUses),
    }),
];

// Typed fields each static trigger offers. Keys mirror the payloads the
// emit sites in attachListeners send, so a variable inserted from the
// picker always resolves to a real value (labels are the picker's names).
// event actions fire as events and start flows; they are not callable
export const staticTriggers = [
    defineAction({
        id: "on-message",
        name: "When a message is received",
        category: "Messages",
        description: "Fires whenever a message is sent in Discord",
        template: "When a message is received in Discord",
        output: { type: "object", label: "Message Data" },
        outputFields: {
            content: { type: "string", label: "Message", typeName: "Text" },
            author: { type: "string", label: "Username", typeName: "Text" },
            authorId: { type: "discord-user", label: "User", typeName: "User" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            messageId: { type: "discord-message", label: "Message ID", typeName: "Message" },
        },
        icon: "chat",
    }),

    defineAction({
        id: "on-member-join",
        name: "When member joins server",
        category: "Members",
        description: "Fires when a new member joins a server",
        template: "When a new member joins",
        output: { type: "object", label: "Member Data" },
        outputFields: {
            username: { type: "string", label: "Username", typeName: "Text" },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            guildName: { type: "string", label: "Server Name", typeName: "Text" },
        },
        icon: "person_add",
    }),

    defineAction({
        id: "on-member-leave",
        name: "When member leaves server",
        category: "Members",
        description: "Fires when a member leaves a server",
        template: "When a member leaves",
        output: { type: "object", label: "Member Data" },
        outputFields: {
            username: { type: "string", label: "Username", typeName: "Text" },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "person_remove",
    }),

    defineAction({
        id: "on-reaction-add",
        name: "When a reaction is added",
        category: "Reactions",
        description: "Fires when an emoji reaction is added to a message",
        template: "When an emoji reaction is added",
        output: { type: "object", label: "Reaction Data" },
        outputFields: {
            emoji: { type: "string", label: "Emoji", typeName: "Text" },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            messageId: { type: "discord-message", label: "Message ID", typeName: "Message" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
        },
        icon: "add_reaction",
    }),

    defineAction({
        id: "on-connection-error",
        name: "When the bot connection fails",
        category: discordCategory("Bot"),
        description: "Fires with the typed login error when the bot fails to connect",
        template: "When the bot fails to connect",
        output: { type: "object", label: "Error Data" },
        outputFields: {
            error: { type: "string", label: "Error", typeName: "Text" },
        },
        icon: "error",
    }),

    defineAction({
        id: "interaction-triggered",
        name: "When an Interaction is Triggered",
        category: discordCategory("Interactions"),
        description:
            "Fires when a user clicks a button or picks from a select menu this bot sent",
        template: "When interaction {customId} is triggered",
        inputs: {
            customId: {
                type: "string",
                label: "Interaction ID",
                placeholder: "Interaction ID",
                required: true,
            },
        },
        match: { field: "customId", input: "customId" },
        output: { type: "object", label: "Interaction Data" },
        outputFields: {
            customId: { type: "string", label: "Interaction ID", typeName: "Text" },
            interactionId: {
                type: "discord-interaction",
                label: "Interaction",
                typeName: "Interaction",
            },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            channelId: {
                type: "discord-channel",
                label: "Channel",
                typeName: "Channel",
            },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            messageId: {
                type: "discord-message",
                label: "Message",
                typeName: "Message",
            },
            value: { type: "string", label: "Picked", typeName: "Text" },
            values: { type: "list<string>", label: "All picks", typeName: "Text[]" },
        },
        icon: "touch_app",
    }),

    defineAction({
        id: "modal-submitted",
        name: "When a Modal is Submitted",
        category: discordCategory("Interactions"),
        description:
            "Fires when a user submits a modal opened by Show Modal. Field 1 is the first text field's answer, and so on",
        template: "When modal {modalId} is submitted",
        inputs: {
            modalId: {
                type: "string",
                label: "Modal ID",
                placeholder: "Modal ID",
                required: true,
            },
        },
        match: { field: "modalId", input: "modalId" },
        output: { type: "object", label: "Modal Data" },
        outputFields: {
            modalId: { type: "string", label: "Modal ID", typeName: "Text" },
            interactionId: {
                type: "discord-interaction",
                label: "Interaction",
                typeName: "Interaction",
            },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            channelId: {
                type: "discord-channel",
                label: "Channel",
                typeName: "Channel",
            },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            messageId: {
                type: "discord-message",
                label: "Message",
                typeName: "Message",
            },
            field1: { type: "string", label: "Field 1", typeName: "Text" },
            field2: { type: "string", label: "Field 2", typeName: "Text" },
            field3: { type: "string", label: "Field 3", typeName: "Text" },
            field4: { type: "string", label: "Field 4", typeName: "Text" },
            field5: { type: "string", label: "Field 5", typeName: "Text" },
        },
        icon: "dynamic_form",
    }),

    defineAction({
        id: "on-message-edited",
        name: "When a message is edited",
        category: discordCategory("Messages"),
        description: "Fires when a message is edited in Discord",
        template: "When a message is edited",
        output: { type: "object", label: "Message Data" },
        outputFields: {
            content: { type: "string", label: "Message", typeName: "Text" },
            author: { type: "string", label: "Username", typeName: "Text" },
            authorId: { type: "discord-user", label: "User", typeName: "User" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            messageId: { type: "discord-message", label: "Message ID", typeName: "Message" },
        },
        icon: "edit_note",
    }),

    defineAction({
        id: "on-message-deleted",
        name: "When a message is deleted",
        category: discordCategory("Messages"),
        description: "Fires when a message is deleted in Discord",
        template: "When a message is deleted",
        output: { type: "object", label: "Message Data" },
        outputFields: {
            messageId: { type: "discord-message", label: "Message ID", typeName: "Message" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "delete",
    }),

    defineAction({
        id: "on-reaction-removed",
        name: "When a reaction is removed",
        category: discordCategory("Reactions"),
        description: "Fires when a user's reaction is taken off a message",
        template: "When a reaction is removed",
        output: { type: "object", label: "Reaction Data" },
        outputFields: {
            emoji: { type: "string", label: "Emoji", typeName: "Text" },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            messageId: { type: "discord-message", label: "Message ID", typeName: "Message" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
        },
        icon: "heart_broken",
    }),

    defineAction({
        id: "on-member-banned",
        name: "When a member is banned",
        category: discordCategory("Members"),
        description: "Fires when a user is banned from a server the bot is in",
        template: "When a member is banned",
        output: { type: "object", label: "Ban Data" },
        outputFields: {
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            reason: { type: "string", label: "Reason", typeName: "Text" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "block",
    }),

    defineAction({
        id: "on-role-added",
        name: "When a member gets a role",
        category: discordCategory("Roles"),
        description: "Fires when a role is granted to a member",
        template: "When a member gets a role",
        output: { type: "object", label: "Role Data" },
        outputFields: {
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            roleId: { type: "discord-role", label: "Role", typeName: "Role" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "how_to_reg",
    }),

    defineAction({
        id: "on-role-removed",
        name: "When a member loses a role",
        category: discordCategory("Roles"),
        description: "Fires when a role is taken away from a member",
        template: "When a member loses a role",
        output: { type: "object", label: "Role Data" },
        outputFields: {
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            roleId: { type: "discord-role", label: "Role", typeName: "Role" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "do_not_disturb_on",
    }),

    defineAction({
        id: "on-thread-created",
        name: "When a thread is created",
        category: discordCategory("Channels"),
        description: "Fires when a thread is started in a channel",
        template: "When a thread is created",
        output: { type: "object", label: "Thread Data" },
        outputFields: {
            threadId: { type: "discord-channel", label: "Thread", typeName: "Channel" },
            name: { type: "string", label: "Name", typeName: "Text" },
            channelId: { type: "discord-channel", label: "Parent Channel", typeName: "Channel" },
            ownerId: { type: "discord-user", label: "Owner", typeName: "User" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "forum",
    }),

    defineAction({
        id: "on-voice-state-change",
        name: "When a voice state changes",
        category: discordCategory("Members"),
        description: "Fires when a member joins, moves, or leaves voice",
        template: "When a voice state changes",
        output: { type: "object", label: "Voice Data" },
        outputFields: {
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
            previousChannelId: {
                type: "discord-channel",
                label: "Previous Channel",
                typeName: "Channel",
            },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "spatial_audio",
    }),

    defineAction({
        id: "on-bot-ready",
        name: "When the bot becomes ready",
        category: discordCategory("Bot"),
        description: "Fires when the bot's gateway session is live",
        template: "When the bot becomes ready",
        output: { type: "object", label: "Bot Data" },
        outputFields: {
            userId: { type: "discord-user", label: "Bot User", typeName: "User" },
            username: { type: "string", label: "Bot Name", typeName: "Text" },
        },
        icon: "verified",
    }),
];

// Added after flows named actions by bare id, so no deprecated forwarder
// carries them: they only ever lived in a bot's project. The ones that
// return lists or records are hidden from the Actions library, for programs
// and the Agent panel.

export const laterActions = [
    defineAction({
        id: "send-poll",
        name: "Send Poll",
        category: "Messages",
        description: `Posts a poll to a channel. Answers are one per line, at most ${MAX_POLL_ANSWERS}; it runs for Hours (24 unless set, at most ${MAX_POLL_HOURS})`,
        template: "Send poll {question} to {channel}",
        inputs: {
            channel: INPUTS.channel,
            question: { type: "string", label: "Question", placeholder: "Question", required: true },
            answers: { type: "list<string>", label: "Answers", placeholder: "Answers", required: true },
            hours: { type: "number", label: "Hours", placeholder: "Hours" },
            multiple: { type: "boolean", label: "Allow several answers", default: false },
        },
        output: { type: "discord-message", label: "Message" },
        icon: "ballot",
        run: async (ctx, inputs: { channel: string; question: string; answers: unknown; hours?: number; multiple?: boolean }) =>
            (await sendPoll(clientOf(ctx), inputs)).id,
    }),

    defineAction({
        id: "get-poll-results",
        name: "Get Poll Results",
        hidden: true,
        category: "Messages",
        description: "A poll's question, each answer with its vote count, and whether voting has closed",
        template: "Get poll results of {message}",
        inputs: { channel: INPUTS.channel, message: INPUTS.message },
        output: { type: "object", label: "Results" },
        icon: "ballot",
        run: async (ctx, inputs: { channel: string; message: string }) =>
            pollResults(clientOf(ctx), inputs.channel, inputs.message),
    }),

    defineAction({
        id: "send-file",
        name: "Send File",
        category: "Messages",
        description: "Sends a file from a web address to a channel, with an optional message; File name renames it. Discord downloads it; at most 10 MB unless the server is boosted",
        template: "Send file {url} to {channel}",
        inputs: {
            channel: INPUTS.channel,
            url: { type: "url", label: "File address", placeholder: "URL", required: true },
            name: { type: "string", label: "File name", placeholder: "File name" },
            content: INPUTS.content,
        },
        output: { type: "discord-message", label: "Message" },
        icon: "attach_file",
        run: async (ctx, inputs: { channel: string; url: string; name?: string; content?: string }) =>
            (await sendFile(() => clientOf(ctx), inputs)).id,
    }),

    defineAction({
        id: "show-typing",
        name: "Show Typing",
        category: "Messages",
        description: "Shows \"is typing…\" in a channel for about ten seconds, or until the bot sends a message",
        template: "Show typing in {channel}",
        inputs: { channel: INPUTS.channel },
        output: { type: "boolean", label: "Success" },
        icon: "more_horiz",
        run: async (ctx, inputs: { channel: string }) => {
            await showTyping(clientOf(ctx), inputs.channel);
            return true;
        },
    }),

    defineAction({
        id: "get-pinned-messages",
        name: "Get Pinned Messages",
        hidden: true,
        category: "Messages",
        description: "A channel's pinned messages, newest pin first: id, author, authorId, content and when it was pinned",
        template: "Get pinned messages in {channel}",
        inputs: { channel: INPUTS.channel },
        output: { type: "list<object>", label: "Messages" },
        icon: "push_pin",
        run: async (ctx, inputs: { channel: string }) =>
            (await pinnedMessages(clientOf(ctx), inputs.channel)).map((pin: any) => ({
                id: String(pin.message.id),
                author: String(pin.message.author?.username ?? ""),
                authorId: String(pin.message.author?.id ?? ""),
                content: String(pin.message.content ?? ""),
                pinnedAt: pin.pinnedAt.toISOString(),
            })),
    }),

    defineAction({
        id: "get-reactions",
        name: "Get Reactions",
        hidden: true,
        category: "Reactions",
        description: "Every reaction on a message: the emoji, how many, and who reacted (the first 100 people each)",
        template: "Get reactions on {message}",
        inputs: { channel: INPUTS.channel, message: INPUTS.message },
        output: { type: "list<object>", label: "Reactions" },
        icon: "add_reaction",
        run: async (ctx, inputs: { channel: string; message: string }) =>
            messageReactions(clientOf(ctx), inputs.channel, inputs.message),
    }),

    defineAction({
        id: "get-member",
        name: "Get Member",
        hidden: true,
        category: "Members",
        description: "One member of a server: username, display name, nickname, roles (id, name), when they joined, whether they're a bot, until when they're timed out, and the voice channel they're in",
        template: "Get member {user}",
        inputs: { user: INPUTS.user, guildId: INPUTS.guildId },
        output: { type: "object", label: "Member" },
        icon: "badge",
        run: async (ctx, inputs: { user: string; guildId?: string }) => {
            const member = await resolveMember(clientOf(ctx), inputs.user, inputs.guildId);
            return describeMember(member);
        },
    }),

    defineAction({
        id: "list-role-members",
        name: "List Role Members",
        hidden: true,
        category: "Roles",
        description: `Everyone in a server with a role, at most ${MAX_LISTED_MEMBERS}, and how many there are in all`,
        template: "List members with {role}",
        inputs: { role: INPUTS.role, guildId: INPUTS.guildId },
        output: { type: "object", label: "Members" },
        icon: "groups",
        run: async (ctx, inputs: { role: string; guildId?: string }) => {
            const { role, total, members } = await roleMembers(clientOf(ctx), inputs.role, inputs.guildId);
            return {
                role: { id: role.id, name: role.name },
                total,
                members: members.map((m) => ({ userId: m.id, username: m.user.username, displayName: m.displayName })),
            };
        },
    }),

    defineAction({
        id: "set-nickname",
        name: "Set Nickname",
        category: "Members",
        description: "Changes a member's nickname in a server; an empty nickname clears it. The bot's own user id renames the bot there",
        template: "Set {user}'s nickname to {nickname}",
        inputs: {
            user: INPUTS.user,
            nickname: { type: "string", label: "Nickname", placeholder: "Nickname" },
            reason: INPUTS.reason,
            guildId: INPUTS.guildId,
        },
        output: { type: "boolean", label: "Success" },
        icon: "edit",
        run: async (ctx, inputs: { user: string; nickname?: string; reason?: string; guildId?: string }) => {
            await setNickname(clientOf(ctx), inputs.user, inputs);
            return true;
        },
    }),

    defineAction({
        id: "remove-timeout",
        name: "Remove Timeout",
        category: "Members",
        description: "Ends a member's timeout early",
        template: "Remove {user}'s timeout",
        inputs: { user: INPUTS.user, reason: INPUTS.reason, guildId: INPUTS.guildId },
        output: { type: "boolean", label: "Success" },
        icon: "timer_off",
        run: async (ctx, inputs: { user: string; reason?: string; guildId?: string }) => {
            await removeTimeout(clientOf(ctx), inputs.user, inputs.reason, inputs.guildId);
            return true;
        },
    }),

    defineAction({
        id: "edit-role",
        name: "Edit Role",
        category: "Roles",
        description: "Renames a role or changes its color, whether it's shown apart in the member list, and whether anyone can mention it",
        template: "Edit role {role}",
        inputs: {
            role: INPUTS.role,
            name: { ...INPUTS.name, required: false },
            color: INPUTS.color,
            hoist: { type: "boolean", label: "Show apart" },
            mentionable: { type: "boolean", label: "Anyone can mention" },
            guildId: INPUTS.guildId,
        },
        output: { type: "boolean", label: "Success" },
        icon: "workspace_premium",
        run: async (ctx, inputs: { role: string; name?: string; color?: string; hoist?: boolean; mentionable?: boolean; guildId?: string }) => {
            await editRole(clientOf(ctx), inputs.role, inputs);
            return true;
        },
    }),

    defineAction({
        id: "set-channel-permissions",
        name: "Set Channel Permissions",
        category: "Channels",
        description:
            "Allows or denies permissions in one channel for a role or a person: Discord's names, like ViewChannel, SendMessages, Connect, separated by commas. " +
            "\"everyone\" is the server's everyone role, so denying it SendMessages locks the channel. Permissions named in neither list stay as they are; Reset ones go back to the server's",
        template: "Set {target}'s permissions in {channel}",
        inputs: {
            channel: INPUTS.channel,
            target: { type: "string", label: "Role or user", placeholder: "Role or user", required: true },
            allow: { type: "list<string>", label: "Allow", placeholder: "Permissions" },
            deny: { type: "list<string>", label: "Deny", placeholder: "Permissions" },
            reset: { type: "list<string>", label: "Reset", placeholder: "Permissions" },
            reason: INPUTS.reason,
        },
        output: { type: "boolean", label: "Success" },
        icon: "lock",
        run: async (ctx, inputs: { channel: string; target: string; allow?: unknown; deny?: unknown; reset?: unknown; reason?: string }) => {
            await setChannelPermissions(clientOf(ctx), inputs);
            return true;
        },
    }),

    defineAction({
        id: "edit-thread",
        name: "Edit Thread",
        category: "Channels",
        description: "Renames a thread, archives or reopens it, or locks it so only moderators can reopen it",
        template: "Edit thread {thread}",
        inputs: {
            thread: { ...INPUTS.channel, label: "Thread", placeholder: "Thread" },
            name: { ...INPUTS.name, required: false },
            archived: { type: "boolean", label: "Archived" },
            locked: { type: "boolean", label: "Locked" },
        },
        output: { type: "boolean", label: "Success" },
        icon: "forum",
        run: async (ctx, inputs: { thread: string; name?: string; archived?: boolean; locked?: boolean }) => {
            await editThread(clientOf(ctx), inputs.thread, inputs);
            return true;
        },
    }),

    defineAction({
        id: "create-event",
        name: "Create Scheduled Event",
        category: "Channels",
        description:
            "Schedules a server event people can say they're going to. In a voice or stage channel it needs only a start; anywhere else it needs a location and an end. " +
            "Times are like 2026-11-02T18:00:00Z, or timestamps. Returns the event's link",
        template: "Schedule {name}",
        inputs: {
            name: INPUTS.name,
            start: { type: "string", label: "Starts", placeholder: "Time", required: true },
            end: { type: "string", label: "Ends", placeholder: "Time" },
            channel: { ...INPUTS.channel, label: "Voice channel", required: false },
            location: { type: "string", label: "Location", placeholder: "Location" },
            description: { type: "string", label: "Description", placeholder: "Description" },
            guildId: INPUTS.guildId,
        },
        output: { type: "url", label: "Event link" },
        icon: "event",
        run: async (ctx, inputs: { name: string; start: unknown; end?: unknown; channel?: string; location?: string; description?: string; guildId?: string }) =>
            createScheduledEvent(clientOf(ctx), inputs),
    }),
];


// the actions that only build a payload: they never reach Discord, so every
// bot shares them as the panel's global blocks
const BUILDER_ACTION_IDS = new Set([
    "create-embed",
    "create-button",
    "create-select-menu",
    "create-interaction-row",
    "create-text-field",
]);

export const builderActions = actions.filter((def) => BUILDER_ACTION_IDS.has(def.id));
/** Everything a bot's project holds besides its commands: its actions, then its events. */
export const botActions = [...actions.filter((def) => !BUILDER_ACTION_IDS.has(def.id)), ...laterActions, ...staticTriggers];
/** What flows from before several bots named by bare id: the deprecated forwarders. */
const legacyBotActions = [...actions.filter((def) => !BUILDER_ACTION_IDS.has(def.id)), ...staticTriggers];

/** A bot's copy of a definition: its category resolved, its run bound to the session. */
export function bindToBot(def: ActionDefinition, session: BotSession): ActionDefinition {
    const run = def.run;
    return {
        ...def,
        category: resolveItemCategory(def.category, DISCORD_CATEGORIES),
        run: run ? (_ctx: unknown, inputs: any) => run({ session } as any, inputs) : undefined,
    };
}

// ---------------------------------------------------------------------------
// the bots
// ---------------------------------------------------------------------------

// TODO(remove after v0.5): flows from before several bots name the one bot's
// actions without a project. Until then they stay registered under their
// old ids, forwarding to the bot they meant, and say how to move on.
export const LEGACY_DEPRECATION =
    "From before Bot Creator ran several bots. Place this block again from your bot in the Actions library; this one stops working in v0.5.";

interface BotEntry {
    stored: StoredBot;
    session: BotSession;
    hasToken: boolean;
    /** the bot's Actions project, once defined; null while it isn't */
    project: ActionProjectHandle | null;
    /** why the bot's actions are not in Actions, when they aren't */
    actionsError: string | null;
    /** the bot's Blocks project, once defined; null while it isn't */
    blocks: BlocksProjectHandle | null;
    /** tells Blocks which of the bot's values changed, once its project is registered */
    blocksChanged: (() => void) | null;
    /** online as of the last change Blocks heard of, for When a Bot Goes Online and Offline */
    online: boolean;
}

const bots = new Map<string, BotEntry>();
let legacyBot: string | undefined;
// the config as read, so fields this version doesn't know are written back
let savedExtras: Record<string, unknown> = {};
// why the saved bots couldn't be read; nothing is written over them meanwhile
let botsError: string | null = null;
// why the panel's Blocks types and builders couldn't be registered; no bot's blocks can be then
let panelBlocksError: string | null = null;
// the panel's own blocks are registered, so its events can fire
let panelBlocksReady = false;
let serviceCtx: ServiceContext<BotsServiceState> | null = null;

function summary(entry: BotEntry): BotSummary {
    const { stored, session } = entry;
    const connected = session.connected();
    return {
        id: stored.id,
        name: stored.name,
        avatar: stored.avatar,
        applicationId: stored.applicationId,
        enabled: stored.enabled,
        connected,
        connecting: session.connecting(),
        hasToken: entry.hasToken,
        lastError: entry.actionsError ?? session.status().error ?? null,
        guildCount: connected ? session.client?.guilds?.cache?.size ?? 0 : 0,
        createdAt: stored.createdAt,
    };
}

function publish(): void {
    serviceCtx?.setState({ bots: [...bots.values()].map(summary), botsError });
}

function requireReadable(): void {
    if (botsError) throw new Error(`Bot Creator couldn't read its saved bots, so nothing is changed: ${botsError}`);
}

function requireBot(id: unknown): BotEntry {
    const entry = typeof id === "string" ? bots.get(id) : undefined;
    if (!entry) throw new Error(isBotId(id) ? "This bot was deleted from Bot Creator." : "A bot id is required.");
    return entry;
}

// writes run one after another, each saving the list as it is then, so an
// older write never lands after a newer one
let writing: Promise<void> = Promise.resolve();

function saveBots(): Promise<void> {
    const write = writing.then(async () => {
        const document = {
            ...savedExtras,
            version: BOTS_VERSION,
            bots: [...bots.values()].map((entry) => entry.stored),
            ...(legacyBot ? { legacyBot } : {}),
        };
        if (!legacyBot) delete (document as Record<string, unknown>).legacyBot;
        try {
            await config.set(document, PANEL_ID);
        } catch (err) {
            throw new Error(`Could not save the bots: ${errorToMessage(err)}`);
        }
    });
    // the caller hears of a failed write; the chain moves on to the next
    writing = write.catch(logFailure("saving the bots failed"));
    return write;
}

function logFailure(what: string) {
    return (err: unknown) => console.error(`[DiscordService] ${what}:`, errorToMessage(err));
}

function sessionHost(id: string, entry: () => BotEntry) {
    return {
        emit(trigger: string, output: unknown) {
            if (!BLOCKS_ONLY_TRIGGERS.has(trigger)) {
                actionsApi.emitTrigger(projectActionId(id, trigger), output, PANEL_ID)
                    .catch(logFailure(`event ${id}/${trigger} failed`));
            }
            if (legacyBot === id && !BLOCKS_ONLY_TRIGGERS.has(trigger)) {
                actionsApi.emitTrigger(trigger, output, PANEL_ID)
                    .catch(logFailure(`event ${trigger} failed`));
            }
            fireBlocksEvent(entry(), trigger, output).catch(logFailure(`Blocks event ${id}/${trigger} failed`));
            if (trigger === "on-connection-error" && bots.has(id)) {
                firePanelEvent("bot-connection-failed", { bot: id, error: String((output as { error?: unknown } | null)?.error ?? "") });
            }
        },
        changed() {
            const known = bots.get(id);
            if (known) noteIdentity(known);
            publish();
            entry().blocksChanged?.();
            if (known) noteOnline(known);
        },
    };
}

/** One of the panel's own Blocks events, once the panel's blocks are registered. */
function firePanelEvent(event: string, payload: Record<string, unknown>): void {
    if (!panelBlocksReady) return;
    blocksApi.panel(PANEL_ID).fire(event, payload).catch(logFailure(`Blocks event ${event} failed`));
}

/** Tells Blocks the list of bots changed. */
function botsChanged(): void {
    if (!panelBlocksReady) return;
    blocksApi.panel(PANEL_ID).changed("bots").catch(logFailure("the change to the bot list did not reach Blocks"));
}

/** Fires When a Bot Goes Online or Offline, when the bot did since Blocks last heard. */
function noteOnline(entry: BotEntry): void {
    const online = entry.session.connected();
    if (online === entry.online) return;
    entry.online = online;
    if (online) firePanelEvent("bot-online", { bot: entry.stored.id });
    else firePanelEvent("bot-offline", { bot: entry.stored.id, error: entry.session.status().error ?? null });
}

/** The trigger as the bot's Blocks event, once the bot's blocks are registered. */
async function fireBlocksEvent(entry: BotEntry, trigger: string, output: unknown): Promise<void> {
    if (!entry.blocks) return;
    const { event, payload } = blockEvent(trigger, output, entry.stored.commands);
    await entry.blocks.fire(event, payload);
}

// the bot's name and avatar are Discord's: kept as of the last login, so the
// home screen and Actions name an offline bot the way it was last seen
function noteIdentity(entry: BotEntry): void {
    const user = entry.session.client?.user;
    if (!user) return;
    const name = user.username;
    const avatar = user.displayAvatarURL();
    if (name === entry.stored.name && avatar === entry.stored.avatar && user.id === entry.stored.applicationId) return;
    const renamed = name !== entry.stored.name;
    entry.stored = { ...entry.stored, name, avatar, applicationId: user.id };
    saveBots().catch(logFailure(`saving ${name}'s identity failed`));
    if (renamed && entry.project) {
        entry.project.update({ name, icon: "smart_toy" }).catch(logFailure(`renaming ${name}'s project failed`));
    }
    if (renamed && entry.blocks) {
        entry.blocks.update({ name, icon: "smart_toy" }).catch(logFailure(`renaming ${name}'s Blocks project failed`));
    }
}

function createEntry(stored: StoredBot, hasToken: boolean): BotEntry {
    // the session's host reaches the entry it belongs to, made just below
    let entry: BotEntry | null = null;
    const session = new BotSession(stored.id, sessionHost(stored.id, () => entry!));
    session.applicationId = stored.applicationId;
    session.commands = stored.commands;
    entry = { stored, session, hasToken, project: null, actionsError: null, blocks: null, blocksChanged: null, online: false };
    return entry;
}

/** What a bot's blocks run against: its live session. */
function blocksHost(entry: BotEntry): BotBlocksHost {
    return {
        client: () => entry.session.requireClient(),
        interactions: () => new InteractionOps((id) => entry.session.takeInteraction(id)),
        connected: () => entry.session.connected(),
        userId: () => {
            const id = entry.session.client?.user?.id || entry.stored.applicationId;
            if (!id) throw new Error("This bot's Discord user isn't known yet. Turn it on in Bot Creator.");
            return id;
        },
        status: () => botStatus(summary(entry)),
        uptime: () => entry.session.health().uptimeMs,
        commands: () => entry.stored.commands,
        activity: () => entry.session.activity.snapshot(),
        commandUses: (command) => entry.session.commandUses.get(command),
    };
}

/** The bots connected now, whose clients a Blocks type's fields look things up with. */
function connectedClients(): Client[] {
    return [...bots.values()].flatMap((entry) => (entry.session.connected() && entry.session.client ? [entry.session.client] : []));
}

/** Defines the bot's Blocks project and registers its commands, values and events into it. */
async function registerBlocks(entry: BotEntry): Promise<void> {
    if (panelBlocksError) throw new Error(`Bot Creator's types aren't in Blocks: ${panelBlocksError}`);
    const blocks = await blocksApi.defineProject({ id: entry.stored.id, name: entry.stored.name, icon: "smart_toy" }, PANEL_ID);
    entry.blocks = blocks;
    await blocks.register(botBlocks(blocksHost(entry)));
    if (entry.stored.commands.length) await blocks.register({ events: entry.stored.commands.map(commandEvent) });
    entry.blocksChanged = valueChanges(blocks, blocksHost(entry), entry.stored.name);
}

/** Defines the bot's project and registers its actions, events and commands into it. */
async function registerBot(entry: BotEntry): Promise<void> {
    const project = await actionsApi.defineProject({ id: entry.stored.id, name: entry.stored.name, icon: "smart_toy" }, PANEL_ID);
    entry.project = project;
    for (const def of botActions) await project.register(bindToBot(def, entry.session));
    for (const def of managementActions(entry)) await project.register(def);
    for (const command of entry.stored.commands) await project.register(commandTriggerDefinition(command));
    if (legacyBot === entry.stored.id) await registerLegacyForwarders(entry);
    await registerBlocks(entry);
    entry.actionsError = null;
}

async function registerLegacyForwarders(entry: BotEntry): Promise<void> {
    for (const def of legacyBotActions) {
        await actionsApi.register({ ...bindToBot(def, entry.session), deprecated: LEGACY_DEPRECATION }, undefined, PANEL_ID);
    }
    for (const command of entry.stored.commands) {
        await actionsApi.register({ ...commandTriggerDefinition(command), deprecated: LEGACY_DEPRECATION }, undefined, PANEL_ID);
    }
}

async function unregisterLegacyForwarders(entry: BotEntry): Promise<void> {
    for (const def of legacyBotActions) await actionsApi.unregister(def.id, PANEL_ID);
    for (const command of entry.stored.commands) await actionsApi.unregister(commandTriggerId(command), PANEL_ID);
}

async function readToken(id: string): Promise<string | null> {
    const stored = await secretsApi.get(tokenName(id), PANEL_ID);
    return stored.found && stored.value ? stored.value : null;
}

/** Connects a saved bot with its vault token; the reason it can't is the bot's error. */
async function connect(entry: BotEntry): Promise<void> {
    const token = await readToken(entry.stored.id);
    entry.hasToken = Boolean(token);
    if (!token) {
        const message = "No token is saved for this bot. Replace its token in Configuration.";
        entry.session.fail(message);
        throw new Error(message);
    }
    await entry.session.start(token);
}

async function setEnabled(entry: BotEntry, enabled: boolean): Promise<void> {
    if (entry.stored.enabled !== enabled) {
        entry.stored = { ...entry.stored, enabled };
        await saveBots();
        publish();
    }
    if (enabled) await connect(entry);
    else await entry.session.stop();
}

// The one bot from before several bots becomes the first of them: its
// token moves to its own vault name, its commands come along, and flows
// that used it keep running through the deprecated forwarders.
async function migrateLegacyBot(saved: Record<string, unknown>, legacy: { applicationId: string; commands: SlashCommandDefinition[] }): Promise<void> {
    const old = await secretsApi.get(LEGACY_TOKEN_NAME, PANEL_ID);
    const token = old.found && old.value ? old.value : null;
    const id = createBotId();
    if (token) await secretsApi.set(tokenName(id), token, PANEL_ID);
    const { configured: _configured, applicationId: _applicationId, commands: _commands, ...extras } = saved;
    savedExtras = extras;
    legacyBot = id;
    const stored: StoredBot = {
        id,
        name: "Discord bot",
        avatar: "",
        applicationId: legacy.applicationId || (token ? extractApplicationIdFromToken(token) ?? "" : ""),
        enabled: true,
        commands: legacy.commands,
        createdAt: Date.now(),
    };
    bots.set(id, createEntry(stored, Boolean(token)));
    await saveBots();
    if (token) await secretsApi.delete(LEGACY_TOKEN_NAME, PANEL_ID);
    console.log(`[DiscordService] moved the bot from before several bots into ${id}`);
}

async function loadBots(): Promise<void> {
    const saved = await config.get<unknown>(PANEL_ID);
    const read = readBotsConfig(saved);
    if (read.kind === "legacy") {
        await migrateLegacyBot(saved as Record<string, unknown>, read);
        return;
    }
    const { bots: _bots, version: _version, legacyBot: _legacyBot, ...extras } = (saved ?? {}) as Record<string, unknown>;
    savedExtras = extras;
    legacyBot = read.config.legacyBot;
    for (const stored of read.config.bots) bots.set(stored.id, createEntry(stored, false));
}

// a bot's actions, then its connection: one bot failing never holds back another
/** Adds a saved bot's actions to Actions. The daemon is local, so this is quick, and it's done before the service is
 * ready: a flow that runs at startup finds the bot's actions registered. */
async function registerEntry(entry: BotEntry): Promise<void> {
    try {
        await registerBot(entry);
    } catch (err) {
        entry.actionsError = `Its actions couldn't be added to Actions and Blocks: ${errorToMessage(err)}`;
        console.error(`[DiscordService] ${entry.stored.name}:`, entry.actionsError);
    }
}

/** Logs a saved bot in to Discord, which can stall on a rate limit, so it runs after the service is ready. */
async function connectEntry(entry: BotEntry): Promise<void> {
    try {
        entry.hasToken = Boolean(await readToken(entry.stored.id));
        if (!entry.hasToken) entry.session.fail("No token is saved for this bot. Replace its token in Configuration.");
        else if (entry.stored.enabled) await connect(entry);
    } catch (err) {
        // the reason is the bot's error, on its card and in its Overview
        console.error(`[DiscordService] ${entry.stored.name} didn't connect:`, errorToMessage(err));
    }
    publish();
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

async function setCommands(entry: BotEntry, commands: SlashCommandDefinition[]): Promise<void> {
    const before = entry.stored;
    entry.stored = { ...entry.stored, commands };
    try {
        await saveBots();
    } catch (err) {
        entry.stored = before;
        throw err;
    }
    entry.session.commands = commands;
}

// one event action per command: registering is part of creating the
// command, so a command whose event action is missing is reported, never
// quietly half-created
async function registerCommandTrigger(entry: BotEntry, command: SlashCommandDefinition): Promise<string | null> {
    try {
        if (!entry.project) throw new Error(entry.actionsError ?? "the bot's project is not in Actions");
        await entry.project.register(commandTriggerDefinition(command));
        if (legacyBot === entry.stored.id) {
            await actionsApi.register({ ...commandTriggerDefinition(command), deprecated: LEGACY_DEPRECATION }, undefined, PANEL_ID);
        }
        if (!entry.blocks) throw new Error(entry.actionsError ?? "the bot's project is not in Blocks");
        await entry.blocks.register({ events: [commandEvent(command)] });
        return null;
    } catch (err) {
        console.error(`[DiscordService] event action registration failed for /${command.name}:`, err);
        return `Could not register the trigger for /${command.name}: ${errorToMessage(err)}`;
    }
}

async function unregisterCommandTrigger(entry: BotEntry, command: SlashCommandDefinition): Promise<string | null> {
    try {
        if (entry.project) await entry.project.unregister(commandTriggerId(command));
        if (legacyBot === entry.stored.id) await actionsApi.unregister(commandTriggerId(command), PANEL_ID);
        if (entry.blocks) await entry.blocks.unregister("event", commandEventId(command));
        return null;
    } catch (err) {
        console.error(`[DiscordService] event action removal failed for /${command.name}:`, err);
        return `Could not remove the trigger for /${command.name}: ${errorToMessage(err)}`;
    }
}

/** Stores a command, registers its event in the bot's project, and tells Discord. */
async function createCommand(entry: BotEntry, input: any): Promise<CommandMutationResult> {
    requireReadable();
    const name = typeof input?.name === "string" ? normalizeCommandName(input.name) : "";
    const description = typeof input?.description === "string" ? input.description.trim() : "";
    const scope = typeof input?.scope === "string" && input.scope.trim() ? input.scope.trim() : GLOBAL_SCOPE;
    const userInstall = Boolean(input?.userInstall);
    const problem = describeCommandProblem({ name, description });
    if (problem) throw new Error(problem);
    if (scope !== GLOBAL_SCOPE && !SNOWFLAKE_PATTERN.test(scope)) {
        throw new Error(`Unknown command scope "${scope}".`);
    }
    if (userInstall && scope !== GLOBAL_SCOPE) {
        throw new Error(
            "User apps are only available for global commands: Discord ignores installation contexts on server-scoped commands.",
        );
    }
    const options = parseCommandOptions(input?.options);

    const commands = entry.stored.commands;
    if (commands.some((c) => c.scope === scope && c.name === name)) {
        throw new Error(`A command named /${name} already exists in this scope.`);
    }
    if (commands.filter((c) => c.scope === scope).length >= MAX_COMMANDS_PER_SCOPE) {
        throw new Error(`Discord allows at most ${MAX_COMMANDS_PER_SCOPE} commands per scope.`);
    }

    const definition: SlashCommandDefinition = { id: randomUUID(), name, description, scope, options, userInstall };
    await setCommands(entry, [...commands, definition]);
    const triggerError = await registerCommandTrigger(entry, definition);
    const sync = await entry.session.syncAfterMutation();
    return { command: definition, ...sync, triggerError };
}

/** Removes a stored command, its event, and its Discord definition. */
async function deleteCommand(entry: BotEntry, rawId: unknown): Promise<CommandMutationResult> {
    requireReadable();
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id) throw new Error("A command id is required.");
    const target = entry.stored.commands.find((c) => c.id === id);
    if (!target) throw new Error(`No command with id ${id} is stored.`);
    const next = entry.stored.commands.filter((c) => c.id !== id);
    // a scope with no commands left cannot be inferred from the list, so it
    // is explicitly cleared on Discord
    const scopesToClear = next.some((c) => c.scope === target.scope) ? [] : [target.scope];
    await setCommands(entry, next);
    const triggerError = await unregisterCommandTrigger(entry, target);
    const sync = await entry.session.syncAfterMutation(scopesToClear);
    return { command: target, ...sync, triggerError };
}

// ---------------------------------------------------------------------------
// finding things and managing commands, for agents and programs
// ---------------------------------------------------------------------------

// Hidden from the Actions library (they return lists, not block-shaped
// values) but in the bot's project for programs and the Agent panel: the
// ids every other action takes, looked up by name, and the bot's commands.
// A command made here is an event in the same project, ready for a flow.
export function managementActions(entry: BotEntry): ActionDefinition[] {
    const client = () => entry.session.requireClient();
    const commandEvent = (command: SlashCommandDefinition) => projectActionId(entry.stored.id, commandTriggerId(command));
    const withEvent = (result: CommandMutationResult) => ({ ...result, event: commandEvent(result.command) });
    return [
        defineAction({
            id: "list-servers",
            name: "List Servers",
            hidden: true,
            category: "Bot",
            description: "Every server this bot is in, with its id, name and member count",
            template: "List servers",
            inputs: {},
            output: { type: "list<object>", label: "Servers" },
            icon: "dns",
            run: async () =>
                [...client().guilds.cache.values()].map((guild) => ({ id: guild.id, name: guild.name, memberCount: guild.memberCount })),
        }),
        defineAction({
            id: "get-server",
            name: "Get Server",
            hidden: true,
            category: "Channels",
            description: "One server's channels (id, name, kind, the category they're under) and roles (id, name), for the ids other actions take",
            template: "Get server {guildId}",
            inputs: { guildId: { ...INPUTS.guildId, description: "Optional when the bot is in one server" } },
            output: { type: "object", label: "Server" },
            icon: "tag",
            run: async (_ctx, inputs: { guildId?: string }) => {
                const guild = await resolveGuild(client(), inputs?.guildId);
                const { id, name, memberCount, ownerId, channels, roles } = buildGuildDetail(guild);
                return { id, name, memberCount, ownerId, channels, roles: roles.map(({ id, name, managed }) => ({ id, name, managed })) };
            },
        }),
        defineAction({
            id: "find-member",
            name: "Find Member",
            hidden: true,
            category: "Members",
            description:
                "Finds people by the start of their username or nickname in the servers this bot is in (or one server), " +
                `exact names first, at most ${MAX_FOUND_MEMBERS}. Each match's userId is what Send Direct Message and the member actions take. An empty list means nobody matched`,
            template: "Find member {query}",
            inputs: {
                query: { type: "string", label: "Name", placeholder: "Name", required: true },
                guildId: INPUTS.guildId,
            },
            output: { type: "list<object>", label: "Members" },
            icon: "person_search",
            run: async (_ctx, inputs: { query?: string; guildId?: string }) =>
                findMembers(client(), String(inputs?.query ?? ""), inputs?.guildId),
        }),
        defineAction({
            id: "get-recent-messages",
            name: "Get Recent Messages",
            hidden: true,
            category: "Messages",
            description: `A channel's latest messages, oldest first: id, author, authorId, content, attachment links and when it was sent. Count defaults to 20, at most ${MAX_RECENT_MESSAGES}`,
            template: "Get recent messages in {channel}",
            inputs: { channel: INPUTS.channel, count: INPUTS.count },
            output: { type: "list<object>", label: "Messages" },
            icon: "forum",
            run: async (_ctx, inputs: { channel: string; count?: number }) =>
                new MessageOps(client()).recent(inputs.channel, inputs.count as number),
        }),
        defineAction({
            id: "list-commands",
            name: "List Slash Commands",
            hidden: true,
            category: "Commands",
            description: "This bot's slash commands: id, name, description, scope (\"global\" or a server id), options, and `event`, the action id a flow starts from when the command is used",
            template: "List slash commands",
            inputs: {},
            output: { type: "list<object>", label: "Commands" },
            icon: "terminal",
            run: async () => entry.stored.commands.map((command) => ({ ...command, event: commandEvent(command) })),
        }),
        defineAction({
            id: "create-command",
            name: "Create Slash Command",
            hidden: true,
            category: "Commands",
            description:
                "Adds a slash command to this bot and registers it with Discord. `name` is lowercase, 1-32 characters; `description` 1-100. " +
                "`scope` is a server id, or empty for every server. `options` is a list of { name, description, type, required } with type one of " +
                "string, integer, number, boolean, user, channel, role, mentionable; required ones come first. `userInstall` (global only) lets people use it in DMs. " +
                "Returns `event`, the action id to start a flow from: the flow answers the command with Respond to Interaction, using the event's interactionId",
            template: "Create slash command {name}",
            inputs: {
                name: INPUTS.name,
                description: { type: "string", label: "Description", placeholder: "Description", required: true },
                scope: { type: "string", label: "Server ID", placeholder: "Server ID" },
                options: { type: "list<object>", label: "Options" },
                userInstall: { type: "boolean", label: "Usable in DMs", default: false },
            },
            output: { type: "object", label: "Command" },
            icon: "add",
            run: async (_ctx, inputs) => withEvent(await createCommand(entry, inputs)),
        }),
        defineAction({
            id: "delete-command",
            name: "Delete Slash Command",
            hidden: true,
            category: "Commands",
            description: "Removes one of this bot's slash commands, by the id List Slash Commands shows, from the bot and from Discord. Flows that start from it stop firing",
            template: "Delete slash command {id}",
            inputs: { id: { type: "string", label: "Command id", placeholder: "Command id", required: true } },
            output: { type: "object", label: "Command" },
            icon: "delete",
            run: async (_ctx, inputs: { id?: string }) => withEvent(await deleteCommand(entry, inputs?.id)),
        }),
    ].map((def) => ({ ...def, category: resolveItemCategory(def.category, DISCORD_CATEGORIES) }));
}

// ---------------------------------------------------------------------------
// the panel's own controls
// ---------------------------------------------------------------------------

// UI-only RPCs: internal actions stay callable through actionsApi.call for
// the panel's own controls, and the Actions library hides them by schema
// instead of by a name suffix
function internalAction(
    id: string,
    name: string,
    description: string,
    run: (inputs: any) => unknown | Promise<unknown>,
) {
    return defineAction({
        id,
        name,
        description,
        template: name,
        internal: true,
        inputs: {},
        output: { type: "any", label: "Result" },
        run: async (_ctx, inputs) => run(inputs),
    });
}

function parseCommandOptions(raw: unknown): SlashCommandOption[] {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_COMMAND_OPTIONS) {
        throw new Error(
            `Discord allows at most ${MAX_COMMAND_OPTIONS} parameters per command.`,
        );
    }
    const candidates = list.map((option: any) => ({
        id:
            typeof option?.id === "string" && option.id
                ? option.id
                : randomUUID(),
        name:
            typeof option?.name === "string"
                ? normalizeCommandName(option.name)
                : "",
        description:
            typeof option?.description === "string"
                ? option.description.trim()
                : "",
        type: typeof option?.type === "string" ? option.type : "",
        required: Boolean(option?.required),
    }));
    for (let index = 0; index < candidates.length; index++) {
        const problem = describeCommandOptionProblem(
            candidates[index],
            candidates,
            index,
        );
        if (problem) {
            throw new Error(`Parameter ${index + 1}: ${problem}`);
        }
    }
    return candidates.map((candidate) => ({
        ...candidate,
        type: candidate.type as CommandOptionType,
    }));
}

/**
 * Adds a bot whose token the panel saved in the vault under its id, once it
 * logs in. A bot that doesn't log in is forgotten, token and all.
 */
async function addBot(id: unknown): Promise<BotSummary> {
    requireReadable();
    if (!isBotId(id)) throw new Error("A bot id is required.");
    if (bots.has(id)) throw new Error("This bot is already added.");
    if (bots.size >= MAX_BOTS) throw new Error(`Bot Creator runs at most ${MAX_BOTS} bots.`);
    const saved = await readToken(id);
    if (!saved) throw new Error("No token was saved for the new bot.");
    const forget = () => secretsApi.delete(tokenName(id), PANEL_ID).catch(logFailure("forgetting the refused token failed"));
    const applicationId = extractApplicationIdFromToken(saved);
    if (!applicationId) {
        await forget();
        throw new Error("That isn't a Discord bot token.");
    }
    const twin = [...bots.values()].find((entry) => entry.stored.applicationId === applicationId);
    if (twin) {
        await forget();
        throw new Error(`${twin.stored.name} already uses this bot. One bot can only run once.`);
    }
    const entry = createEntry({
        id,
        name: "Discord bot",
        avatar: "",
        applicationId,
        enabled: true,
        commands: [],
        createdAt: Date.now(),
    }, true);
    // the project first, so the bot's first events have somewhere to go
    try {
        await registerBot(entry);
        await entry.session.start(saved);
        bots.set(id, entry);
        noteIdentity(entry);
        await saveBots();
    } catch (err) {
        bots.delete(id);
        await entry.session.stop();
        if (entry.project) await entry.project.remove().catch(logFailure("removing the refused bot's project failed"));
        if (entry.blocks) await entry.blocks.remove().catch(logFailure("removing the refused bot's Blocks project failed"));
        await forget();
        throw err;
    }
    publish();
    botsChanged();
    firePanelEvent("bot-added", { bot: id });
    noteOnline(entry);
    return summary(entry);
}

/** Reconnects a bot that's on with the new token the panel saved in the vault. */
async function replaceToken(entry: BotEntry): Promise<void> {
    requireReadable();
    const saved = await readToken(entry.stored.id);
    if (!saved) throw new Error("No token was saved for this bot.");
    entry.hasToken = true;
    if (entry.stored.enabled) await connect(entry);
    else publish();
}

/** Stops a bot and removes it, its token, its commands, and its Actions and Blocks projects; gives its id. */
async function deleteBot(entry: BotEntry): Promise<string> {
    requireReadable();
    const id = entry.stored.id;
    // each step lands before the next, so a retry picks up where a
    // failed one stopped
    let step = "stop the bot";
    try {
        await entry.session.stop();
        step = "remove its actions from Actions";
        if (entry.project) {
            await entry.project.remove();
            entry.project = null;
        }
        if (legacyBot === id) {
            await unregisterLegacyForwarders(entry);
            legacyBot = undefined;
        }
        step = "remove its blocks from Blocks";
        if (entry.blocks) {
            await entry.blocks.remove();
            entry.blocks = null;
            entry.blocksChanged = null;
        }
        step = "delete its token";
        await secretsApi.delete(tokenName(id), PANEL_ID);
        step = "save the bot list";
        bots.delete(id);
        try {
            await saveBots();
        } catch (err) {
            bots.set(id, entry);
            throw err;
        }
    } catch (err) {
        publish();
        throw new Error(`Couldn't ${step}: ${errorToMessage(err)}`);
    }
    publish();
    botsChanged();
    firePanelEvent("bot-deleted", { name: entry.stored.name });
    return id;
}

// a widget placed before several bots has no bot chosen: it meant the one
// there was. TODO(remove after v0.5): with the deprecated forwarders.
function widgetBot(id: unknown): BotEntry {
    if (id === undefined || id === "") {
        if (legacyBot && bots.has(legacyBot)) return bots.get(legacyBot)!;
        throw new Error("No bot is chosen for this widget. Remove it and add it again to pick one.");
    }
    return requireBot(id);
}

function requireGuild(entry: BotEntry, guildId: unknown) {
    const id = typeof guildId === "string" ? guildId.trim() : "";
    if (!id) throw new Error("A guild id is required.");
    const guild = entry.session.requireClient().guilds.cache.get(id);
    if (!guild) throw new Error(`Guild ${id} is not available to this bot.`);
    return guild;
}

export const internalActions = [
    internalAction("get-bot-info", "Get Bot Info", "Panel UI only: identity and recent-message read.", (inputs) =>
        requireBot(inputs?.bot).session.info()),

    internalAction("get-widget-status", "Get Widget Status", "Home widget only: identity, connection and server count.", (inputs) => {
        const entry = widgetBot(inputs?.bot);
        return entry.session.widgetStatus(entry.hasToken, entry.stored);
    }),

    internalAction("get-command-activity", "Get Command Activity", "Home widget only: slash commands run per hour over the last day.", (inputs) =>
        widgetBot(inputs?.bot).session.activity.snapshot()),

    internalAction("get-invite-url", "Get Invite URL", "Panel UI only: builds the invite URL for the selected permissions.", (inputs) => {
        const entry = requireBot(inputs?.bot);
        const permissions = Array.isArray(inputs?.permissions) ? inputs.permissions : [];
        return buildInviteUrl(entry.session.client?.user?.id || entry.stored.applicationId, permissions);
    }),

    internalAction("get-user-install-url", "Get User Install URL", "Panel UI only: builds the account-install URL for user-app commands.", (inputs) => {
        const entry = requireBot(inputs?.bot);
        return buildUserInstallUrl(entry.session.client?.user?.id || entry.stored.applicationId);
    }),

    internalAction(
        "add-bot",
        "Add Bot",
        "Panel UI only: adds a bot whose token the panel saved in the vault under the bot's id, once it logs in.",
        (inputs): Promise<BotSummary> => addBot(inputs?.bot),
    ),

    internalAction("connect-bot", "Connect Bot", "Panel UI only: turns a bot on with its vault token. Never accepts a token over the wire.", async (inputs) => {
        requireReadable();
        await setEnabled(widgetBot(inputs?.bot), true);
        return true;
    }),

    internalAction("disconnect-bot", "Disconnect Bot", "Panel UI only: turns a bot off.", async (inputs) => {
        requireReadable();
        await setEnabled(requireBot(inputs?.bot), false);
        return true;
    }),

    internalAction(
        "replace-token",
        "Replace Bot Token",
        "Panel UI only: the panel saved a new token for the same bot in the vault; reconnects with it when the bot is on.",
        async (inputs) => {
            await replaceToken(requireBot(inputs?.bot));
            return true;
        },
    ),

    internalAction(
        "delete-bot",
        "Delete Bot",
        "Panel UI only: stops a bot and removes it, its token, its commands, and its Actions and Blocks projects.",
        async (inputs) => ({ deleted: await deleteBot(requireBot(inputs?.bot)) }),
    ),

    internalAction("get-health", "Get Health", "Panel UI only: gateway, cache and memory health read.", (inputs) =>
        requireBot(inputs?.bot).session.health()),

    internalAction("list-guilds", "List Guilds", "Panel UI only: server summaries from the client cache.", (inputs) =>
        requireBot(inputs?.bot).session.guildSummaries()),

    internalAction("get-guild-detail", "Get Guild Detail", "Panel UI only: channels and roles for the server explorer.", (inputs) =>
        buildGuildDetail(requireGuild(requireBot(inputs?.bot), inputs?.guildId))),

    internalAction("search-guild-members", "Search Guild Members", "Panel UI only: one bounded member-search page.", async (inputs) => {
        const guild = requireGuild(requireBot(inputs?.bot), inputs?.guildId);
        const query = typeof inputs?.query === "string" ? inputs.query.trim() : "";
        // one bounded page; member search is a gateway request, never a
        // full member download
        const members = await guild.members.fetch({ query: query || undefined, limit: MEMBER_SEARCH_LIMIT });
        return buildMemberSummaries(members.values());
    }),

    internalAction("list-commands", "List Slash Commands", "Panel UI only: a bot's saved slash commands.", (inputs) =>
        requireBot(inputs?.bot).stored.commands),

    internalAction(
        "create-command",
        "Create Slash Command",
        "Panel UI only: stores a command and registers its trigger and Discord definition.",
        (input) => createCommand(requireBot(input?.bot), input),
    ),

    internalAction(
        "delete-command",
        "Delete Slash Command",
        "Panel UI only: removes a stored command, its trigger, and its Discord definition.",
        (input) => deleteCommand(requireBot(input?.bot), input?.id),
    ),
];

// what a widget's "Bot" dropdown offers in Home's gallery
const botChoices = () =>
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
const blocksBots: BotsBlocksHost = {
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
        await deleteBot(blocksBot(id));
    },
    setOn: async (id, on) => {
        requireReadable();
        await setEnabled(blocksBot(id), on);
    },
    restart: async (id) => {
        requireReadable();
        const entry = blocksBot(id);
        if (!entry.stored.enabled) throw new Error(`${entry.stored.name} is turned off. Turn it on instead.`);
        await connect(entry);
    },
    createCommand: (id, input) => createCommand(blocksBot(id), input),
    deleteCommand: (id, commandId) => deleteCommand(blocksBot(id), commandId),
    inviteLink: (id, permissions) => {
        const entry = blocksBot(id);
        return buildInviteUrl(entry.session.client?.user?.id || entry.stored.applicationId, permissions ?? DEFAULT_SELECTED_PERMISSIONS);
    },
    userInstallLink: (id) => {
        const entry = blocksBot(id);
        return buildUserInstallUrl(entry.session.client?.user?.id || entry.stored.applicationId);
    },
};

/**
 * Starts each bot without waiting for it. Logging in to Discord (and syncing commands after) can stall for minutes on a
 * rate limit; the service is ready before then, and a bot still connecting says so on its card.
 */
export function startBots<T>(entries: Iterable<T>, start: (entry: T) => Promise<void>): void {
    for (const entry of entries) {
        start(entry).catch((err) => console.error("[DiscordService] starting a bot failed:", errorToMessage(err)));
    }
}

export const botService = definePanelService({
    id: PANEL_ID,
    state: { bots: [], botsError: null } as BotsServiceState,
    actions: [...builderActions, ...internalActions],
    types: customTypes,
    categories: [...DISCORD_CATEGORIES],
    widgetChoices: {
        "bot-status": { bot: botChoices },
        "command-activity": { bot: botChoices },
    },
    async onInit(ctx: ServiceContext<BotsServiceState>) {
        serviceCtx = ctx;
        try {
            await loadBots();
        } catch (err) {
            botsError = errorToMessage(err);
            console.error("[DiscordService] reading the saved bots failed:", botsError);
        }
        // the types first: every bot's blocks use them
        try {
            await blocksApi.panel(PANEL_ID).register(panelBlocks(connectedClients, blocksBots));
            panelBlocksReady = true;
        } catch (err) {
            panelBlocksError = errorToMessage(err);
            console.error("[DiscordService] registering the Blocks types failed:", panelBlocksError);
        }
        for (const entry of bots.values()) await registerEntry(entry);
        publish();
        startBots(bots.values(), connectEntry);
        console.log(`[DiscordService] Ready with ${bots.size} bot(s); connecting them to Discord.`);
    },
});

export default botService;
