// Bot Creator's blocks for the Blocks panel (Actions API v2). Each bot is a
// Blocks project of its own, with its commands, values and events; the
// panel's own handle holds the types every bot shares (a Channel, a User,
// a Message...) and the builders that never reach Discord (embeds, buttons).
//
// What the blocks do is botOps.ts and discordOps.ts, the same code the
// Actions blocks run; this file only says what each block takes and gives.
import { createHash } from "node:crypto";
import type { Client } from "discord.js";
import type {
    BlockChoice,
    BlockCommandDefinition,
    BlockEventDefinition,
    BlockSet,
    BlockTypeDefinition,
    BlockValueDefinition,
    BlocksProjectHandle,
} from "@mileniumhq/paperapi";
import {
    InteractionOps,
    MAX_RECENT_MESSAGES,
    MAX_SELECT_OPTIONS,
    MAX_POLL_HOURS,
    MAX_MODAL_FIELDS,
    MessageOps,
    buildButtonComponent,
    buildComponentRow,
    buildDiscordEmbed,
    buildModalField,
    buildModalPayload,
    buildSelectMenuComponent,
    findMembers,
    resolveMember,
} from "./discordOps";
import {
    PRESENCE_STATUSES,
    addRole,
    banUser,
    createChannel,
    createInvite,
    createRole,
    createScheduledEvent,
    deleteChannel,
    deleteRole,
    disconnectMember,
    editChannel,
    editRole,
    editThread,
    fetchMessageIn,
    kickMember,
    memberRoles,
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
} from "./botOps";
import { describeChannelKind } from "./session";
import {
    GLOBAL_SCOPE,
    SNOWFLAKE_PATTERN,
    commandTriggerId,
    errorToMessage,
    type CommandOptionType,
    type SlashCommandDefinition,
} from "./types";

/** A message, by its id and the channel it is in: a message can't be found without both. */
export interface MessageRef {
    id: string;
    channel: string;
}

/** A person as a member of one server. */
export interface MemberRef {
    user: string;
    server: string;
}

// ─── ids ────────────────────────────────────────────────────────────────────

