// What happens in a bot's servers (messages, members, servers, channels,
// roles, reactions, threads, voice), as the bot's Blocks events. Its
// session hands over the client's events while the client is its own.
import type { ClientEvents } from "discord.js";
import { errorToMessage } from "./types";
import type { RecentMessage } from "./session";

/** Listens to one of a client's events while it is the session's own. */
export type On = <E extends keyof ClientEvents>(event: E, listener: (...args: ClientEvents[E]) => void) => void;

/** Where the relayed events go: the bot's session. */
interface RelayTarget {
    /** fires one of the bot's triggers */
    emit(trigger: string, output: unknown): void;
    /** the bot's servers or their counts changed; every window is told */
    changed(): void;
    /** a message for the bot's Recent messages */
    heard(message: RecentMessage): void;
    /** a failure no button waits for, for the bot's Overview */
    noteProblem(text: string): void;
}

/** What happens in the bot's servers, as its Blocks events. */
export function relayEvents(on: On, session: RelayTarget): void {
    on("messageCreate", (msg) => {
        if (msg.author.bot) return;
        const payload = {
            content: msg.content,
            author: msg.author.username,
            authorId: msg.author.id,
            channelId: msg.channelId,
            guildId: msg.guildId,
            messageId: msg.id,
        };
        session.heard(payload);
        session.emit("on-message", payload);
    });

    // every window shows each server with its member, channel and role
    // counts: a change to any of them is announced with the bot
    on("guildMemberAdd", (member) => {
        session.changed();
        session.emit("on-member-join", {
            username: member.user.username,
            userId: member.user.id,
            guildId: member.guild.id,
            guildName: member.guild.name,
        });
    });

    on("guildMemberRemove", (member) => {
        session.changed();
        session.emit("on-member-leave", {
            username: member.user.username,
            userId: member.user.id,
            guildId: member.guild.id,
        });
    });

    // discord.js says guildCreate only for a server joined while
    // connected, and guildDelete only for one left (an outage is
    // guildUnavailable); a rename or a new icon is guildUpdate
    on("guildCreate", (guild) => {
        session.changed();
        session.emit("on-guild-joined", { guildId: guild.id, guildName: guild.name });
    });
    on("guildDelete", (guild) => {
        session.changed();
        session.emit("on-guild-left", { guildId: guild.id, guildName: guild.name ?? "" });
    });
    on("guildUpdate", () => session.changed());

    on("channelCreate", (channel) => {
        session.changed();
        session.emit("on-channel-created", { channelId: channel.id, name: channel.name, type: channel.type, guildId: channel.guildId });
    });
    on("channelDelete", (channel) => {
        if (channel.isDMBased()) return;
        session.changed();
        session.emit("on-channel-deleted", { channelId: channel.id, name: channel.name, type: channel.type, guildId: channel.guildId });
    });

    on("roleCreate", (role) => {
        session.changed();
        session.emit("on-role-created", { roleId: role.id, name: role.name, guildId: role.guild.id });
    });
    on("roleDelete", (role) => {
        session.changed();
        session.emit("on-role-deleted", { roleId: role.id, name: role.name, guildId: role.guild.id });
    });

    on("guildBanRemove", (ban) => {
        session.emit("on-member-unbanned", { userId: ban.user.id, username: ban.user.username, guildId: ban.guild.id });
    });

    on("messageReactionAdd", (reaction, user) => {
        if (user.bot) return;
        session.emit("on-reaction-add", {
            emoji: reaction.emoji.name || reaction.emoji.id,
            userId: user.id,
            username: user.username,
            messageId: reaction.message.id,
            channelId: reaction.message.channelId,
        });
    });

    on("messageReactionRemove", (reaction, user) => {
        if (user.bot) return;
        session.emit("on-reaction-removed", {
            emoji: reaction.emoji.name || reaction.emoji.id,
            userId: user.id,
            username: user.username,
            messageId: reaction.message.id,
            channelId: reaction.message.channelId,
        });
    });

    on("messageUpdate", (_oldMsg, newMsg) => {
        const apply = async () => {
            const msg = newMsg.partial ? await newMsg.fetch().catch((err: unknown) => {
                session.noteProblem(`An edited message in channel ${newMsg.channelId} couldn't be read, so When a Message Is Edited didn't run: ${errorToMessage(err)}`);
                return null;
            }) : newMsg;
            if (!msg || msg.author?.bot) return;
            session.emit("on-message-edited", {
                content: msg.content ?? "",
                author: msg.author?.username ?? "",
                authorId: msg.author?.id ?? "",
                channelId: msg.channelId,
                guildId: msg.guildId,
                messageId: msg.id,
            });
        };
        void apply();
    });

    on("messageDelete", (msg) => {
        session.emit("on-message-deleted", {
            messageId: msg.id,
            channelId: msg.channelId,
            guildId: msg.guildId ?? "",
        });
    });

    on("guildBanAdd", (ban) => {
        session.emit("on-member-banned", {
            userId: ban.user.id,
            username: ban.user.username,
            reason: ban.reason ?? "",
            guildId: ban.guild.id,
        });
    });

    on("guildMemberUpdate", (oldMember, newMember) => {
        const before = new Set((oldMember?.roles?.cache?.keys?.() ?? []) as Iterable<string>);
        const added = [...newMember.roles.cache.keys()].filter((roleId) => !before.has(roleId));
        const removed = [...before].filter((roleId) => !newMember.roles.cache.has(roleId));
        if (added.length || removed.length) {
            session.emit("on-member-roles-changed", { userId: newMember.user.id, guildId: newMember.guild.id, added, removed });
        }
        // a member discord.js hadn't seen before arrives partial: what its nickname was isn't known
        if (!oldMember.partial && oldMember.nickname !== newMember.nickname) {
            session.emit("on-nickname-changed", {
                userId: newMember.user.id,
                guildId: newMember.guild.id,
                nickname: newMember.nickname ?? "",
                previousNickname: oldMember.nickname ?? "",
            });
        }
        const who = { userId: newMember.user.id, username: newMember.user.username, guildId: newMember.guild.id };
        for (const roleId of added) session.emit("on-role-added", { ...who, roleId });
        for (const roleId of removed) session.emit("on-role-removed", { ...who, roleId });
    });

    on("threadCreate", (thread) => {
        session.emit("on-thread-created", {
            threadId: thread.id,
            name: thread.name ?? "",
            channelId: thread.parentId ?? "",
            ownerId: thread.ownerId ?? "",
            guildId: thread.guildId,
        });
    });

    on("voiceStateUpdate", (oldState, newState) => {
        session.emit("on-voice-state-change", {
            userId: newState.id,
            username: newState.member?.user?.username ?? "",
            channelId: newState.channelId ?? "",
            previousChannelId: oldState?.channelId ?? "",
            guildId: newState.guild.id,
        });
    });
}
