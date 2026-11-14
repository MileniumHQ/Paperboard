// What the server explorer shows of a server and its members, built from
// discord.js's cache in bounded slices.
import { MEMBER_SEARCH_LIMIT, type DiscordChannelKind, type GuildDetail, type MemberSummary } from "./types";

// Discord's channel types by number, as its API defines them (discord.js's
// ChannelType has the same values). Fixed here, so a trigger is described
// whether or not a bot has loaded discord.js yet.
const CHANNEL_KIND_BY_TYPE: Record<number, DiscordChannelKind> = {
    0: "text",
    2: "voice",
    4: "category",
    5: "announcement",
    13: "stage",
    15: "forum",
    16: "media",
};

export function describeChannelKind(type: number): DiscordChannelKind {
    return CHANNEL_KIND_BY_TYPE[type] ?? "other";
}

// bounded slices: Discord caps channels and roles per guild, and these caps
// keep the wire shape finite even if a future API does not
const GUILD_CHANNEL_CAP = 500;
const GUILD_ROLE_CAP = 250;

export function buildGuildDetail(guild: {
    id: string;
    name: string;
    iconURL: () => string | null;
    memberCount: number;
    ownerId: string;
    createdAt: Date | null;
    channels: { cache: Map<string, any> };
    roles: { cache: Map<string, any> };
}): GuildDetail {
    const channels = [...guild.channels.cache.values()]
        .slice(0, GUILD_CHANNEL_CAP)
        .map((channel) => ({
            id: String(channel.id),
            name: String(channel.name ?? channel.id),
            kind: describeChannelKind(Number(channel.type)),
            parentId:
                typeof channel.parentId === "string" ? channel.parentId : null,
            position: typeof channel.position === "number" ? channel.position : 0,
        }))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

    const roles = [...guild.roles.cache.values()]
        .slice(0, GUILD_ROLE_CAP)
        .map((role) => ({
            id: String(role.id),
            name: String(role.name),
            color: typeof role.color === "number" ? role.color : 0,
            position: typeof role.position === "number" ? role.position : 0,
            managed: Boolean(role.managed),
        }))
        .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));

    return {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL() ?? "",
        memberCount: guild.memberCount,
        ownerId: guild.ownerId,
        createdAt: guild.createdAt ? guild.createdAt.toISOString() : "",
        channels,
        roles,
    };
}

export function buildMemberSummaries(members: Iterable<any>): MemberSummary[] {
    return [...members].slice(0, MEMBER_SEARCH_LIMIT).map((member) => ({
        id: String(member.id),
        username: String(member.user?.username ?? ""),
        displayName: String(member.displayName ?? member.user?.username ?? ""),
        avatar: member.displayAvatarURL ? member.displayAvatarURL() : "",
        joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
        bot: Boolean(member.user?.bot),
    }));
}