const MENTION = /^<(?:#|@!?|@&)(\d+)>$/;

/** A Discord id from text: the id itself, or a mention of it (<#id>, <@id>, <@&id>). */
export function idOf(value: unknown, what: string): string {
    const text = typeof value === "string" ? value.trim() : "";
    const id = MENTION.exec(text)?.[1] ?? text;
    if (!SNOWFLAKE_PATTERN.test(id)) throw new Error(`"${text}" isn't a ${what} ID`);
    return id;
}

function optionalId(value: unknown, what: string): string | undefined {
    return value === undefined || value === "" ? undefined : idOf(value, what);
}

function messageRef(value: MessageRef): MessageRef {
    return { id: idOf(value.id, "Message"), channel: idOf(value.channel, "Channel") };
}

const ref = (message: { id: string; channelId: string }): MessageRef => ({ id: message.id, channel: message.channelId });

// ─── finding things for a type's fields ─────────────────────────────────────

/** The bots that are connected now: a type's fields are the panel's, so they ask whichever bot can see the value. */
export type ConnectedClients = () => Client[];

async function locate<T>(
    clients: ConnectedClients,
    what: string,
    cached: (client: Client) => T | undefined,
    fetch?: (client: Client) => Promise<T | null | undefined>,
): Promise<{ client: Client; found: T }> {
    const live = clients();
    if (!live.length) throw new Error(`No bot is connected to look up ${what}`);
    for (const client of live) {
        const found = cached(client);
        if (found) return { client, found };
    }
    if (!fetch) throw new Error(`None of the connected bots can see ${what}`);
    const problems: string[] = [];
    for (const client of live) {
        try {
            const found = await fetch(client);
            if (found) return { client, found };
            problems.push(`${what} not found`);
        } catch (err) {
            problems.push(errorToMessage(err));
        }
    }
    throw new Error(`None of the connected bots can see ${what}: ${[...new Set(problems)].join("; ")}`);
}

function finder(clients: ConnectedClients) {
    return {
        server: (value: unknown) => {
            const id = idOf(value, "Server");
            return locate(clients, `server ${id}`, (c) => c.guilds.cache.get(id));
        },
        channel: (value: unknown) => {
            const id = idOf(value, "Channel");
            return locate(clients, `channel ${id}`, (c) => c.channels.cache.get(id), (c) => c.channels.fetch(id));
        },
        user: (value: unknown) => {
            const id = idOf(value, "User");
            return locate(clients, `user ${id}`, (c) => c.users.cache.get(id), (c) => c.users.fetch(id));
        },
        role: (value: unknown) => {
            const id = idOf(value, "Role");
            return locate(clients, `role ${id}`, (c) => {
                for (const guild of c.guilds.cache.values()) {
                    const role = guild.roles.cache.get(id);
                    if (role) return role;
                }
                return undefined;
            });
        },
        member: async (value: MemberRef) => {
            const user = idOf(value.user, "User");
            const { client, found: guild } = await finder(clients).server(value.server);
            return { client, found: await guild.members.fetch(user) };
        },
        message: async (value: MessageRef) => {
            const message = messageRef(value);
            const { client } = await finder(clients).channel(message.channel);
            return { client, found: await fetchMessageIn(client, message.channel, message.id), ref: message };
        },
    };
}

// ─── types ──────────────────────────────────────────────────────────────────

/** The panel's types, for blocksApi.panel(): every bot's blocks use them. */
export function blockTypes(clients: ConnectedClients): BlockTypeDefinition[] {
    const find = finder(clients);
    const channelOf = async (value: string) => (await find.channel(value)).found as any;
    return [
        {
            id: "server",
            name: "Server",
            icon: "dns",
            description: "A Discord server, by its ID",
            base: "text",
            fields: {
                name: { type: "text", name: "Name", resolve: async (v: string) => (await find.server(v)).found.name },
                "member-count": { type: "number", name: "Member Count", resolve: async (v: string) => (await find.server(v)).found.memberCount },
                owner: { type: "user", name: "Owner", resolve: async (v: string) => (await find.server(v)).found.ownerId },
                channels: {
                    type: "list<channel>",
                    name: "Channels",
                    resolve: async (v: string) => [...(await find.server(v)).found.channels.cache.keys()],
                },
                roles: {
                    type: "list<role>",
                    name: "Roles",
                    description: "Highest first, without the everyone role",
                    resolve: async (v: string) => {
                        const guild = (await find.server(v)).found;
                        return [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position).map((r) => r.id);
                    },
                },
            },
        },
        {
            id: "channel",
            name: "Channel",
            icon: "tag",
            description: "A Discord channel or thread, by its ID",
            base: "text",
            fields: {
                name: {
                    type: "text",
                    name: "Name",
                    resolve: async (v: string) => {
                        const channel = await channelOf(v);
                        if (typeof channel.name !== "string") throw new Error(`Channel ${channel.id} has no name: it's a direct message`);
                        return channel.name;
                    },
                },
                kind: {
                    type: "text",
                    name: "Kind",
                    description: "text, voice, category, announcement, stage, forum, media or other",
                    resolve: async (v: string) => describeChannelKind(Number((await channelOf(v)).type)),
                },
                topic: {
                    type: "text",
                    name: "Topic",
                    description: "Empty when it has none",
                    resolve: async (v: string) => {
                        const channel = await channelOf(v);
                        if (!("topic" in channel)) throw new Error(`Channel ${channel.id} is a kind that has no topic`);
                        return channel.topic ?? "";
                    },
                },
                server: {
                    type: "server",
                    name: "Server",
                    resolve: async (v: string) => {
                        const channel = await channelOf(v);
                        if (!channel.guildId) throw new Error(`Channel ${channel.id} isn't in a server: it's a direct message`);
                        return channel.guildId;
                    },
                },
                mention: { type: "text", name: "Mention", resolve: (v: string) => `<#${idOf(v, "Channel")}>` },
                "pinned-messages": {
                    type: "list<message>",
                    name: "Pinned Messages",
                    description: "Newest pin first",
                    resolve: async (v: string) => {
                        const { client, found } = await find.channel(v);
                        return (await pinnedMessages(client, found.id)).map((pin) => ref(pin.message));
                    },
                },
            },
        },
        {
            id: "user",
            name: "User",
            icon: "person",
            description: "A Discord user, by their ID",
            base: "text",
            fields: {
                username: { type: "text", name: "Username", resolve: async (v: string) => (await find.user(v)).found.username },
                "display-name": { type: "text", name: "Display Name", resolve: async (v: string) => (await find.user(v)).found.displayName },
                "is-bot": { type: "boolean", name: "Is a Bot", resolve: async (v: string) => (await find.user(v)).found.bot },
                avatar: { type: "url", name: "Avatar", resolve: async (v: string) => (await find.user(v)).found.displayAvatarURL() },
                mention: { type: "text", name: "Mention", resolve: (v: string) => `<@${idOf(v, "User")}>` },
            },
        },
        {
            id: "member",
            name: "Member",
            icon: "badge",
            description: "A user as a member of one server",
            base: "object",
            fields: {
                user: { type: "user", name: "User" },
                server: { type: "server", name: "Server" },
                nickname: {
                    type: "text",
                    name: "Nickname",
                    description: "Empty when they have none",
                    resolve: async (v: MemberRef) => (await find.member(v)).found.nickname ?? "",
                },
                "display-name": { type: "text", name: "Display Name", resolve: async (v: MemberRef) => (await find.member(v)).found.displayName },
                roles: {
                    type: "list<role>",
                    name: "Roles",
                    description: "Highest first, without the everyone role",
                    resolve: async (v: MemberRef) => memberRoles((await find.member(v)).found).map((role) => role.id),
                },
                "joined-at": {
                    type: "timestamp",
                    name: "Joined At",
                    resolve: async (v: MemberRef) => {
                        const member = (await find.member(v)).found;
                        if (member.joinedTimestamp === null) throw new Error(`Discord didn't say when ${member.user.username} joined`);
                        return member.joinedTimestamp;
                    },
                },
                "timed-out": {
                    type: "boolean",
                    name: "Is Timed Out",
                    resolve: async (v: MemberRef) => ((await find.member(v)).found.communicationDisabledUntilTimestamp ?? 0) > Date.now(),
                },
                "in-voice": { type: "boolean", name: "Is in Voice", resolve: async (v: MemberRef) => Boolean((await find.member(v)).found.voice.channelId) },
                "voice-channel": {
                    type: "channel",
                    name: "Voice Channel",
                    resolve: async (v: MemberRef) => {
                        const member = (await find.member(v)).found;
                        if (!member.voice.channelId) throw new Error(`${member.user.username} isn't in a voice channel`);
                        return member.voice.channelId;
                    },
                },
            },
        },
        {
            id: "role",
            name: "Role",
            icon: "workspace_premium",
            description: "A role in a Discord server, by its ID",
            base: "text",
            fields: {
                name: { type: "text", name: "Name", resolve: async (v: string) => (await find.role(v)).found.name },
                color: { type: "color", name: "Color", resolve: async (v: string) => (await find.role(v)).found.hexColor },
                server: { type: "server", name: "Server", resolve: async (v: string) => (await find.role(v)).found.guild.id },
                mention: { type: "text", name: "Mention", resolve: (v: string) => `<@&${idOf(v, "Role")}>` },
                "member-count": {
                    type: "number",
                    name: "Member Count",
                    resolve: async (v: string) => {
                        const { client, found } = await find.role(v);
                        return (await roleMembers(client, found.id, found.guild.id)).total;
                    },
                },
                members: {
                    type: "list<user>",
                    name: "Members",
                    description: "The first 100",
                    resolve: async (v: string) => {
                        const { client, found } = await find.role(v);
                        return (await roleMembers(client, found.id, found.guild.id)).members.map((m) => m.id);
                    },
                },
            },
        },
        {
            id: "message",
            name: "Message",
            icon: "chat",
            description: "A Discord message, by its ID and its channel",
            base: "object",
            fields: {
                id: { type: "text", name: "ID" },
                channel: { type: "channel", name: "Channel" },
                content: { type: "text", name: "Content", resolve: async (v: MessageRef) => (await find.message(v)).found.content ?? "" },
                author: { type: "user", name: "Author", resolve: async (v: MessageRef) => (await find.message(v)).found.author.id },
                "sent-at": { type: "timestamp", name: "Sent At", resolve: async (v: MessageRef) => (await find.message(v)).found.createdTimestamp },
                link: { type: "url", name: "Link", resolve: async (v: MessageRef) => (await find.message(v)).found.url },
                pinned: { type: "boolean", name: "Is Pinned", resolve: async (v: MessageRef) => Boolean((await find.message(v)).found.pinned) },
                reactions: {
                    type: "list<reaction>",
                    name: "Reactions",
                    resolve: async (v: MessageRef) => {
                        const { client, ref: at } = await find.message(v);
                        return (await messageReactions(client, at.channel, at.id)).map((r) => ({ emoji: r.emoji, count: r.count, users: r.users.map((u) => u.userId) }));
                    },
                },
                poll: {
                    type: "poll",
                    name: "Poll",
                    resolve: async (v: MessageRef) => {
                        const { client, ref: at } = await find.message(v);
                        return pollResults(client, at.channel, at.id);
                    },
                },
            },
        },
        {
            id: "reaction",
            name: "Reaction",
            icon: "add_reaction",
            description: "One emoji on a message, how many reacted with it, and who (the first 100)",
            base: "object",
            fields: {
                emoji: { type: "text", name: "Emoji" },
                count: { type: "number", name: "Count" },
                users: { type: "list<user>", name: "Users" },
            },
        },
        {
            id: "poll",
            name: "Poll",
            icon: "ballot",
            base: "object",
            fields: {
                question: { type: "text", name: "Question" },
                closed: { type: "boolean", name: "Is Closed" },
                answers: { type: "list<poll-answer>", name: "Answers" },
            },
        },
        {
            id: "poll-answer",
            name: "Poll Answer",
            icon: "how_to_vote",
            base: "object",
            fields: {
                text: { type: "text", name: "Text" },
                votes: { type: "number", name: "Votes" },
            },
        },
        {
            id: "interaction",
            name: "Interaction",
            icon: "reply",
            description: "A slash command, click or form waiting for the bot's answer",
            base: "text",
        },
        { id: "embed", name: "Embed", icon: "article", description: "A rich box of text for a message", base: "object" },
        { id: "component", name: "Component", icon: "smart_button", description: "A button, a menu, or a row of them, for a message", base: "object" },
        { id: "text-field", name: "Text Field", icon: "text_fields", description: "A question in a modal", base: "object" },
    ];
}

// ─── the builders: every bot shares them ────────────────────────────────────

const choice = (label: string, value: string | number | boolean): BlockChoice => ({ label, value });
const VISIBILITY = [choice("for everyone", false), choice("only for them", true)];
const count = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => choice(String(from + i), from + i));
const contentInputs = {
    embeds: { type: "list<embed>", name: "Embeds", optional: true },
    components: { type: "list<component>", name: "Components", optional: true },
} as const;
/** A length or count where 0 means "none": a number socket starts at 0. */
const unlessZero = (n: number | undefined) => (n ? n : undefined);

