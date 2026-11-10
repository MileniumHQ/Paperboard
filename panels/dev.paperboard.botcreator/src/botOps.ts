// What a bot does in Discord, once: each operation takes the bot's client
// and plain inputs. Actions (service.ts) and Blocks (blocks.ts) both call
// these, so the two APIs never drift; each only shapes what it returns.
import {
    ActivityType,
    ChannelType,
    GuildScheduledEventEntityType,
    GuildScheduledEventPrivacyLevel,
    type Client,
    type ColorResolvable,
    type Guild,
    type GuildMember,
    type Message,
} from "discord.js";
import {
    MessageOps,
    buildPoll,
    fileFromUrl,
    parseMoment,
    permissionNames,
    resolveGuild,
    resolveMember,
} from "./discordOps";
import { SNOWFLAKE_PATTERN } from "./types";

// discord presence statuses — the only legal values for set-status
export const PRESENCE_STATUSES = ["online", "idle", "dnd", "invisible"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export function validatePresenceStatus(status: unknown): PresenceStatus {
    if (typeof status === "string" && (PRESENCE_STATUSES as readonly string[]).includes(status)) {
        return status as PresenceStatus;
    }
    throw new Error(
        `Unknown status "${String(status)}": expected one of ${PRESENCE_STATUSES.join(", ")}`,
    );
}

/** The most members List Role Members (and a role's Members) gives. */
export const MAX_LISTED_MEMBERS = 100;

// ─── finding things ─────────────────────────────────────────────────────────

export async function verifyChannel(bot: Client, channelId: string): Promise<string> {
    const channel = await bot.channels.fetch(channelId.trim());
    if (!channel) throw new Error(`Channel ${channelId} not found`);
    return channelId.trim();
}

export async function verifyUser(bot: Client, userId: string): Promise<string> {
    const user = await bot.users.fetch(userId.trim());
    if (!user) throw new Error(`User ${userId} not found`);
    return userId.trim();
}

export async function fetchMessageIn(bot: Client, channelId: string, messageId: string): Promise<Message> {
    const channel = await bot.channels.fetch(channelId.trim());
    if (channel && "messages" in channel) {
        const msg = await (channel as any).messages.fetch(messageId.trim());
        if (!msg) throw new Error(`Message ${messageId} not found`);
        return msg;
    }
    throw new Error(`Channel ${channelId} not found or not text-based`);
}

export function describeMember(member: GuildMember) {
    return {
        userId: member.id,
        username: member.user.username,
        displayName: member.displayName,
        nickname: member.nickname,
        bot: member.user.bot,
        roles: memberRoles(member).map((role) => ({ id: role.id, name: role.name })),
        joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
        timedOutUntil: member.communicationDisabledUntil && member.communicationDisabledUntil.getTime() > Date.now()
            ? member.communicationDisabledUntil.toISOString()
            : null,
        voiceChannelId: member.voice?.channelId ?? null,
        guildId: member.guild.id,
    };
}

/** A member's roles, highest first, without the server's everyone role. */
export function memberRoles(member: GuildMember) {
    return [...member.roles.cache.values()]
        .filter((role) => role.id !== member.guild.id)
        .sort((a, b) => b.position - a.position);
}

export async function roleMembers(bot: Client, roleId: string, guildId?: string) {
    const guild = await resolveGuild(bot, guildId);
    const role = await guild.roles.fetch(roleId.trim());
    if (!role) throw new Error(`Role ${roleId} not found`);
    // the whole member list once, so the role's members aren't only the cached ones
    await guild.members.fetch();
    const members = [...role.members.values()];
    return { role, total: members.length, members: members.slice(0, MAX_LISTED_MEMBERS) };
}

export async function pinnedMessages(bot: Client, channelId: string): Promise<{ message: any; pinnedAt: Date }[]> {
    const channel = await new MessageOps(bot).fetchChannel(channelId);
    if (!("messages" in channel)) throw new Error(`Channel ${channelId} not found or not text-based`);
    const pins = await channel.messages.fetchPins();
    return pins.items;
}

export async function messageReactions(bot: Client, channelId: string, messageId: string) {
    const message = await new MessageOps(bot).fetchMessage(channelId, messageId);
    const out = [];
    for (const reaction of message.reactions.cache.values()) {
        const users = await reaction.users.fetch({ limit: 100 });
        out.push({
            emoji: reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : String(reaction.emoji.name ?? ""),
            count: reaction.count as number,
            users: [...users.values()].map((user: any) => ({ userId: String(user.id), username: String(user.username) })),
        });
    }
    return out;
}

export async function pollResults(bot: Client, channelId: string, messageId: string) {
    const message = await new MessageOps(bot).fetchMessage(channelId, messageId);
    if (!message.poll) throw new Error(`Message ${messageId} isn't a poll`);
    const poll = message.poll;
    return {
        question: poll.question.text ?? "",
        closed: Boolean(poll.resultsFinalized) || (poll.expiresTimestamp !== null && poll.expiresTimestamp <= Date.now()),
        answers: [...poll.answers.values()].map((answer: any) => ({ text: answer.text ?? "", votes: answer.voteCount ?? 0 })),
    };
}

// ─── messages ───────────────────────────────────────────────────────────────

async function sendableChannel(bot: Client, channelId: string) {
    const channel = await new MessageOps(bot).fetchChannel(channelId);
    if (!("send" in channel)) throw new Error(`Channel ${channelId} can't take messages`);
    return channel;
}

export async function sendPoll(bot: Client, inputs: { channel: string; question: unknown; answers: unknown; hours?: unknown; multiple?: unknown }): Promise<Message> {
    const poll = buildPoll(inputs);
    const channel = await sendableChannel(bot, inputs.channel);
    return channel.send({ poll });
}

export async function sendFile(bot: Client, inputs: { channel: string; url: unknown; name?: unknown; content?: string }): Promise<Message> {
    const file = fileFromUrl(inputs.url, inputs.name);
    const channel = await sendableChannel(bot, inputs.channel);
    return channel.send({ ...(inputs.content ? { content: inputs.content } : {}), files: [file] });
}

export async function showTyping(bot: Client, channelId: string): Promise<void> {
    const channel = await new MessageOps(bot).fetchChannel(channelId);
    if (!("sendTyping" in channel)) throw new Error(`Channel ${channelId} isn't one people type in`);
    await channel.sendTyping();
}

// ─── the bot ────────────────────────────────────────────────────────────────

export function setActivity(bot: Client, activity: string, status?: string): void {
    const presence = validatePresenceStatus(status || "online");
    bot.user?.setPresence({
        activities: [{ name: activity, type: ActivityType.Custom }],
        status: presence,
    });
}

// ─── roles ──────────────────────────────────────────────────────────────────

export async function addRole(bot: Client, userId: string, roleId: string, guildId?: string): Promise<void> {
    const member = await resolveMember(bot, userId, guildId);
    await member.roles.add(roleId.trim());
}

export async function removeRole(bot: Client, userId: string, roleId: string, guildId?: string): Promise<void> {
    const member = await resolveMember(bot, userId, guildId);
    await member.roles.remove(roleId.trim());
}

export async function createRole(bot: Client, inputs: { name: string; color?: string; guildId?: string }) {
    const guild = await resolveGuild(bot, inputs.guildId);
    return guild.roles.create({
        name: inputs.name.trim(),
        ...(inputs.color ? { color: inputs.color as ColorResolvable } : {}),
    });
}

async function fetchRole(guild: Guild, roleId: string) {
    const role = await guild.roles.fetch(roleId.trim());
    if (!role) throw new Error(`Role ${roleId} not found`);
    return role;
}

export async function deleteRole(bot: Client, roleId: string, guildId?: string): Promise<void> {
    const role = await fetchRole(await resolveGuild(bot, guildId), roleId);
    await role.delete();
}

export async function editRole(
    bot: Client,
    roleId: string,
    inputs: { name?: string; color?: string; hoist?: boolean; mentionable?: boolean; guildId?: string },
): Promise<void> {
    const changes = {
        ...(inputs.name ? { name: inputs.name.trim() } : {}),
        ...(inputs.color ? { color: inputs.color as ColorResolvable } : {}),
        ...(typeof inputs.hoist === "boolean" ? { hoist: inputs.hoist } : {}),
        ...(typeof inputs.mentionable === "boolean" ? { mentionable: inputs.mentionable } : {}),
    };
    if (!Object.keys(changes).length) throw new Error("Edit Role needs a name, color, or setting to change");
    const role = await fetchRole(await resolveGuild(bot, inputs.guildId), roleId);
    await role.edit(changes);
}

// ─── members ────────────────────────────────────────────────────────────────

export async function banUser(bot: Client, userId: string, inputs: { deleteDays?: number; reason?: string; guildId?: string }): Promise<void> {
    const guild = await resolveGuild(bot, inputs.guildId);
    const days = Math.max(0, Math.min(7, Math.floor(Number(inputs.deleteDays ?? 0))));
    await guild.members.ban(userId.trim(), {
        deleteMessageSeconds: days * 86_400,
        ...(inputs.reason ? { reason: inputs.reason } : {}),
    });
}

export async function unbanUser(bot: Client, userId: string, guildId?: string): Promise<void> {
    const guild = await resolveGuild(bot, guildId);
    await guild.members.unban(userId.trim());
}

export async function kickMember(bot: Client, userId: string, reason?: string, guildId?: string): Promise<void> {
    const member = await resolveMember(bot, userId, guildId);
    await member.kick(reason ?? undefined);
}

export async function timeoutMember(bot: Client, userId: string, inputs: { minutes?: number; reason?: string; guildId?: string }): Promise<void> {
    const member = await resolveMember(bot, userId, inputs.guildId);
    const minutes = Math.max(1, Math.min(40_320, Math.floor(Number(inputs.minutes ?? 10))));
    await member.timeout(minutes * 60_000, inputs.reason ?? undefined);
}

export async function removeTimeout(bot: Client, userId: string, reason?: string, guildId?: string): Promise<void> {
    const member = await resolveMember(bot, userId, guildId);
    await member.timeout(null, reason || undefined);
}

export async function setNickname(bot: Client, userId: string, inputs: { nickname?: string; reason?: string; guildId?: string }): Promise<void> {
    const nickname = (inputs.nickname ?? "").trim();
    if (nickname.length > 32) throw new Error("A nickname is at most 32 characters");
    const member = await resolveMember(bot, userId, inputs.guildId);
    await member.setNickname(nickname || null, inputs.reason || undefined);
}

async function memberInVoice(bot: Client, userId: string, guildId?: string): Promise<GuildMember> {
    const member = await resolveMember(bot, userId, guildId);
    if (!member.voice.channel) throw new Error(`User ${userId} is not connected to a voice channel`);
    return member;
}

export async function moveMember(bot: Client, userId: string, channelId: string, guildId?: string): Promise<void> {
    const member = await memberInVoice(bot, userId, guildId);
    await member.voice.setChannel(channelId.trim());
}

export async function disconnectMember(bot: Client, userId: string, guildId?: string): Promise<void> {
    const member = await memberInVoice(bot, userId, guildId);
    await member.voice.disconnect();
}

// ─── channels ───────────────────────────────────────────────────────────────

const CHANNEL_KINDS = {
    text: ChannelType.GuildText,
    voice: ChannelType.GuildVoice,
    announcement: ChannelType.GuildAnnouncement,
    category: ChannelType.GuildCategory,
} as const;

export async function createChannel(bot: Client, inputs: { name: string; kind?: string; topic?: string; guildId?: string }) {
    const guild = await resolveGuild(bot, inputs.guildId);
    const kind = (CHANNEL_KINDS as Record<string, (typeof CHANNEL_KINDS)[keyof typeof CHANNEL_KINDS]>)[(inputs.kind || "text").toLowerCase()];
    if (kind === undefined) throw new Error(`Unknown channel kind "${inputs.kind}"`);
    return guild.channels.create({
        name: inputs.name.trim(),
        type: kind,
        ...(inputs.topic && kind === ChannelType.GuildText ? { topic: inputs.topic } : {}),
    });
}

export async function deleteChannel(bot: Client, channelId: string): Promise<void> {
    const channel = await new MessageOps(bot).fetchChannel(channelId);
    await channel.delete();
}

export async function editChannel(bot: Client, channelId: string, inputs: { name?: string; topic?: string; slowmode?: number }): Promise<void> {
    const channel = await new MessageOps(bot).fetchChannel(channelId);
    if (inputs.name === undefined && inputs.topic === undefined && inputs.slowmode === undefined) {
        throw new Error("Edit Channel needs a name, topic, or slowmode to change");
    }
    await channel.edit({
        ...(inputs.name !== undefined ? { name: inputs.name } : {}),
        ...(inputs.topic !== undefined ? { topic: inputs.topic } : {}),
        ...(inputs.slowmode !== undefined
            ? { rateLimitPerUser: Math.max(0, Math.min(21_600, Math.floor(Number(inputs.slowmode)))) }
            : {}),
    });
}

export async function createInvite(bot: Client, channelId: string, maxUses?: number): Promise<string> {
    const channel = await new MessageOps(bot).fetchChannel(channelId);
    if (!("createInvite" in channel)) throw new Error(`Channel ${channelId} cannot have invites`);
    const uses = Math.max(0, Math.min(100, Math.floor(Number(maxUses ?? 0))));
    const invite = await channel.createInvite({ maxUses: uses, maxAge: 0, unique: true });
    return invite.url;
}

/** Set Channel Permissions' inputs as one overwrite: true allows, false denies, null resets. */
export function channelPermissionChanges(inputs: { allow?: unknown; deny?: unknown; reset?: unknown }): Record<string, boolean | null> {
    const changes: Record<string, boolean | null> = {};
    const lists: [unknown, boolean | null][] = [[inputs.allow, true], [inputs.deny, false], [inputs.reset, null]];
    for (const [list, value] of lists) {
        for (const name of permissionNames(list)) {
            if (name in changes && changes[name] !== value) throw new Error(`${name} is named in more than one list`);
            changes[name] = value;
        }
    }
    if (!Object.keys(changes).length) throw new Error("Name at least one permission to allow, deny, or reset");
    return changes;
}

export async function setChannelPermissions(
    bot: Client,
    inputs: { channel: string; target: string; allow?: unknown; deny?: unknown; reset?: unknown; reason?: string },
): Promise<void> {
    const changes = channelPermissionChanges(inputs);
    const channel = await new MessageOps(bot).fetchChannel(inputs.channel);
    if (!channel.guild || !channel.permissionOverwrites) throw new Error(`Channel ${inputs.channel} isn't a server channel with permissions`);
    const raw = inputs.target.trim();
    const target = raw.toLowerCase() === "everyone" || raw === "@everyone" ? channel.guild.id : raw;
    if (!SNOWFLAKE_PATTERN.test(target)) throw new Error(`"${raw}" isn't a role id, a user id, or everyone`);
    await channel.permissionOverwrites.edit(target, changes, { reason: inputs.reason || undefined });
}

export async function editThread(bot: Client, threadId: string, inputs: { name?: string; archived?: boolean; locked?: boolean }): Promise<void> {
    const changes = {
        ...(inputs.name ? { name: inputs.name.trim() } : {}),
        ...(typeof inputs.archived === "boolean" ? { archived: inputs.archived } : {}),
        ...(typeof inputs.locked === "boolean" ? { locked: inputs.locked } : {}),
    };
    if (!Object.keys(changes).length) throw new Error("Edit Thread needs a name, or to archive or lock it");
    const channel = await new MessageOps(bot).fetchChannel(threadId);
    if (!channel.isThread?.()) throw new Error(`Channel ${threadId} isn't a thread`);
    await channel.edit(changes);
}

// ─── scheduled events ───────────────────────────────────────────────────────

/** Create Scheduled Event's inputs as Discord's options, refused with what's missing. */
export async function scheduledEventOptions(
    bot: Client,
    inputs: { name: string; start: unknown; end?: unknown; channel?: string; location?: string; description?: string },
) {
    const name = (inputs.name ?? "").trim();
    if (!name || name.length > 100) throw new Error("An event's name is 1 to 100 characters");
    const start = parseMoment(inputs.start, "Starts");
    if (start.getTime() <= Date.now()) throw new Error("An event starts in the future");
    const end = inputs.end === undefined || inputs.end === "" ? undefined : parseMoment(inputs.end, "Ends");
    if (end && end.getTime() <= start.getTime()) throw new Error("An event ends after it starts");
    const description = inputs.description?.trim() ? { description: inputs.description.trim() } : {};
    const base = { name, scheduledStartTime: start, privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly, ...description };
    if (inputs.channel && inputs.channel.trim()) {
        const channel = await bot.channels.fetch(inputs.channel.trim());
        const type = (channel as any)?.type;
        if (type !== ChannelType.GuildVoice && type !== ChannelType.GuildStageVoice) throw new Error(`Channel ${inputs.channel} isn't a voice or stage channel`);
        return {
            ...base,
            ...(end ? { scheduledEndTime: end } : {}),
            entityType: type === ChannelType.GuildStageVoice ? GuildScheduledEventEntityType.StageInstance : GuildScheduledEventEntityType.Voice,
            channel: channel!.id,
        };
    }
    const location = inputs.location?.trim() ?? "";
    if (!location) throw new Error("An event outside a voice channel needs a location");
    if (!end) throw new Error("An event outside a voice channel needs an end");
    return { ...base, scheduledEndTime: end, entityType: GuildScheduledEventEntityType.External, entityMetadata: { location } };
}

export async function createScheduledEvent(
    bot: Client,
    inputs: { name: string; start: unknown; end?: unknown; channel?: string; location?: string; description?: string; guildId?: string },
): Promise<string> {
    const options = await scheduledEventOptions(bot, inputs);
    const guild = await resolveGuild(bot, inputs.guildId);
    const event = await guild.scheduledEvents.create(options);
    return event.url;
}
