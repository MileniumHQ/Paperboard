// One bot's commands and values, bound to its live session. What each
// block does is botOps.ts and discordOps.ts; this file only says what it
// takes and gives.
import type { Client } from "discord.js";
import type { BlockCommandDefinition, BlockSet, BlockValueDefinition, BlocksProjectHandle } from "@mileniumhq/paperapi";
import { InteractionOps, MAX_RECENT_MESSAGES, MAX_POLL_HOURS, MessageOps, buildModalPayload, findMembers, resolveMember } from "../discordOps";
import { PRESENCE_STATUSES, addRole, banUser, createChannel, createInvite, createRole, createScheduledEvent, deleteChannel, deleteRole, disconnectMember, editChannel, editRole, editThread, fetchMessageIn, kickMember, leaveServer, moveMember, removeRole, removeTimeout, sendFile, sendPoll, setActivity, setChannelPermissions, setNickname, showTyping, timeoutMember, unbanUser } from "../botOps";
import type { CommandActivity, CommandUses } from "../commandActivity";
import { GLOBAL_SCOPE, errorToMessage, type SlashCommandDefinition } from "../types";
import type { BotStatus } from "./bots";
import { VISIBILITY, choice, contentInputs, unlessZero } from "./builders";
import { commandEventId, staticEvents } from "./events";
import { idOf, messageRef, optionalId, ref } from "./blockTypes";

// ─── one bot's blocks ───────────────────────────────────────────────────────

/** What a bot's blocks run against. */
export interface BotBlocksHost {
    /** the live client, or why there is none */
    client(): Client;
    interactions(): InteractionOps;
    connected(): boolean;
    /** the bot's own user id: its application's id */
    userId(): string;
    status(): BotStatus;
    /** how long it has been online; 0 while it isn't */
    uptime(): number;
    /** its slash commands, as saved */
    commands(): SlashCommandDefinition[];
    /** slash commands used per hour over the last day, counted since Bot Creator started */
    activity(): CommandActivity;
    /** how often a slash command was used since Bot Creator started, and when last; none when it wasn't */
    commandUses(command: SlashCommandDefinition): CommandUses | undefined;
}

export type Inputs = Record<string, any>;
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
            outputName: "Messages Deleted",
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
            description: "Bot Creator downloads the file from its web address and uploads it to Discord; at most 10 MB unless the server is boosted",
            text: "Send the file at {url} to {channel}, named {name}, with {content}",
            inputs: {
                url: { type: "url", name: "Link" },
                channel,
                name: { type: "text", name: "File Name", optional: true },
                content: { type: "text", name: "Content", optional: true, maxLength: 2000 },
            },
            output: "message",
            run: async (i) => ref(await sendFile(() => bot.client(), { channel: idOf(i.channel, "Channel"), url: i.url, name: i.name, content: i.content })),
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
            category: "Responses",
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
            category: "Responses",
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
            category: "Modals",
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
                await bot.interactions().showModal(i.interaction, await buildModalPayload({ title: i.title, modalId: i["modal-id"], fields: i.fields }));
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
            outputName: "Invite Link",
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
            outputName: "Event Link",
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
        {
            id: "leave-server",
            name: "Leave Server",
            category: "Server",
            icon: "domain_disabled",
            description: "The bot leaves the server. It can only come back through an invite link",
            text: "Leave {server}",
            inputs: { server: { type: "server", name: "Server" } },
            run: (i) => leaveServer(bot.client(), idOf(i.server, "Server")),
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
    const commandLabel = (command: SlashCommandDefinition) => (command.scope === GLOBAL_SCOPE ? `/${command.name}` : `/${command.name} in its server`);
    // by its event's id: like the event, it names the same command after it's made again
    const slashCommandInput = {
        type: "text",
        name: "Slash Command",
        choices: () => bot.commands().map((command) => choice(commandLabel(command), commandEventId(command))),
    } as const;
    const slashCommandOf = (value: unknown): SlashCommandDefinition => {
        const found = bot.commands().find((command) => commandEventId(command) === value);
        if (!found) throw new Error("The bot has no such slash command any more. Pick one again");
        return found;
    };
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
            id: "status",
            name: "Status",
            category: "Bot",
            icon: "radio_button_checked",
            description: "online, connecting, offline or turned off",
            type: "text",
            changes: true,
            read: () => bot.status(),
        },
        { id: "uptime", name: "Uptime", category: "Bot", icon: "timer", description: "How long the bot has been online; 0 while it's offline", type: "duration", read: () => bot.uptime() },
        {
            id: "commands-last-day",
            name: "Slash Commands Used Today",
            category: "Slash Commands",
            icon: "bar_chart",
            description: "Slash commands used in the last 24 hours. Counted since Bot Creator started, so it starts again from 0 after a restart",
            type: "number",
            read: () => bot.activity().total,
        },
        {
            id: "command-uses",
            name: "Times a Slash Command Was Used",
            category: "Slash Commands",
            icon: "tag",
            description: "Counted since Bot Creator started",
            text: "Times {command} was used",
            inputs: { command: slashCommandInput },
            type: "number",
            read: (i) => bot.commandUses(slashCommandOf(i.command))?.count ?? 0,
        },
        {
            id: "command-last-used",
            name: "When a Slash Command Was Last Used",
            category: "Slash Commands",
            icon: "history",
            description: "Since Bot Creator started",
            text: "When {command} was last used",
            inputs: { command: slashCommandInput },
            type: "timestamp",
            read: (i) => {
                const command = slashCommandOf(i.command);
                const uses = bot.commandUses(command);
                if (!uses) throw new Error(`/${command.name} hasn't been used since Bot Creator started`);
                return uses.last;
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

// ─── saying when values change ──────────────────────────────────────────────

/**
 * Tells Blocks which of the bot's changing values changed, each time the
 * session says something about it did: call the result then.
 */
export function valueChanges(blocks: BlocksProjectHandle, bot: BotBlocksHost, label: string): () => void {
    const read = () => ({ connected: bot.connected(), status: bot.status(), servers: serversOf(bot) });
    let last = read();
    return () => {
        const next = read();
        const changed = [
            ...(next.connected !== last.connected ? ["connected"] : []),
            ...(next.status !== last.status ? ["status"] : []),
            ...(next.servers.join() !== last.servers.join() ? ["servers"] : []),
            ...(next.servers.length !== last.servers.length ? ["server-count"] : []),
        ];
        last = next;
        for (const value of changed) {
            blocks.changed(value).catch((err) => console.error(`[DiscordService] ${label}: the change to ${value} did not reach Blocks:`, errorToMessage(err)));
        }
    };
}