/** Commands that build a value and never reach Discord: the panel's own. */
export const builderCommands: BlockCommandDefinition[] = [
    {
        id: "create-embed",
        name: "Embed",
        category: "Message Parts",
        icon: "article",
        description: "A rich box of text for Send, Reply, Respond or Follow Up",
        text: "Embed {title} saying {description} in {color}, linking {url}, with footer {footer} and image {image}",
        inputs: {
            title: { type: "text", name: "Title", maxLength: 256 },
            description: { type: "text", name: "Description", optional: true, maxLength: 4096 },
            color: { type: "color", name: "Color", optional: true },
            url: { type: "url", name: "Link", optional: true },
            footer: { type: "text", name: "Footer", optional: true, maxLength: 2048 },
            image: { type: "url", name: "Image", optional: true },
        },
        output: "embed",
        run: (inputs: { title: string; description?: string; color?: string; url?: string; footer?: string; image?: string }) =>
            buildDiscordEmbed(inputs).toJSON(),
    },
    {
        id: "create-button",
        name: "Button",
        category: "Message Parts",
        icon: "smart_button",
        description: "A button for a message's Components. A click starts When a Button or Menu Is Used with its Component ID; a link button opens its link instead",
        text: "{style} button {label} with ID {component-id}, link {url} and emoji {emoji}, {disabled}",
        inputs: {
            style: {
                type: "text",
                name: "Style",
                choices: [choice("Primary", "primary"), choice("Secondary", "secondary"), choice("Success", "success"), choice("Danger", "danger"), choice("Link", "link")],
            },
            label: { type: "text", name: "Label", maxLength: 80 },
            "component-id": { type: "text", name: "Component ID", optional: true, maxLength: 100 },
            url: { type: "url", name: "Link", optional: true },
            emoji: { type: "text", name: "Emoji", optional: true },
            disabled: { type: "boolean", name: "Disabled", choices: [choice("enabled", false), choice("disabled", true)] },
        },
        output: "component",
        run: (inputs: { style: string; label: string; "component-id"?: string; url?: string; emoji?: string; disabled: boolean }) => {
            // the builder's own message names Actions' "Interaction ID"
            if (inputs.style !== "link" && !inputs["component-id"]?.trim()) {
                throw new Error(`The ${inputs.style} button "${inputs.label}" needs a Component ID, so a flow can react to it`);
            }
            return buildButtonComponent({
                style: inputs.style,
                label: inputs.label,
                ...(inputs["component-id"] ? { customId: inputs["component-id"] } : {}),
                ...(inputs.url ? { url: inputs.url } : {}),
                ...(inputs.emoji ? { emoji: inputs.emoji } : {}),
                disabled: inputs.disabled,
            });
        },
    },
    {
        id: "create-select-menu",
        name: "Select Menu",
        category: "Message Parts",
        icon: "arrow_drop_down_circle",
        description: "A dropdown for a message's Components. It fills a row of its own; a pick starts When a Button or Menu Is Used with its Component ID. Options are only for a menu of options",
        text: "Menu of {menu} with ID {component-id}: {options}, {min-picks} to {max-picks} picks, hint {placeholder}",
        inputs: {
            menu: { type: "text", name: "Menu", choices: [choice("options", "text"), choice("users", "user"), choice("roles", "role"), choice("channels", "channel")] },
            "component-id": { type: "text", name: "Component ID", maxLength: 100 },
            options: { type: "list<text>", name: "Options", optional: true },
            "min-picks": { type: "number", name: "Fewest Picks", choices: [...count(1, MAX_SELECT_OPTIONS), choice("0", 0)] },
            "max-picks": { type: "number", name: "Most Picks", choices: count(1, MAX_SELECT_OPTIONS) },
            placeholder: { type: "text", name: "Hint", optional: true, maxLength: 150 },
        },
        output: "component",
        run: (inputs: { menu: string; "component-id": string; options?: string[]; "min-picks": number; "max-picks": number; placeholder?: string }) =>
            buildSelectMenuComponent({
                menu: inputs.menu,
                customId: inputs["component-id"],
                options: inputs.options,
                minValues: inputs["min-picks"],
                maxValues: inputs["max-picks"],
                placeholder: inputs.placeholder,
            }),
    },
    {
        id: "create-interaction-row",
        name: "Component Row",
        category: "Message Parts",
        icon: "view_week",
        description: "Up to five buttons, or one select menu, on one row. Components before or after it go on their own rows",
        text: "Row of {components}",
        inputs: { components: { type: "list<component>", name: "Components" } },
        output: "component",
        run: (inputs: { components: unknown[] }) => buildComponentRow(inputs.components),
    },
    {
        id: "create-text-field",
        name: "Text Field",
        category: "Modals",
        icon: "text_fields",
        description: `A question for Show Modal. Answers arrive in order as Field 1 to Field ${MAX_MODAL_FIELDS} of When a Modal Is Submitted. A length of 0 is no limit`,
        text: "{style} text field {label}, hint {placeholder}, prefilled with {value}, {required}, {min-length} to {max-length} characters",
        inputs: {
            style: { type: "text", name: "Style", choices: [choice("One-line", "short"), choice("Paragraph", "paragraph")] },
            label: { type: "text", name: "Label", maxLength: 45 },
            placeholder: { type: "text", name: "Hint", optional: true, maxLength: 100 },
            value: { type: "text", name: "Answer", optional: true, maxLength: 4000 },
            required: { type: "boolean", name: "Required", choices: [choice("required", true), choice("optional", false)] },
            "min-length": { type: "number", name: "Shortest", optional: true, integer: true, min: 0, max: 4000 },
            "max-length": { type: "number", name: "Longest", optional: true, integer: true, min: 0, max: 4000 },
        },
        output: "text-field",
        run: (inputs: { style: string; label: string; placeholder?: string; value?: string; required: boolean; "min-length"?: number; "max-length"?: number }) =>
            buildModalField({
                style: inputs.style,
                label: inputs.label,
                placeholder: inputs.placeholder,
                value: inputs.value,
                required: inputs.required,
                minLength: unlessZero(inputs["min-length"]),
                maxLength: unlessZero(inputs["max-length"]),
            }),
    },
];

// ─── one bot's blocks ───────────────────────────────────────────────────────

/** What a bot's blocks run against. */
export interface BotBlocksHost {
    /** the live client, or why there is none */
    client(): Client;
    interactions(): InteractionOps;
    connected(): boolean;
    /** the bot's own user id: its application's id */
    userId(): string;
}

type Inputs = Record<string, any>;
const server = { type: "server", name: "Server", optional: true, description: "Needed only when the bot is in more than one server" } as const;
const reason = { type: "text", name: "Reason", optional: true, maxLength: 512 } as const;
const channel = { type: "channel", name: "Channel" } as const;
const message = { type: "message", name: "Message" } as const;
const user = { type: "user", name: "User" } as const;
const role = { type: "role", name: "Role" } as const;
const interaction = { type: "interaction", name: "Interaction" } as const;

async function channelServer(client: Client, channelId: string): Promise<string> {
    const found = await new MessageOps(client).fetchChannel(channelId);
    if (!found.guildId) throw new Error(`Channel ${channelId} isn't in a server`);
    return found.guildId;
}

function roleServer(client: Client, roleId: string): string {
    for (const guild of client.guilds.cache.values()) {
        if (guild.roles.cache.has(roleId)) return guild.id;
    }
    throw new Error(`Role ${roleId} isn't in any server this bot is in`);
}

function payload(inputs: Inputs) {
    return { content: inputs.content, embeds: inputs.embeds, components: inputs.components };
}

/** The servers a bot is in; none while it's offline. */
export function serversOf(bot: BotBlocksHost): string[] {
    return bot.connected() ? [...bot.client().guilds.cache.keys()] : [];
}

