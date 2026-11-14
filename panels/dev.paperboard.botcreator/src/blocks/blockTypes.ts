// The types every bot's blocks share (a Channel, a User, a Message...),
// with the fields Blocks reads off them, and the ids they are typed as.
import type { Client } from "discord.js";
import type { BlockTypeDefinition } from "@mileniumhq/paperapi";
import { fetchMessageIn, memberRoles, messageReactions, pinnedMessages, pollResults, roleMembers } from "../botOps";
import { describeChannelKind } from "../explorer";
import { SNOWFLAKE_PATTERN, errorToMessage } from "../types";

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

export function optionalId(value: unknown, what: string): string | undefined {
    return value === undefined || value === "" ? undefined : idOf(value, what);
}

export function messageRef(value: MessageRef): MessageRef {
    return { id: idOf(value.id, "Message"), channel: idOf(value.channel, "Channel") };
}

export const ref = (message: { id: string; channelId: string }): MessageRef => ({ id: message.id, channel: message.channelId });

// ─── finding things for a type's fields ─────────────────────────────────────

/** The connected bots' clients: every bot's, or one bot's (none while it's offline). A type's fields are the panel's, so they ask whichever bot can see the value. */
export type ConnectedClients = (bot?: string) => Client[];

/** The servers the clients are in, once each, and whether there's more than one (so a choice names its server). */
function guildsOf(clients: Client[]) {
    const guilds = [...new Map(clients.flatMap((c) => [...c.guilds.cache.values()].map((g) => [g.id, g] as const))).values()];
    return { guilds, named: (label: string, guild: { name: string }) => (guilds.length > 1 ? `${label} (${guild.name})` : label) };
}

/** A Discord channel category: it holds channels, nothing is sent to it. */
const CATEGORY_CHANNEL = 4;

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
            // the servers the block's bot is in, or any bot's
            choices: ({ project }) => guildsOf(clients(project)).guilds.map((g) => ({ label: g.name, value: g.id })),
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
            choices: ({ project }) => {
                const { guilds, named } = guildsOf(clients(project));
                return guilds.flatMap((g) =>
                    [...g.channels.cache.values()]
                        .filter((c) => c.type !== CATEGORY_CHANNEL)
                        .sort((a, b) => ("position" in a ? a.position : 0) - ("position" in b ? b.position : 0))
                        .map((c) => ({ label: named(`#${c.name}`, g), value: c.id })),
                );
            },
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
                    description: "None when it has none",
                    optional: true,
                    resolve: async (v: string) => {
                        const channel = await channelOf(v);
                        if (!("topic" in channel)) throw new Error(`Channel ${channel.id} is a kind that has no topic`);
                        return channel.topic || null;
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
                    description: "None when they have none",
                    optional: true,
                    resolve: async (v: MemberRef) => (await find.member(v)).found.nickname || null,
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
            // highest first, without the everyone role, as a server's Roles reads
            choices: ({ project }) => {
                const { guilds, named } = guildsOf(clients(project));
                return guilds.flatMap((g) =>
                    [...g.roles.cache.values()]
                        .filter((r) => r.id !== g.id)
                        .sort((a, b) => b.position - a.position)
                        .map((r) => ({ label: named(`@${r.name}`, g), value: r.id })),
                );
            },
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
