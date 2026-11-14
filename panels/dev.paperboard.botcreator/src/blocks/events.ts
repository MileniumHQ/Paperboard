// The events a bot's project fires, and what its session heard as each
// one's payload.
import { createHash } from "node:crypto";
import type { BlockEventDefinition } from "@mileniumhq/paperapi";
import { MAX_MODAL_FIELDS } from "../discordOps";
import { describeChannelKind } from "../explorer";
import { GLOBAL_SCOPE, commandTriggerId, type CommandOptionType, type SlashCommandDefinition } from "../types";
import type { MessageRef } from "./blockTypes";

// ─── events ─────────────────────────────────────────────────────────────────

const inServer = { type: "server", name: "Server", description: "None in a direct message", optional: true } as const;
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
const channelValues = {
    channel: { type: "channel", name: "Channel" },
    name: { type: "text", name: "Name" },
    kind: { type: "text", name: "Kind", description: "text, voice, category, announcement, stage, forum, media or other" },
    server: { type: "server", name: "Server" },
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
        category: "Buttons & Menus",
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
            pick: { type: "text", name: "Pick", description: "The first pick; none for a button", optional: true },
            picks: { type: "list<text>", name: "Picks", description: "Every pick; none for a button" },
        },
    },
    {
        id: "modal-submitted",
        name: "When a Modal Is Submitted",
        category: "Modals",
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
            ...Object.fromEntries(
                Array.from({ length: MAX_MODAL_FIELDS }, (_, i) => [`field-${i + 1}`, { type: "text", name: `Field ${i + 1}`, description: "None when the modal has fewer fields", optional: true }]),
            ),
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
        values: { user: { type: "user", name: "User" }, server: { type: "server", name: "Server" }, reason: { type: "text", name: "Reason", description: "None when none was given", optional: true } },
    },
    {
        id: "voice-changed",
        name: "When Someone Joins, Moves or Leaves Voice",
        category: "Members",
        icon: "spatial_audio",
        values: {
            member: { type: "member", name: "Member" },
            user: { type: "user", name: "User" },
            channel: { type: "channel", name: "Channel", description: "None when they left voice", optional: true },
            "previous-channel": { type: "channel", name: "Previous Channel", description: "None when they just joined", optional: true },
            server: { type: "server", name: "Server" },
        },
    },
    {
        id: "member-unbanned",
        name: "When a User Is Unbanned",
        category: "Members",
        icon: "lock_open",
        text: "When a user is unbanned in {server}",
        inputs: serverFilter,
        filters: { server: "server" },
        values: { user: { type: "user", name: "User" }, server: { type: "server", name: "Server" } },
    },
    {
        id: "nickname-changed",
        name: "When a Nickname Changes",
        category: "Members",
        icon: "badge",
        text: "When a nickname changes in {server}",
        inputs: serverFilter,
        filters: { server: "server" },
        values: {
            member: { type: "member", name: "Member" },
            user: { type: "user", name: "User" },
            server: { type: "server", name: "Server" },
            nickname: { type: "text", name: "Nickname", description: "None when it was cleared", optional: true },
            "previous-nickname": { type: "text", name: "Previous Nickname", description: "None when they had none", optional: true },
        },
    },
    { id: "role-added", name: "When a Member Gets a Role", category: "Roles", icon: "how_to_reg", text: "When a member gets {role}", inputs: { role: { type: "role", name: "Role", optional: true } }, filters: { role: "role" }, values: roleValues },
    { id: "role-removed", name: "When a Member Loses a Role", category: "Roles", icon: "do_not_disturb_on", text: "When a member loses {role}", inputs: { role: { type: "role", name: "Role", optional: true } }, filters: { role: "role" }, values: roleValues },
    {
        id: "member-roles-changed",
        name: "When a Member's Roles Change",
        category: "Roles",
        icon: "manage_accounts",
        description: "Once for each change, however many roles it gave and took",
        text: "When a member's roles change in {server}",
        inputs: serverFilter,
        filters: { server: "server" },
        values: {
            member: { type: "member", name: "Member" },
            user: { type: "user", name: "User" },
            server: { type: "server", name: "Server" },
            added: { type: "list<role>", name: "Roles Given" },
            removed: { type: "list<role>", name: "Roles Taken" },
        },
    },
    {
        id: "role-created",
        name: "When a Role Is Created",
        category: "Roles",
        icon: "add_moderator",
        text: "When a role is created in {server}",
        inputs: serverFilter,
        filters: { server: "server" },
        values: { role: { type: "role", name: "Role" }, name: { type: "text", name: "Name" }, server: { type: "server", name: "Server" } },
    },
    {
        id: "role-deleted",
        name: "When a Role Is Deleted",
        category: "Roles",
        icon: "remove_moderator",
        description: "The role is gone, so only its name and server can be read",
        text: "When a role is deleted in {server}",
        inputs: serverFilter,
        filters: { server: "server" },
        values: { role: { type: "role", name: "Role" }, name: { type: "text", name: "Name" }, server: { type: "server", name: "Server" } },
    },
    {
        id: "channel-created",
        name: "When a Channel Is Created",
        category: "Channels",
        icon: "add_comment",
        description: "Threads start When a Thread Is Started",
        text: "When a channel is created in {server}",
        inputs: serverFilter,
        filters: { server: "server" },
        values: channelValues,
    },
    {
        id: "channel-deleted",
        name: "When a Channel Is Deleted",
        category: "Channels",
        icon: "delete_forever",
        description: "The channel is gone, so only its name, kind and server can be read",
        text: "When a channel is deleted in {server}",
        inputs: serverFilter,
        filters: { server: "server" },
        values: channelValues,
    },
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
    {
        id: "bot-joined-server",
        name: "When the Bot Joins a Server",
        category: "Bot",
        icon: "domain_add",
        description: "Someone added the bot to a server while it was online",
        values: { server: { type: "server", name: "Server" }, name: { type: "text", name: "Name", description: "The server's name" } },
    },
    {
        id: "bot-left-server",
        name: "When the Bot Leaves a Server",
        category: "Bot",
        icon: "domain_disabled",
        description: "It left, was removed, or the server was deleted. The bot can't see the server any more, so only its ID and name can be read",
        values: { server: { type: "server", name: "Server" }, name: { type: "text", name: "Name", description: "The server's name; none when Discord didn't say", optional: true } },
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
 * optional one is none when it wasn't given.
 */
export function commandEvent(command: SlashCommandDefinition): BlockEventDefinition {
    const keys = optionKeys(command);
    const global = command.scope === GLOBAL_SCOPE;
    return {
        id: commandEventId(command),
        name: global ? `When /${command.name} Is Used` : `When /${command.name} Is Used in Its Server`,
        category: "Slash Commands",
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
                    return [
                        keys[index],
                        {
                            type: OPTION_TYPES[option.type],
                            name: option.name,
                            ...(option.required ? {} : { optional: true }),
                            ...(option.description ? { description: option.required ? option.description : `${option.description}. None when not given` } : {}),
                        },
                    ];
                }),
            ),
        },
    };
}