/** The commands, values and events of one bot, bound to it. */
export function botBlocks(bot: BotBlocksHost): BlockSet {
    const ops = () => new MessageOps(bot.client());
    const commands: BlockCommandDefinition<Inputs>[] = [
        // messages
        {
            id: "send-message",
            name: "Send Message",
            category: "Messages",
            icon: "send",
            text: "Send {content} to {channel} with {embeds} and {components}",
            inputs: { content: { type: "text", name: "Content", maxLength: 2000 }, channel, ...contentInputs },
            output: "message",
            run: async (i) => ref(await ops().sendMessage(idOf(i.channel, "Channel"), payload(i))),
        },
        {
            id: "reply-to-message",
            name: "Reply to Message",
            category: "Messages",
            icon: "reply",
            text: "Reply to {message} with {content}, {embeds} and {components}",
            inputs: { message, content: { type: "text", name: "Content", maxLength: 2000 }, ...contentInputs },
            output: "message",
            run: async (i) => {
                const at = messageRef(i.message);
                return ref(await ops().replyMessage(at.channel, at.id, payload(i)));
            },
        },
        {
            id: "send-dm",
            name: "Send Direct Message",
            category: "Messages",
            icon: "person",
            description: "Discord only lets a bot message people who share a server with it, or who installed it",
            text: "Send {content} to {user} directly with {embeds} and {components}",
            inputs: { content: { type: "text", name: "Content", maxLength: 2000 }, user, ...contentInputs },
            output: "message",
            run: async (i) => ref(await ops().dmMessage(idOf(i.user, "User"), payload(i))),
        },
        {
            id: "edit-message",
            name: "Edit Message",
            category: "Messages",
            icon: "edit",
            description: "Edits a message the bot sent. What is left empty stays as it was",
            text: "Edit {message} to say {content} with {embeds} and {components}",
            inputs: { message, content: { type: "text", name: "Content", optional: true, maxLength: 2000 }, ...contentInputs },
            run: async (i) => {
                const at = messageRef(i.message);
                await ops().edit(at.channel, at.id, payload(i));
            },
        },
        {
            id: "delete-message",
            name: "Delete Message",
            category: "Messages",
            icon: "delete",
            text: "Delete {message}",
            inputs: { message },
            run: async (i) => {
                const at = messageRef(i.message);
                await ops().delete(at.channel, at.id);
            },
        },
        {
            id: "purge-messages",
            name: "Purge Messages",
            category: "Messages",
            icon: "delete_sweep",
            description: "Deletes a channel's newest messages and gives how many went. Discord only bulk-deletes messages under two weeks old",
            text: "Delete the last {count} messages in {channel}",
            inputs: { count: { type: "number", name: "Count", integer: true, min: 1, max: 100 }, channel },
            output: "number",
            run: (i) => ops().bulkDelete(idOf(i.channel, "Channel"), i.count),
        },
        {
            id: "pin-message",
            name: "Pin Message",
            category: "Messages",
            icon: "push_pin",
            text: "Pin {message}",
            inputs: { message },
            run: async (i) => {
                const at = messageRef(i.message);
                await ops().pin(at.channel, at.id);
            },
        },
        {
            id: "unpin-message",
            name: "Unpin Message",
            category: "Messages",
            icon: "keep_off",
            text: "Unpin {message}",
            inputs: { message },
            run: async (i) => {
                const at = messageRef(i.message);
                await ops().unpin(at.channel, at.id);
            },
        },
        {
            id: "crosspost-message",
            name: "Crosspost Message",
            category: "Messages",
            icon: "podcasts",
            description: "Publishes a message in an announcement channel to every server following it",
            text: "Crosspost {message}",
            inputs: { message },
            run: async (i) => {
                const at = messageRef(i.message);
                await ops().crosspost(at.channel, at.id);
            },
        },
        {
            id: "send-poll",
            name: "Send Poll",
            category: "Messages",
            icon: "ballot",
            text: "Send poll {question} to {channel} with {answers} for {hours} hours, {multiple}",
            inputs: {
                question: { type: "text", name: "Question", maxLength: 300 },
                channel,
                answers: { type: "list<text>", name: "Answers" },
                hours: { type: "number", name: "Hours", integer: true, min: 1, max: MAX_POLL_HOURS },
                multiple: { type: "boolean", name: "Answers Each", choices: [choice("one answer each", false), choice("several answers each", true)] },
            },
            output: "message",
            run: async (i) => ref(await sendPoll(bot.client(), { channel: idOf(i.channel, "Channel"), question: i.question, answers: i.answers, hours: i.hours, multiple: i.multiple })),
        },
        {
            id: "send-file",
            name: "Send File",
            category: "Messages",
            icon: "attach_file",
            description: "Discord downloads the file from its web address; at most 10 MB unless the server is boosted",
            text: "Send the file at {url} to {channel}, named {name}, with {content}",
            inputs: {
                url: { type: "url", name: "Link" },
                channel,
                name: { type: "text", name: "File Name", optional: true },
                content: { type: "text", name: "Content", optional: true, maxLength: 2000 },
            },
            output: "message",
            run: async (i) => ref(await sendFile(bot.client(), { channel: idOf(i.channel, "Channel"), url: i.url, name: i.name, content: i.content })),
        },
        {
            id: "show-typing",
            name: "Show Typing",
            category: "Messages",
            icon: "more_horiz",
            description: "For about ten seconds, or until the bot sends a message",
            text: "Show typing in {channel}",
            inputs: { channel },
            run: (i) => showTyping(bot.client(), idOf(i.channel, "Channel")),
        },
        // reactions
        {
            id: "add-reaction",
            name: "Add Reaction",
            category: "Reactions",
            icon: "add_reaction",
            text: "React to {message} with {emoji}",
            inputs: { message, emoji: { type: "text", name: "Emoji" } },
            run: async (i) => {
                const at = messageRef(i.message);
                await ops().react(at.channel, at.id, i.emoji);
            },
        },
        {
            id: "remove-reaction",
            name: "Remove Reaction",
            category: "Reactions",
            icon: "heart_broken",
            description: "Without a user, the emoji goes for everyone",
            text: "Remove {emoji} from {message} for {user}",
            inputs: { emoji: { type: "text", name: "Emoji" }, message, user: { ...user, optional: true } },
            run: async (i) => {
                const at = messageRef(i.message);
                await ops().removeReaction(at.channel, at.id, i.emoji, optionalId(i.user, "User"));
            },
        },
        // interactions
        {
            id: "respond-to-interaction",
            name: "Respond to Interaction",
            category: "Interactions",
            icon: "reply",
            description: "Answers a slash command, button, menu or modal. Responding again edits the answer",
            text: "Respond to {interaction} with {content}, {embeds} and {components}, {ephemeral}",
            inputs: {
                interaction,
                content: { type: "text", name: "Content", optional: true, maxLength: 2000 },
                ...contentInputs,
                ephemeral: { type: "boolean", name: "Visibility", choices: VISIBILITY },
            },
            run: async (i) => {
                await bot.interactions().respond(i.interaction, { ...payload(i), ephemeral: i.ephemeral });
            },
        },
        {
            id: "follow-up-interaction",
            name: "Follow Up to Interaction",
            category: "Interactions",
            icon: "forward",
            description: "Sends another message after the answer to an interaction",
            text: "Follow up {interaction} with {content}, {embeds} and {components}, {ephemeral}",
            inputs: {
                interaction,
                content: { type: "text", name: "Content", optional: true, maxLength: 2000 },
                ...contentInputs,
                ephemeral: { type: "boolean", name: "Visibility", choices: VISIBILITY },
            },
            output: "message",
            run: async (i) => {
                const sent = await bot.interactions().followUpMessage(i.interaction, { ...payload(i), ephemeral: i.ephemeral });
                return { id: sent.id, channel: sent.channelId };
            },
        },
        {
            id: "show-modal",
            name: "Show Modal",
            category: "Interactions",
            icon: "dynamic_form",
            description: "Opens a form for whoever used a slash command, button or menu. It must be the first answer; the reply starts When a Modal Is Submitted",
            text: "Show modal {title} with ID {modal-id} and {fields} for {interaction}",
            inputs: {
                title: { type: "text", name: "Title", maxLength: 45 },
                "modal-id": { type: "text", name: "Modal ID", maxLength: 100 },
                fields: { type: "list<text-field>", name: "Text Fields" },
                interaction,
            },
            run: async (i) => {
                await bot.interactions().showModal(i.interaction, buildModalPayload({ title: i.title, modalId: i["modal-id"], fields: i.fields }));
            },
        },
        // channels
        {
            id: "create-channel",
            name: "Create Channel",
            category: "Channels",
            icon: "add_comment",
            description: "A topic is only for a text channel",
            text: "Create {kind} channel {name} in {server} about {topic}",
            inputs: {
                kind: { type: "text", name: "Kind", choices: [choice("a text", "text"), choice("a voice", "voice"), choice("an announcement", "announcement"), choice("a category", "category")] },
                name: { type: "text", name: "Name", maxLength: 100 },
                server,
                topic: { type: "text", name: "Topic", optional: true, maxLength: 1024 },
            },
            output: "channel",
            run: async (i) => (await createChannel(bot.client(), { name: i.name, kind: i.kind, topic: i.topic, guildId: optionalId(i.server, "Server") })).id,
        },
        {
            id: "delete-channel",
            name: "Delete Channel",
            category: "Channels",
            icon: "delete_forever",
            text: "Delete {channel}",
            inputs: { channel },
            run: (i) => deleteChannel(bot.client(), idOf(i.channel, "Channel")),
        },
        {
            id: "rename-channel",
            name: "Rename Channel",
            category: "Channels",
            icon: "edit",
            description: "Threads too",
            text: "Rename {channel} to {name}",
            inputs: { channel, name: { type: "text", name: "Name", maxLength: 100 } },
            run: (i) => editChannel(bot.client(), idOf(i.channel, "Channel"), { name: i.name }),
        },
        {
            id: "set-channel-topic",
            name: "Set Channel Topic",
            category: "Channels",
            icon: "subject",
            description: "An empty topic clears it",
            text: "Set the topic of {channel} to {topic}",
            inputs: { channel, topic: { type: "text", name: "Topic", optional: true, maxLength: 1024 } },
            run: (i) => editChannel(bot.client(), idOf(i.channel, "Channel"), { topic: i.topic ?? "" }),
        },
        {
            id: "set-slowmode",
            name: "Set Slowmode",
            category: "Channels",
            icon: "hourglass",
            description: "How long each person waits between messages; 0 turns it off",
            text: "Set slowmode in {channel} to {seconds} seconds",
            inputs: { channel, seconds: { type: "number", name: "Seconds", integer: true, min: 0, max: 21_600 } },
            run: (i) => editChannel(bot.client(), idOf(i.channel, "Channel"), { slowmode: i.seconds }),
        },
        {
            id: "set-channel-permissions",
            name: "Set Channel Permissions",
            category: "Channels",
            icon: "lock",
            description:
                "Discord's permission names, like ViewChannel, SendMessages or Connect. Role or User is a role, a user, or everyone (denying everyone SendMessages locks the channel). " +
                "Permissions in no list stay as they are; Reset ones go back to the server's",
            text: "In {channel}, allow {allow}, deny {deny} and reset {reset} for {target} because {reason}",
            inputs: {
                channel,
                allow: { type: "list<text>", name: "Allow", optional: true },
                deny: { type: "list<text>", name: "Deny", optional: true },
                reset: { type: "list<text>", name: "Reset", optional: true },
                target: { type: "text", name: "Role or User" },
                reason,
            },
            run: (i) => {
                const target = String(i.target).trim();
                return setChannelPermissions(bot.client(), {
                    allow: i.allow,
                    deny: i.deny,
                    reset: i.reset,
                    reason: i.reason,
                    channel: idOf(i.channel, "Channel"),
                    target: target.toLowerCase() === "everyone" || target === "@everyone" ? target : idOf(target, "Role or User"),
                });
            },
        },
        {
            id: "create-invite",
            name: "Create Invite",
            category: "Channels",
            icon: "link",
            description: "An invite that never expires; 0 uses is no limit",
            text: "Create an invite to {channel} for {uses} uses",
            inputs: { channel, uses: { type: "number", name: "Uses", integer: true, min: 0, max: 100 } },
            output: "url",
            run: (i) => createInvite(bot.client(), idOf(i.channel, "Channel"), i.uses),
        },
        {
            id: "create-thread",
            name: "Create Thread",
            category: "Channels",
            icon: "forum",
            text: "Start thread {name} from {message}",
            inputs: { name: { type: "text", name: "Name", maxLength: 100 }, message },
            output: "channel",
            run: async (i) => {
                const at = messageRef(i.message);
                return ops().startThread(at.channel, at.id, i.name);
            },
        },
        {
            id: "edit-thread",
            name: "Archive or Lock Thread",
            category: "Channels",
            icon: "forum",
            description: "A locked thread only moderators can reopen",
            text: "Set {thread} to {archived} and {locked}",
            inputs: {
                thread: { type: "channel", name: "Thread" },
                archived: { type: "boolean", name: "Archived", choices: [choice("archived", true), choice("open", false)] },
                locked: { type: "boolean", name: "Locked", choices: [choice("unlocked", false), choice("locked", true)] },
            },
            run: (i) => editThread(bot.client(), idOf(i.thread, "Thread"), { archived: i.archived, locked: i.locked }),
        },
        // members
        {
            id: "kick-member",
            name: "Kick Member",
            category: "Members",
            icon: "logout",
            text: "Kick {user} from {server} because {reason}",
            inputs: { user, server, reason },
            run: (i) => kickMember(bot.client(), idOf(i.user, "User"), i.reason, optionalId(i.server, "Server")),
        },
        {
            id: "ban-user",
            name: "Ban User",
            category: "Members",
            icon: "block",
            text: "Ban {user} from {server}, deleting {days} days of their messages, because {reason}",
            inputs: { user, server, days: { type: "number", name: "Days", integer: true, min: 0, max: 7 }, reason },
            run: (i) => banUser(bot.client(), idOf(i.user, "User"), { deleteDays: i.days, reason: i.reason, guildId: optionalId(i.server, "Server") }),
        },
        {
            id: "unban-user",
            name: "Unban User",
            category: "Members",
            icon: "person_remove",
            text: "Unban {user} in {server}",
            inputs: { user, server },
            run: (i) => unbanUser(bot.client(), idOf(i.user, "User"), optionalId(i.server, "Server")),
        },
        {
            id: "timeout-member",
            name: "Time Out Member",
            category: "Members",
            icon: "timer",
            description: "At most 28 days (40320 minutes)",
            text: "Time out {user} in {server} for {minutes} minutes because {reason}",
            inputs: { user, server, minutes: { type: "number", name: "Minutes", integer: true, min: 1, max: 40_320 }, reason },
            run: (i) => timeoutMember(bot.client(), idOf(i.user, "User"), { minutes: i.minutes, reason: i.reason, guildId: optionalId(i.server, "Server") }),
        },
        {
            id: "remove-timeout",
            name: "End Timeout",
            category: "Members",
            icon: "timer_off",
            text: "End the timeout of {user} in {server} because {reason}",
            inputs: { user, server, reason },
            run: (i) => removeTimeout(bot.client(), idOf(i.user, "User"), i.reason, optionalId(i.server, "Server")),
        },
        {
            id: "set-nickname",
            name: "Set Nickname",
            category: "Members",
            icon: "edit",
            description: "An empty nickname clears it. The bot's own user renames the bot in that server",
            text: "Set the nickname of {user} in {server} to {nickname} because {reason}",
            inputs: { user, server, nickname: { type: "text", name: "Nickname", optional: true, maxLength: 32 }, reason },
            run: (i) => setNickname(bot.client(), idOf(i.user, "User"), { nickname: i.nickname, reason: i.reason, guildId: optionalId(i.server, "Server") }),
        },
        {
            id: "move-member",
            name: "Move Member",
            category: "Members",
            icon: "swap_horiz",
            description: "Moves someone already in voice to another voice channel",
            text: "Move {user} to {channel}",
            inputs: { user, channel: { type: "channel", name: "Voice Channel" } },
            run: async (i) => {
                const to = idOf(i.channel, "Channel");
                await moveMember(bot.client(), idOf(i.user, "User"), to, await channelServer(bot.client(), to));
            },
        },
        {
            id: "disconnect-member",
            name: "Disconnect Member",
            category: "Members",
            icon: "voice_over_off",
            text: "Disconnect {user} from voice in {server}",
            inputs: { user, server },
            run: (i) => disconnectMember(bot.client(), idOf(i.user, "User"), optionalId(i.server, "Server")),
        },
        // roles
        {
            id: "add-role",
            name: "Give Role",
            category: "Roles",
            icon: "how_to_reg",
            text: "Give {role} to {user}",
            inputs: { role, user },
            run: (i) => {
                const id = idOf(i.role, "Role");
                return addRole(bot.client(), idOf(i.user, "User"), id, roleServer(bot.client(), id));
            },
        },
        {
            id: "remove-role",
            name: "Take Role",
            category: "Roles",
            icon: "do_not_disturb_on",
            text: "Take {role} from {user}",
            inputs: { role, user },
            run: (i) => {
                const id = idOf(i.role, "Role");
                return removeRole(bot.client(), idOf(i.user, "User"), id, roleServer(bot.client(), id));
            },
        },
        {
            id: "create-role",
            name: "Create Role",
            category: "Roles",
            icon: "add_moderator",
            text: "Create role {name} in {color} in {server}",
            inputs: { name: { type: "text", name: "Name", maxLength: 100 }, color: { type: "color", name: "Color", optional: true }, server },
            output: "role",
            run: async (i) => (await createRole(bot.client(), { name: i.name, color: i.color, guildId: optionalId(i.server, "Server") })).id,
        },
        {
            id: "delete-role",
            name: "Delete Role",
            category: "Roles",
            icon: "remove_moderator",
            text: "Delete {role}",
            inputs: { role },
            run: (i) => {
                const id = idOf(i.role, "Role");
                return deleteRole(bot.client(), id, roleServer(bot.client(), id));
            },
        },
        {
            id: "rename-role",
            name: "Rename Role",
            category: "Roles",
            icon: "edit",
            text: "Rename {role} to {name}",
            inputs: { role, name: { type: "text", name: "Name", maxLength: 100 } },
            run: (i) => {
                const id = idOf(i.role, "Role");
                return editRole(bot.client(), id, { name: i.name, guildId: roleServer(bot.client(), id) });
            },
        },
        {
            id: "set-role-color",
            name: "Set Role Color",
            category: "Roles",
            icon: "palette",
            text: "Set the color of {role} to {color}",
            inputs: { role, color: { type: "color", name: "Color" } },
            run: (i) => {
                const id = idOf(i.role, "Role");
                return editRole(bot.client(), id, { color: i.color, guildId: roleServer(bot.client(), id) });
            },
        },
        {
            id: "set-role-display",
            name: "Set How a Role Shows",
            category: "Roles",
            icon: "workspace_premium",
            text: "Show {role} {hoist} in the member list, {mentionable}",
            inputs: {
                role,
                hoist: { type: "boolean", name: "Listed Apart", choices: [choice("apart", true), choice("with everyone", false)] },
                mentionable: { type: "boolean", name: "Mentionable", choices: [choice("mentionable by anyone", true), choice("not mentionable", false)] },
            },
            run: (i) => {
                const id = idOf(i.role, "Role");
                return editRole(bot.client(), id, { hoist: i.hoist, mentionable: i.mentionable, guildId: roleServer(bot.client(), id) });
            },
        },
        // the server
        {
            id: "create-event",
            name: "Schedule Event",
            category: "Server",
            icon: "event",
            description:
                "A server event people can say they're going to. In a voice or stage channel it needs only a start; anywhere else a location and an end. " +
                "An end of 0 is none. Gives the event's link",
            text: "Schedule {name} from {start} to {end} in {channel} at {location} in {server}: {description}",
            inputs: {
                name: { type: "text", name: "Name", maxLength: 100 },
                start: { type: "timestamp", name: "Start" },
                end: { type: "timestamp", name: "End", optional: true },
                channel: { type: "channel", name: "Voice Channel", optional: true },
                location: { type: "text", name: "Location", optional: true, maxLength: 100 },
                server,
                description: { type: "text", name: "Description", optional: true, maxLength: 1000 },
            },
            output: "url",
            run: (i) =>
                createScheduledEvent(bot.client(), {
                    name: i.name,
                    start: i.start,
                    end: unlessZero(i.end),
                    channel: optionalId(i.channel, "Channel"),
                    location: i.location,
                    description: i.description,
                    guildId: optionalId(i.server, "Server"),
                }),
        },
        // the bot
        {
            id: "set-activity",
            name: "Set Bot Activity",
            category: "Bot",
            icon: "tune",
            text: "Set the bot's activity to {activity} and its status to {status}",
            inputs: {
                activity: { type: "text", name: "Activity", maxLength: 128 },
                status: {
                    type: "text",
                    name: "Status",
                    choices: PRESENCE_STATUSES.map((s) => choice(s === "dnd" ? "Do Not Disturb" : s.charAt(0).toUpperCase() + s.slice(1), s)),
                },
            },
            run: (i) => setActivity(bot.client(), i.activity, i.status),
        },
    ];

    const servers = () => serversOf(bot);
    const values: BlockValueDefinition<Inputs>[] = [
        { id: "connected", name: "Connected", category: "Bot", icon: "wifi", description: "Whether the bot is online in Discord", type: "boolean", changes: true, read: () => bot.connected() },
        { id: "servers", name: "Servers", category: "Bot", icon: "dns", description: "The servers the bot is in; none while it's offline", type: "list<server>", changes: true, read: servers },
        { id: "server-count", name: "Server Count", category: "Bot", icon: "tag", type: "number", changes: true, read: () => servers().length },
        { id: "bot-user", name: "Bot User", category: "Bot", icon: "smart_toy", description: "The bot's own Discord user", type: "user", read: () => bot.userId() },
        {
            id: "latency",
            name: "Latency",
            category: "Bot",
            icon: "speed",
            description: "How long Discord takes to answer the bot's heartbeat",
            type: "duration",
            read: () => {
                const ping = bot.client().ws.ping;
                if (!(ping >= 0)) throw new Error("Discord hasn't answered the bot's first heartbeat yet");
                return ping;
            },
        },
        {
            id: "message",
            name: "Message by ID",
            category: "Messages",
            icon: "chat",
            text: "Message {id} in {channel}",
            inputs: { id: { type: "text", name: "ID" }, channel },
            type: "message",
            read: async (i) => ref(await fetchMessageIn(bot.client(), idOf(i.channel, "Channel"), idOf(i.id, "Message"))),
        },
        {
            id: "recent-messages",
            name: "Recent Messages",
            category: "Messages",
            icon: "forum",
            description: "Oldest first",
            text: "Last {count} messages in {channel}",
            inputs: { count: { type: "number", name: "Count", integer: true, min: 1, max: MAX_RECENT_MESSAGES }, channel },
            type: "list<message>",
            read: async (i) => {
                const at = idOf(i.channel, "Channel");
                return (await ops().recent(at, i.count)).map((m) => ({ id: m.id, channel: at }));
            },
        },
        {
            id: "member",
            name: "Member",
            category: "Members",
            icon: "badge",
            text: "{user} as a member of {server}",
            inputs: { user, server },
            type: "member",
            read: async (i) => {
                const member = await resolveMember(bot.client(), idOf(i.user, "User"), optionalId(i.server, "Server"));
                return { user: member.id, server: member.guild.id };
            },
        },
        {
            id: "find-members",
            name: "Find Members",
            category: "Members",
            icon: "person_search",
            description: "People whose username or nickname starts with the name, exact names first, at most 25. Without a server, every server the bot is in",
            text: "Members named {name} in {server}",
            inputs: { name: { type: "text", name: "Name" }, server: { ...server, description: "Every server the bot is in, when left empty" } },
            type: "list<member>",
            read: async (i) =>
                (await findMembers(bot.client(), i.name, optionalId(i.server, "Server"))).map((m) => ({ user: m.userId, server: m.guildId })),
        },
    ];
    return { commands, values, events: staticEvents };
}

