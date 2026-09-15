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

// shared with the service's ring buffer so the UI subscription caps
// recent messages with the exact same bound (one invariant, one number)
export const RECENT_MESSAGE_CAP = 10;

// chronological append that drops the oldest entry past the cap — the
// same semantics as the service-side recent-message buffer
export function appendCapped<T>(list: T[], item: T, cap: number = RECENT_MESSAGE_CAP): T[] {
    const next = [...list, item];
    return next.length > cap ? next.slice(next.length - cap) : next;
}

export function errorToMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// slash commands
// ---------------------------------------------------------------------------

// "global" registers with Discord application-wide; any other value is a
// guild id, which registers instantly in that server (global commands can
// take up to an hour to propagate, so per-guild is the useful default for
// testing a bot).
export const GLOBAL_SCOPE = "global";

// Discord's per-scope hard limits: 100 application commands globally and
// 100 per guild. Bounded at the boundary so stored config can never ask
// Discord for more than it will accept.
export const MAX_COMMANDS_PER_SCOPE = 100;

// Discord chat-input command names: 1-32 chars of a-z, 0-9, - and _
export const COMMAND_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
export const COMMAND_DESCRIPTION_MAX_LENGTH = 100;
export const SNOWFLAKE_PATTERN = /^\d{17,21}$/;

// interaction tokens live 15 minutes; a pending interaction is dropped after
// that so the map can never grow past the conversations still answerable
export const INTERACTION_TTL_MS = 15 * 60 * 1000;
export const PENDING_INTERACTION_CAP = 100;

// guild member fetch page size — the explorer never pulls more than one page
export const MEMBER_SEARCH_LIMIT = 25;

// Discord application-command option types this panel supports, in the
// order they should appear in a type picker
export const COMMAND_OPTION_TYPES = [
    "string",
    "integer",
    "number",
    "boolean",
    "user",
    "channel",
    "role",
    "mentionable",
] as const;
export type CommandOptionType = (typeof COMMAND_OPTION_TYPES)[number];

export const COMMAND_OPTION_TYPE_ICONS: Record<CommandOptionType, string> = {
    string: "text_fields",
    integer: "numbers",
    number: "numbers",
    boolean: "toggle_on",
    user: "person",
    channel: "tag",
    role: "badge",
    mentionable: "group",
};

export const COMMAND_OPTION_TYPE_LABELS: Record<CommandOptionType, string> = {
    string: "Text",
    integer: "Integer",
    number: "Number",
    boolean: "True / False",
    user: "User",
    channel: "Channel",
    role: "Role",
    mentionable: "User or Role",
};

// Discord's hard cap per command; enforced at the boundary so stored config
// can never ask for more than the API accepts
export const MAX_COMMAND_OPTIONS = 25;

export interface SlashCommandOption {
    id: string;
    name: string;
    description: string;
    type: CommandOptionType;
    required: boolean;
}

export interface SlashCommandDefinition {
    id: string;
    name: string;
    description: string;
    /** GLOBAL_SCOPE or a Discord guild id */
    scope: string;
    options: SlashCommandOption[];
}

export interface CommandMutationResult {
    command: SlashCommandDefinition;
    /** true when the command is live on Discord right now */
    registered: boolean;
    /** why it is not live, if it is not */
    syncError: string | null;
    /** why its trigger is not registered, if it is not */
    triggerError: string | null;
}

export function isCommandOptionType(value: unknown): value is CommandOptionType {
    return (
        typeof value === "string" &&
        (COMMAND_OPTION_TYPES as readonly string[]).includes(value)
    );
}

// the UI's placeholder invites "/command-name"; the leading slash is
// optional input decoration and is stripped wherever the name is used
export function normalizeCommandName(name: string): string {
    return name.trim().replace(/^\/+/, "").toLowerCase();
}

// per-field rules live here so the service and the UI's input validation
// cannot drift: the UI marks a field invalid with the same predicate the
// service uses to reject it
export function isCommandNameValid(name: string): boolean {
    return COMMAND_NAME_PATTERN.test(normalizeCommandName(name));
}

export function isCommandDescriptionValid(description: string): boolean {
    const trimmed = description.trim();
    return (
        trimmed.length > 0 && trimmed.length <= COMMAND_DESCRIPTION_MAX_LENGTH
    );
}

export function hasDuplicateOptionName(
    all: { name: string }[],
    name: string,
): boolean {
    const trimmed = name.trim();
    return all.filter((option) => option.name.trim() === trimmed).length > 1;
}