// ─── what a session fires, as Blocks events ─────────────────────────────────

const text = (value: unknown) => (value === undefined || value === null ? "" : String(value));
/** an optional value: none when the session left it out */
const maybe = (value: unknown) => (value === undefined || value === null ? null : String(value));
/** an optional id: none when it's left out or empty, as a direct message's server is */
const maybeId = (value: unknown) => (value === undefined || value === null || value === "" ? null : String(value));
const at = (id: unknown, channelId: unknown): MessageRef => ({ id: text(id), channel: text(channelId) });

/**
 * One of the session's triggers (its name and payload) as the
 * bot's Blocks event. Every trigger a session fires has one.
 */
export function blockEvent(trigger: string, output: any, commands: SlashCommandDefinition[]): { event: string; payload: Record<string, unknown> } {
    const o = output ?? {};
    const message = () => ({ message: at(o.messageId, o.channelId), content: text(o.content), author: text(o.authorId), channel: text(o.channelId), server: maybeId(o.guildId) });
    const reaction = () => ({ emoji: text(o.emoji), user: text(o.userId), message: at(o.messageId, o.channelId), channel: text(o.channelId) });
    const channelChange = () => ({ channel: text(o.channelId), name: text(o.name), kind: describeChannelKind(Number(o.type)), server: text(o.guildId) });
    const roleChange = () => ({ member: { user: text(o.userId), server: text(o.guildId) }, user: text(o.userId), role: text(o.roleId), server: text(o.guildId) });
    switch (trigger) {
        case "on-message":
            return { event: "message-received", payload: message() };
        case "on-message-edited":
            return { event: "message-edited", payload: message() };
        case "on-message-deleted":
            return { event: "message-deleted", payload: { message: at(o.messageId, o.channelId), channel: text(o.channelId), server: maybeId(o.guildId) } };
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
                    server: maybeId(o.guildId),
                    message: at(o.messageId, o.channelId),
                    pick: maybe(o.value),
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
                    server: maybeId(o.guildId),
                    ...Object.fromEntries(Array.from({ length: MAX_MODAL_FIELDS }, (_, i) => [`field-${i + 1}`, maybe(o[`field${i + 1}`])])),
                },
            };
        case "on-member-join":
            return { event: "member-joined", payload: { member: { user: text(o.userId), server: text(o.guildId) }, user: text(o.userId), server: text(o.guildId) } };
        case "on-member-leave":
            return { event: "member-left", payload: { user: text(o.userId), server: text(o.guildId) } };
        case "on-member-banned":
            return { event: "member-banned", payload: { user: text(o.userId), server: text(o.guildId), reason: maybeId(o.reason) } };
        case "on-voice-state-change":
            return {
                event: "voice-changed",
                payload: {
                    member: { user: text(o.userId), server: text(o.guildId) },
                    user: text(o.userId),
                    channel: maybeId(o.channelId),
                    "previous-channel": maybeId(o.previousChannelId),
                    server: text(o.guildId),
                },
            };
        case "on-role-added":
            return { event: "role-added", payload: roleChange() };
        case "on-role-removed":
            return { event: "role-removed", payload: roleChange() };
        case "on-member-unbanned":
            return { event: "member-unbanned", payload: { user: text(o.userId), server: text(o.guildId) } };
        case "on-nickname-changed":
            return {
                event: "nickname-changed",
                payload: {
                    member: { user: text(o.userId), server: text(o.guildId) },
                    user: text(o.userId),
                    server: text(o.guildId),
                    nickname: maybeId(o.nickname),
                    "previous-nickname": maybeId(o.previousNickname),
                },
            };
        case "on-member-roles-changed":
            return {
                event: "member-roles-changed",
                payload: {
                    member: { user: text(o.userId), server: text(o.guildId) },
                    user: text(o.userId),
                    server: text(o.guildId),
                    added: Array.isArray(o.added) ? o.added.map(text) : [],
                    removed: Array.isArray(o.removed) ? o.removed.map(text) : [],
                },
            };
        case "on-role-created":
            return { event: "role-created", payload: { role: text(o.roleId), name: text(o.name), server: text(o.guildId) } };
        case "on-role-deleted":
            return { event: "role-deleted", payload: { role: text(o.roleId), name: text(o.name), server: text(o.guildId) } };
        case "on-channel-created":
            return { event: "channel-created", payload: channelChange() };
        case "on-channel-deleted":
            return { event: "channel-deleted", payload: channelChange() };
        case "on-guild-joined":
            return { event: "bot-joined-server", payload: { server: text(o.guildId), name: text(o.guildName) } };
        case "on-guild-left":
            return { event: "bot-left-server", payload: { server: text(o.guildId), name: maybeId(o.guildName) } };
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
            server: maybeId(o.guildId),
            ...Object.fromEntries(command.options.map((option, index) => [keys[index], values[option.name] ?? null])),
        },
    };
}