// ─── events ─────────────────────────────────────────────────────────────────

const inServer = { type: "server", name: "Server", description: "Empty in a direct message" } as const;
const messageValues = {
    message: { type: "message", name: "Message" },
    content: { type: "text", name: "Content" },
    author: { type: "user", name: "Author" },
    channel: { type: "channel", name: "Channel" },
    server: inServer,
} as const;
const channelFilter = { channel: { type: "channel", name: "Channel", optional: true } } as const;
const serverFilter = { server: { type: "server", name: "Server", optional: true } } as const;
const reactionValues = {
    emoji: { type: "text", name: "Emoji" },
    user: { type: "user", name: "User" },
    message: { type: "message", name: "Message" },
    channel: { type: "channel", name: "Channel" },
} as const;
const roleValues = {
    member: { type: "member", name: "Member" },
    user: { type: "user", name: "User" },
    role: { type: "role", name: "Role" },
    server: { type: "server", name: "Server" },
} as const;

export const staticEvents: BlockEventDefinition[] = [
    { id: "message-received", name: "When a Message Is Received", category: "Messages", icon: "chat", text: "When a message is received in {channel}", inputs: channelFilter, filters: { channel: "channel" }, values: messageValues },
    { id: "message-edited", name: "When a Message Is Edited", category: "Messages", icon: "edit_note", text: "When a message is edited in {channel}", inputs: channelFilter, filters: { channel: "channel" }, values: messageValues },
    {
        id: "message-deleted",
        name: "When a Message Is Deleted",
        category: "Messages",
        icon: "delete",
        text: "When a message is deleted in {channel}",
        inputs: channelFilter,
        filters: { channel: "channel" },
        values: { message: { type: "message", name: "Message" }, channel: { type: "channel", name: "Channel" }, server: inServer },
    },
    {
        id: "reaction-added",
        name: "When a Reaction Is Added",
        category: "Reactions",
        icon: "add_reaction",
        text: "When {emoji} is added to a message",
        inputs: { emoji: { type: "text", name: "Emoji", optional: true } },
        filters: { emoji: "emoji" },
        values: reactionValues,
    },
    {
        id: "reaction-removed",
        name: "When a Reaction Is Removed",
        category: "Reactions",
        icon: "heart_broken",
        text: "When {emoji} is removed from a message",
        inputs: { emoji: { type: "text", name: "Emoji", optional: true } },
        filters: { emoji: "emoji" },
        values: reactionValues,
    },
    {
        id: "component-used",
        name: "When a Button or Menu Is Used",
        category: "Interactions",
        icon: "touch_app",
        description: "A click on a button, or a pick from a menu, of a message this bot sent. Answer it with Respond to Interaction",
        text: "When {component-id} is used",
        inputs: { "component-id": { type: "text", name: "Component ID", optional: true } },
        filters: { "component-id": "component-id" },
        values: {
            "component-id": { type: "text", name: "Component ID" },
            interaction: { type: "interaction", name: "Interaction" },
            user: { type: "user", name: "User" },
            channel: { type: "channel", name: "Channel" },
            server: inServer,
            message: { type: "message", name: "Message" },
            pick: { type: "text", name: "Pick", description: "The first pick; empty for a button" },
            picks: { type: "list<text>", name: "Picks", description: "Every pick; none for a button" },
        },
    },
    {
        id: "modal-submitted",
        name: "When a Modal Is Submitted",
        category: "Interactions",
        icon: "dynamic_form",
        description: "Field 1 is the first text field's answer, and so on",
        text: "When modal {modal-id} is submitted",
        inputs: { "modal-id": { type: "text", name: "Modal ID", optional: true } },
        filters: { "modal-id": "modal-id" },
        values: {
            "modal-id": { type: "text", name: "Modal ID" },
            interaction: { type: "interaction", name: "Interaction" },
            user: { type: "user", name: "User" },
            channel: { type: "channel", name: "Channel" },
            server: inServer,
            ...Object.fromEntries(Array.from({ length: MAX_MODAL_FIELDS }, (_, i) => [`field-${i + 1}`, { type: "text", name: `Field ${i + 1}` }])),
        },
    },
    {
        id: "member-joined",
        name: "When a Member Joins",
        category: "Members",
        icon: "person_add",
        text: "When a member joins {server}",
        inputs: serverFilter,
        filters: { server: "server" },
        values: { member: { type: "member", name: "Member" }, user: { type: "user", name: "User" }, server: { type: "server", name: "Server" } },
    },
    {
        id: "member-left",
        name: "When a Member Leaves",
        category: "Members",
        icon: "person_remove",
        text: "When a member leaves {server}",
        inputs: serverFilter,
        filters: { server: "server" },
        values: { user: { type: "user", name: "User" }, server: { type: "server", name: "Server" } },
    },
    {
        id: "member-banned",
        name: "When a User Is Banned",
        category: "Members",
        icon: "block",
        text: "When a user is banned from {server}",
        inputs: serverFilter,
        filters: { server: "server" },
        values: { user: { type: "user", name: "User" }, server: { type: "server", name: "Server" }, reason: { type: "text", name: "Reason", description: "Empty when none was given" } },
    },
    {
        id: "voice-changed",
        name: "When Someone Joins, Moves or Leaves Voice",
        category: "Members",
        icon: "spatial_audio",
        values: {
            member: { type: "member", name: "Member" },
            user: { type: "user", name: "User" },
            channel: { type: "channel", name: "Channel", description: "Empty when they left voice" },
            "previous-channel": { type: "channel", name: "Previous Channel", description: "Empty when they just joined" },
            server: { type: "server", name: "Server" },
        },
    },
    { id: "role-added", name: "When a Member Gets a Role", category: "Roles", icon: "how_to_reg", text: "When a member gets {role}", inputs: { role: { ...role, optional: true } }, filters: { role: "role" }, values: roleValues },
    { id: "role-removed", name: "When a Member Loses a Role", category: "Roles", icon: "do_not_disturb_on", text: "When a member loses {role}", inputs: { role: { ...role, optional: true } }, filters: { role: "role" }, values: roleValues },
    {
        id: "thread-created",
        name: "When a Thread Is Started",
        category: "Channels",
        icon: "forum",
        text: "When a thread is started in {channel}",
        inputs: channelFilter,
        filters: { channel: "channel" },
        values: {
            thread: { type: "channel", name: "Thread" },
            name: { type: "text", name: "Name" },
            channel: { type: "channel", name: "Channel", description: "The channel it was started in" },
            owner: { type: "user", name: "Owner" },
            server: { type: "server", name: "Server" },
        },
    },
    { id: "bot-ready", name: "When the Bot Is Ready", category: "Bot", icon: "verified", description: "Each time the bot's connection to Discord goes live", values: { bot: { type: "user", name: "Bot User" } } },
    { id: "connection-failed", name: "When the Connection Fails", category: "Bot", icon: "error", values: { error: { type: "text", name: "Error" } } },
];