// Discord rejects a required option once an optional one has appeared before it
export function isOptionOrderValid(
    all: { required: boolean }[],
    index: number,
): boolean {
    return !(
        all[index]?.required && all.slice(0, index).some((option) => !option.required)
    );
}

/** null when valid, otherwise the sentence to show the user. */
export function describeCommandOptionProblem(
    option: { name: string; description: string; type: string; required: boolean },
    all: { name: string; required: boolean }[],
    index: number,
): string | null {
    if (!isCommandOptionType(option.type)) {
        return "Pick a parameter type.";
    }
    if (!option.name.trim()) return "A parameter name is required.";
    if (!isCommandNameValid(option.name)) {
        return "Parameter names are 1–32 characters: letters, numbers, hyphens and underscores.";
    }
    if (hasDuplicateOptionName(all, option.name)) {
        return "Parameter names must be unique.";
    }
    if (!option.description.trim()) return "A parameter description is required.";
    if (!isCommandDescriptionValid(option.description)) {
        return `Descriptions are ${COMMAND_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
    }
    if (!isOptionOrderValid(all, index)) {
        return "Required parameters must come before optional ones.";
    }
    return null;
}

/**
 * One trigger per command, keyed by scope and name rather than the command's
 * uuid: deleting and recreating a command in the same scope keeps existing
 * flows bound to it.
 */
export function commandTriggerId(command: {
    scope: string;
    name: string;
}): string {
    return `command:${command.scope}:${command.name}`;
}

/**
 * Discord resolves a guild command over a same-named global one, so the
 * interaction handler must do the same when picking which trigger to fire.
 */
export function findCommandForInteraction(
    commands: SlashCommandDefinition[],
    commandName: string,
    guildId: string | null,
): SlashCommandDefinition | undefined {
    if (guildId) {
        const scoped = commands.find(
            (command) => command.scope === guildId && command.name === commandName,
        );
        if (scoped) return scoped;
    }
    return commands.find(
        (command) => command.scope === GLOBAL_SCOPE && command.name === commandName,
    );
}

/** null when valid, otherwise the sentence to show the user. */
export function describeCommandProblem(input: {
    name: string;
    description: string;
}): string | null {
    if (!normalizeCommandName(input.name)) return "A command name is required.";
    if (!isCommandNameValid(input.name)) {
        return "Names are 1–32 characters: letters, numbers, hyphens and underscores.";
    }
    if (!input.description.trim()) return "A description is required.";
    if (!isCommandDescriptionValid(input.description)) {
        return `Descriptions are ${COMMAND_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
    }
    return null;
}

function isDefinition(value: unknown): value is SlashCommandDefinition {
    if (!value || typeof value !== "object") return false;
    const def = value as Partial<SlashCommandDefinition>;
    return (
        typeof def.id === "string" &&
        def.id.length > 0 &&
        typeof def.name === "string" &&
        typeof def.description === "string" &&
        (def.scope === undefined || typeof def.scope === "string") &&
        (def.options === undefined || Array.isArray(def.options))
    );
}

function normalizeOptions(raw: unknown): SlashCommandOption[] {
    if (!Array.isArray(raw)) {
        if (raw !== undefined && raw !== null) {
            console.error(
                "[botcreator] stored command options are not a list; ignoring them:",
                raw,
            );
        }
        return [];
    }

    // structurally valid candidates first, so uniqueness and ordering can
    // be judged against the real list instead of a filtered one
    const candidates: SlashCommandOption[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            console.error("[botcreator] ignoring malformed stored option:", entry);
            continue;
        }
        const option = entry as Partial<SlashCommandOption>;
        if (typeof option.id !== "string" || !option.id) {
            console.error("[botcreator] ignoring stored option without an id:", entry);
            continue;
        }
        if (!isCommandOptionType(option.type)) {
            console.error(
                `[botcreator] ignoring stored option /${String(option.name)}: unknown type "${String(option.type)}"`,
            );
            continue;
        }
        candidates.push({
            id: option.id,
            name: normalizeCommandName(
                typeof option.name === "string" ? option.name : "",
            ),
            description:
                typeof option.description === "string" ? option.description : "",
            type: option.type,
            required: Boolean(option.required),
        });
    }

    if (candidates.length > MAX_COMMAND_OPTIONS) {
        console.error(
            `[botcreator] ignoring stored command options past Discord's ${MAX_COMMAND_OPTIONS}-option limit`,
        );
    }

    const options: SlashCommandOption[] = [];
    for (const candidate of candidates) {
        if (options.length >= MAX_COMMAND_OPTIONS) break;
        const problem = describeCommandOptionProblem(
            candidate,
            candidates,
            candidates.indexOf(candidate),
        );
        if (problem) {
            console.error(
                `[botcreator] ignoring stored option /${candidate.name || "?"}: ${problem}`,
            );
            continue;
        }
        options.push({
            ...candidate,
            name: candidate.name.trim(),
            description: candidate.description.trim(),
        });
    }
    return options;
}

