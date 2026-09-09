export type BotStatus = "offline" | "connecting" | "online" | "error";

export interface BotCreatorState {
    configured: boolean;
    botStatus: BotStatus;
    botName: string;
    botTag: string;
    botAvatar: string;
    applicationId: string;
    token: string;
    errorMessage: string | null;
    selectedPermissions: string[];
    inviteUrl: string;
    permissionsBitfield: string;
    guildCount: number;
}

export interface PermissionDefinition {
    id: string;
    name: string;
    description: string;
    category: "general" | "text" | "voice";
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
    {
        id: "Administrator",
        name: "Administrator",
        description: "Grants all permissions and bypasses channel permission overwrites.",
        category: "general",
    },
    {
        id: "ViewChannel",
        name: "View Channels",
        description: "Allows the bot to view channels (excluding private channels).",
        category: "general",
    },
    {
        id: "ManageChannels",
        name: "Manage Channels",
        description: "Allows creation, editing, and deletion of channels.",
        category: "general",
    },
    {
        id: "ManageRoles",
        name: "Manage Roles",
        description: "Allows creation and editing of roles lower than the bot's role.",
        category: "general",
    },
    {
        id: "ManageGuild",
        name: "Manage Server",
        description: "Allows editing server name, region, and verification level.",
        category: "general",
    },
    {
        id: "ViewAuditLog",
        name: "View Audit Log",
        description: "Allows viewing the server audit log.",
        category: "general",
    },
    {
        id: "ChangeNickname",
        name: "Change Nickname",
        description: "Allows the bot to change its own server nickname.",
        category: "general",
    },
    {
        id: "ManageNicknames",
        name: "Manage Nicknames",
        description: "Allows changing other server members' nicknames.",
        category: "general",
    },
    {
        id: "KickMembers",
        name: "Kick Members",
        description: "Allows kicking members from the server.",
        category: "general",
    },
    {
        id: "BanMembers",
        name: "Ban Members",
        description: "Allows banning members from the server.",
        category: "general",
    },

    {
        id: "SendMessages",
        name: "Send Messages",
        description: "Allows sending messages in text channels.",
        category: "text",
    },
    {
        id: "SendMessagesInThreads",
        name: "Send Messages in Threads",
        description: "Allows sending messages in public and private threads.",
        category: "text",
    },
    {
        id: "CreatePublicThreads",
        name: "Create Public Threads",
        description: "Allows creating public threads.",
        category: "text",
    },
    {
        id: "CreatePrivateThreads",
        name: "Create Private Threads",
        description: "Allows creating private threads.",
        category: "text",
    },
    {
        id: "EmbedLinks",
        name: "Embed Links",
        description: "Allows rich link previews and embeds in messages.",
        category: "text",
    },
    {
        id: "AttachFiles",
        name: "Attach Files",
        description: "Allows uploading attachments and images.",
        category: "text",
    },
    {
        id: "ReadMessageHistory",
        name: "Read Message History",
        description: "Allows reading past messages in channels.",
        category: "text",
    },
    {
        id: "MentionEveryone",
        name: "Mention @everyone",
        description: "Allows using @everyone and @here notifications.",
        category: "text",
    },
    {
        id: "UseExternalEmojis",
        name: "Use External Emojis",
        description: "Allows emojis from other servers.",
        category: "text",
    },
    {
        id: "AddReactions",
        name: "Add Reactions",
        description: "Allows adding new reactions to messages.",
        category: "text",
    },
    {
        id: "ManageMessages",
        name: "Manage Messages",
        description: "Allows deleting and pinning messages from others.",
        category: "text",
    },
    {
        id: "UseApplicationCommands",
        name: "Use Slash Commands",
        description: "Allows members to use bot slash commands in the server.",
        category: "text",
    },

    {
        id: "Connect",
        name: "Connect",
        description: "Allows joining voice channels.",
        category: "voice",
    },
    {
        id: "Speak",
        name: "Speak",
        description: "Allows speaking in voice channels.",
        category: "voice",
    },
    {
        id: "Stream",
        name: "Video / Stream",
        description: "Allows sharing screen and video.",
        category: "voice",
    },
    {
        id: "MuteMembers",
        name: "Mute Members",
        description: "Allows muting other members in voice channels.",
        category: "voice",
    },
    {
        id: "DeafenMembers",
        name: "Deafen Members",
        description: "Allows deafening other members in voice channels.",
        category: "voice",
    },
    {
        id: "MoveMembers",
        name: "Move Members",
        description: "Allows moving members between voice channels.",
        category: "voice",
    },
    {
        id: "PrioritySpeaker",
        name: "Priority Speaker",
        description: "Allows being heard more clearly when speaking.",
        category: "voice",
    },
];

export const DEFAULT_SELECTED_PERMISSIONS = [
    "ViewChannel",
    "SendMessages",
    "EmbedLinks",
    "AttachFiles",
    "ReadMessageHistory",
    "AddReactions",
    "UseApplicationCommands",
];

export const DEFAULT_DISCORD_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

export function extractApplicationIdFromToken(token: string): string | null {
    if (!token) return null;
    const clean = token.trim().replace(/^Bot\s+/i, "");
    const parts = clean.split(".");
    if (parts.length < 2) return null;

    try {
        let b64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4 !== 0) {
            b64 += "=";
        }

        const decoded =
            typeof atob === "function"
                ? atob(b64)
                : typeof Buffer !== "undefined"
                  ? Buffer.from(b64, "base64").toString("utf8")
                  : null;

        if (decoded && /^\d{17,21}$/.test(decoded)) {
            return decoded;
        }
    } catch {
        return null;
    }
    return null;
}