// ─── slash commands ─────────────────────────────────────────────────────────

const OPTION_TYPES: Record<CommandOptionType, string> = {
    string: "text",
    integer: "number",
    number: "number",
    boolean: "boolean",
    user: "user",
    channel: "channel",
    role: "role",
    mentionable: "text",
};

/** The event a slash command starts, by its scope and name, so a recreated command keeps its flows. */
export function commandEventId(command: { scope: string; name: string }): string {
    const hash = createHash("sha256").update(`${command.scope}:${command.name}`).digest("hex").slice(0, 10);
    return `slash-${command.name.replace(/_/g, "-")}-${hash}`;
}

/** Each option's key in the event's values, in the command's order. */
function optionKeys(command: SlashCommandDefinition): string[] {
    const taken = new Set<string>();
    return command.options.map((option) => {
        const base = `option-${option.name.replace(/_/g, "-")}`;
        let key = base;
        for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
        taken.add(key);
        return key;
    });
}

/**
 * The event a slash command starts. Each option is a value of its type; an
 * optional one is empty when it wasn't given, so an optional number or
 * true/false option is "any".
 */
export function commandEvent(command: SlashCommandDefinition): BlockEventDefinition {
    const keys = optionKeys(command);
    const global = command.scope === GLOBAL_SCOPE;
    return {
        id: commandEventId(command),
        name: global ? `When /${command.name} Is Used` : `When /${command.name} Is Used in Its Server`,
        category: "Commands",
        icon: "terminal",
        description: global
            ? command.userInstall
                ? `Anywhere /${command.name} is installed: servers, DMs and group chats. Answer it with Respond to Interaction`
                : `In any server. Answer it with Respond to Interaction`
            : `In the server it's registered to. Answer it with Respond to Interaction`,
        values: {
            interaction: { type: "interaction", name: "Interaction" },
            user: { type: "user", name: "User" },
            channel: { type: "channel", name: "Channel" },
            server: inServer,
            ...Object.fromEntries(
                command.options.map((option, index) => {
                    const type = OPTION_TYPES[option.type];
                    const loose = !option.required && (type === "number" || type === "boolean");
                    return [
                        keys[index],
                        {
                            type: loose ? "any" : type,
                            name: option.name,
                            ...(option.description ? { description: option.required ? option.description : `${option.description}. Empty when not given` } : {}),
                        },
                    ];
                }),
            ),
        },
    };
}