/**
 * Reads stored command definitions into a valid, deduplicated, bounded list.
 * Invalid entries are dropped with a loud log — never silently — because a
 * command the user created but the service ignores is a lie.
 */
export function normalizeCommandDefinitions(raw: unknown): SlashCommandDefinition[] {
    if (!Array.isArray(raw)) {
        if (raw !== undefined && raw !== null) {
            console.error(
                "[botcreator] stored commands are not a list; ignoring the stored value:",
                raw,
            );
        }
        return [];
    }

    const seen = new Set<string>();
    const perScope = new Map<string, number>();
    const commands: SlashCommandDefinition[] = [];

    for (const entry of raw) {
        if (!isDefinition(entry)) {
            console.error("[botcreator] ignoring malformed stored command:", entry);
            continue;
        }
        const scope = entry.scope || GLOBAL_SCOPE;
        if (scope !== GLOBAL_SCOPE && !SNOWFLAKE_PATTERN.test(scope)) {
            console.error(
                `[botcreator] ignoring stored command /${entry.name}: unknown scope "${scope}"`,
            );
            continue;
        }
        const problem = describeCommandProblem(entry);
        if (problem) {
            console.error(
                `[botcreator] ignoring stored command /${entry.name}: ${problem}`,
            );
            continue;
        }
        const name = normalizeCommandName(entry.name);
        const key = `${scope}:${name}`;
        if (seen.has(key)) {
            console.error(
                `[botcreator] ignoring duplicate stored command /${name} in scope ${scope}`,
            );
            continue;
        }
        const count = perScope.get(scope) ?? 0;
        if (count >= MAX_COMMANDS_PER_SCOPE) {
            console.error(
                `[botcreator] ignoring stored command /${entry.name}: scope ${scope} is at Discord's ${MAX_COMMANDS_PER_SCOPE}-command limit`,
            );
            continue;
        }
        seen.add(key);
        perScope.set(scope, count + 1);
        commands.push({
            ...entry,
            name,
            scope,
            options: normalizeOptions(entry.options),
        });
    }

    return commands;
}

// ---------------------------------------------------------------------------
// server explorer
// ---------------------------------------------------------------------------

// the service maps Discord's numeric ChannelType to these names so the UI
// never has to import discord.js
export type DiscordChannelKind =
    | "text"
    | "voice"
    | "category"
    | "announcement"
    | "stage"
    | "forum"
    | "media"
    | "other";

export const CHANNEL_KIND_LABELS: Record<DiscordChannelKind, string> = {
    text: "Text",
    voice: "Voice",
    category: "Category",
    announcement: "Announcement",
    stage: "Stage",
    forum: "Forum",
    media: "Media",
    other: "Other",
};

// compact, honest durations: "4d 3h", "12m 30s", "0s"
export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0s";
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${Math.round(bytes)} B`;
}

// wire shapes shared by the service and the UI: the service fills them from
// discord.js, the UI renders them, and neither side redefines the other's
// fields (drift between the two is how a dashboard starts lying)

export interface Health {
    connected: boolean;
    lastError: string | null;
    uptimeMs: number;
    wsPing: number;
    wsStatus: number;
    guildCount: number;
    cachedUsers: number;
    cachedChannels: number;
    memoryRss: number;
    memoryHeapUsed: number;
    commandsReceived: number;
    pendingInteractions: number;
    /** null when every stored command matched Discord; the error otherwise */
    commandSyncError: string | null;
}

export interface GuildSummary {
    id: string;
    name: string;
    icon: string;
    memberCount: number;
    channelCount: number;
    roleCount: number;
    ownerId: string;
}

export interface GuildChannel {
    id: string;
    name: string;
    kind: DiscordChannelKind;
    parentId: string | null;
    position: number;
}

export interface GuildRole {
    id: string;
    name: string;
    color: number;
    position: number;
    managed: boolean;
}

export interface GuildDetail {
    id: string;
    name: string;
    icon: string;
    memberCount: number;
    ownerId: string;
    createdAt: string;
    channels: GuildChannel[];
    roles: GuildRole[];
}

export interface MemberSummary {
    id: string;
    username: string;
    displayName: string;
    avatar: string;
    joinedAt: string | null;
    bot: boolean;
}

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
    } catch (err) {
        console.debug("[botcreator] token application-id decode failed:", err);
        return null;
    }
    return null;
}