// ─── what a session fires, as Blocks events ─────────────────────────────────

const text = (value: unknown) => (value === undefined || value === null ? "" : String(value));
const at = (id: unknown, channelId: unknown): MessageRef => ({ id: text(id), channel: text(channelId) });

/**
 * One of the session's triggers (its Actions event and payload) as the
 * bot's Blocks event. Every trigger a session fires has one.
 */
export function blockEvent(trigger: string, output: any, commands: SlashCommandDefinition[]): { event: string; payload: Record<string, unknown> } {
    const o = output ?? {};
    const message = () => ({ message: at(o.messageId, o.channelId), content: text(o.content), author: text(o.authorId), channel: text(o.channelId), server: text(o.guildId) });
    const reaction = () => ({ emoji: text(o.emoji), user: text(o.userId), message: at(o.messageId, o.channelId), channel: text(o.channelId) });
    const roleChange = () => ({ member: { user: text(o.userId), server: text(o.guildId) }, user: text(o.userId), role: text(o.roleId), server: text(o.guildId) });
    switch (trigger) {
        case "on-message":
            return { event: "message-received", payload: message() };
        case "on-message-edited":
            return { event: "message-edited", payload: message() };
        case "on-message-deleted":
            return { event: "message-deleted", payload: { message: at(o.messageId, o.channelId), channel: text(o.channelId), server: text(o.guildId) } };
        case "on-reaction-add":
            return { event: "reaction-added", payload: reaction() };
        case "on-reaction-removed":
            return { event: "reaction-removed", payload: reaction() };
        case "interaction-triggered":
            return {
                event: "component-used",
                payload: {
                    "component-id": text(o.customId),
                    interaction: text(o.interactionId),
                    user: text(o.userId),
                    channel: text(o.channelId),
                    server: text(o.guildId),
                    message: at(o.messageId, o.channelId),
                    pick: text(o.value),
                    picks: Array.isArray(o.values) ? o.values.map(text) : [],
                },
            };
        case "modal-submitted":
            return {
                event: "modal-submitted",
                payload: {
                    "modal-id": text(o.modalId),
                    interaction: text(o.interactionId),
                    user: text(o.userId),
                    channel: text(o.channelId),
                    server: text(o.guildId),
                    ...Object.fromEntries(Array.from({ length: MAX_MODAL_FIELDS }, (_, i) => [`field-${i + 1}`, text(o[`field${i + 1}`])])),
                },
            };
        case "on-member-join":
            return { event: "member-joined", payload: { member: { user: text(o.userId), server: text(o.guildId) }, user: text(o.userId), server: text(o.guildId) } };
        case "on-member-leave":
            return { event: "member-left", payload: { user: text(o.userId), server: text(o.guildId) } };
        case "on-member-banned":
            return { event: "member-banned", payload: { user: text(o.userId), server: text(o.guildId), reason: text(o.reason) } };
        case "on-voice-state-change":
            return {
                event: "voice-changed",
                payload: {
                    member: { user: text(o.userId), server: text(o.guildId) },
                    user: text(o.userId),
                    channel: text(o.channelId),
                    "previous-channel": text(o.previousChannelId),
                    server: text(o.guildId),
                },
            };
        case "on-role-added":
            return { event: "role-added", payload: roleChange() };
        case "on-role-removed":
            return { event: "role-removed", payload: roleChange() };
        case "on-thread-created":
            return { event: "thread-created", payload: { thread: text(o.threadId), name: text(o.name), channel: text(o.channelId), owner: text(o.ownerId), server: text(o.guildId) } };
        case "on-bot-ready":
            return { event: "bot-ready", payload: { bot: text(o.userId) } };
        case "on-connection-error":
            return { event: "connection-failed", payload: { error: text(o.error) } };
    }
    const command = commands.find((c) => commandTriggerId(c) === trigger);
    if (!command) throw new Error(`The trigger ${trigger} has no Blocks event`);
    const values = o.values ?? {};
    const keys = optionKeys(command);
    return {
        event: commandEventId(command),
        payload: {
            interaction: text(o.interactionId),
            user: text(o.userId),
            channel: text(o.channelId),
            server: text(o.guildId),
            ...Object.fromEntries(command.options.map((option, index) => [keys[index], values[option.name] ?? ""])),
        },
    };
}

// ─── saying when values change ──────────────────────────────────────────────

/**
 * Tells Blocks which of the bot's changing values changed, each time the
 * session says something about it did: call the result then.
 */
export function valueChanges(blocks: BlocksProjectHandle, bot: BotBlocksHost, label: string): () => void {
    const read = () => ({ connected: bot.connected(), servers: serversOf(bot) });
    let last = read();
    return () => {
        const next = read();
        const changed = [
            ...(next.connected !== last.connected ? ["connected"] : []),
            ...(next.servers.join() !== last.servers.join() ? ["servers"] : []),
            ...(next.servers.length !== last.servers.length ? ["server-count"] : []),
        ];
        last = next;
        for (const value of changed) {
            blocks.changed(value).catch((err) => console.error(`[DiscordService] ${label}: the change to ${value} did not reach Blocks:`, errorToMessage(err)));
        }
    };
}

/** Bot Creator's panel-wide blocks: the types, and the builders. */
export function panelBlocks(clients: ConnectedClients): BlockSet {
    return { types: blockTypes(clients), commands: builderCommands };
}

