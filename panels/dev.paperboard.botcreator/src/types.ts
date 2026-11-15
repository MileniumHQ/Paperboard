import { errorMessage } from "@mileniumhq/paperapi";

// shared with the service's ring buffer so the UI subscription caps
// recent messages with the exact same bound (one invariant, one number)
export const RECENT_MESSAGE_CAP = 10;

/** "1 server", "1,200 servers" */
export function count(n: number, noun: string): string {
    return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
}

// chronological append that drops the oldest entry past the cap — the
// same semantics as the service-side recent-message buffer
export function appendCapped<T>(list: T[], item: T, cap: number = RECENT_MESSAGE_CAP): T[] {
    const next = [...list, item];
    return next.length > cap ? next.slice(next.length - cap) : next;
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
const COMMAND_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
export const COMMAND_DESCRIPTION_MAX_LENGTH = 100;
export const SNOWFLAKE_PATTERN = /^\d{17,21}$/;

// interaction tokens live 15 minutes; a pending interaction is kept that long
// (an answered one can still be followed up or edited) and then dropped. The
// cap bounds a burst: past it the oldest is evicted
export const INTERACTION_TTL_MS = 15 * 60 * 1000;
export const PENDING_INTERACTION_CAP = 500;

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
    /**
     * Also available to users who installed the app on their account, not
     * just servers the bot is in. Discord only honors installation
     * contexts on globally-scoped commands, so this is global-only.
     */
    userInstall: boolean;
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

function isCommandOptionType(value: unknown): value is CommandOptionType {
    return (
        typeof value === "string" &&
        (COMMAND_OPTION_TYPES as readonly string[]).includes(value)
    );
}

// a name as it is typed in Discord: a leading slash is stripped and the
// case folded, since Discord names are lowercase, so "/Ping" is "ping"
// wherever the name is used (the form, Blocks, the saved list)
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
        return "Parameter names are 1–32 lowercase characters: letters, numbers, hyphens and underscores.";
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
        return "Names are 1–32 lowercase characters: letters, numbers, hyphens and underscores.";
    }
    if (!input.description.trim()) return "A description is required.";
    if (!isCommandDescriptionValid(input.description)) {
        return `Descriptions are ${COMMAND_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
    }
    return null;
}

function readStoredOptions(raw: unknown): SlashCommandOption[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new Error("its options are not a list");
    if (raw.length > MAX_COMMAND_OPTIONS) throw new Error(`it has more than Discord's ${MAX_COMMAND_OPTIONS} options`);
    const candidates = raw.map((entry: unknown, index): SlashCommandOption => {
        const option = (entry && typeof entry === "object" ? entry : {}) as Partial<SlashCommandOption>;
        if (typeof option.id !== "string" || !option.id) throw new Error(`option ${index + 1} has no id`);
        if (!isCommandOptionType(option.type)) throw new Error(`option ${index + 1} has the unknown type "${String(option.type)}"`);
        return {
            id: option.id,
            name: normalizeCommandName(typeof option.name === "string" ? option.name : ""),
            description: typeof option.description === "string" ? option.description.trim() : "",
            type: option.type,
            required: Boolean(option.required),
        };
    });
    candidates.forEach((candidate, index) => {
        const problem = describeCommandOptionProblem(candidate, candidates, index);
        if (problem) throw new Error(`option ${index + 1} (${candidate.name || "unnamed"}): ${problem}`);
    });
    return candidates;
}

/**
 * Reads a bot's saved commands, the same rules the editor and the service
 * hold every new one to. A damaged command refuses the whole list, saying
 * which and why: dropping it would lose it for good at the next save.
 */
export function readStoredCommands(raw: unknown): SlashCommandDefinition[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new Error("its commands are not a list");
    const seen = new Set<string>();
    const perScope = new Map<string, number>();
    return raw.map((entry: unknown, index) => {
        const def = (entry && typeof entry === "object" ? entry : {}) as Partial<SlashCommandDefinition>;
        const label = `saved command ${index + 1}${typeof def.name === "string" && def.name ? ` (/${def.name})` : ""}`;
        const damaged = (why: string) => new Error(`${label} is damaged: ${why}`);
        if (typeof def.id !== "string" || !def.id) throw damaged("it has no id");
        if (typeof def.name !== "string" || typeof def.description !== "string") throw damaged("it has no name or description");
        const scope = def.scope || GLOBAL_SCOPE;
        if (scope !== GLOBAL_SCOPE && !SNOWFLAKE_PATTERN.test(scope)) throw damaged(`"${scope}" is not a server`);
        const problem = describeCommandProblem({ name: def.name, description: def.description });
        if (problem) throw damaged(problem);
        const name = normalizeCommandName(def.name);
        if (seen.has(`${scope}:${name}`)) throw damaged(`/${name} is saved twice for the same ${scope === GLOBAL_SCOPE ? "scope" : "server"}`);
        seen.add(`${scope}:${name}`);
        const count = (perScope.get(scope) ?? 0) + 1;
        if (count > MAX_COMMANDS_PER_SCOPE) throw damaged(`it is past Discord's ${MAX_COMMANDS_PER_SCOPE}-command limit`);
        perScope.set(scope, count);
        // Discord honors installation contexts only on global commands
        if (def.userInstall && scope !== GLOBAL_SCOPE) throw damaged("only global commands can be installed by users");
        let options: SlashCommandOption[];
        try {
            options = readStoredOptions(def.options);
        } catch (err) {
            throw damaged(errorMessage(err));
        }
        return { ...def, id: def.id, name, description: def.description, scope, options, userInstall: Boolean(def.userInstall) };
    });
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
    commandsReceived: number;
    pendingInteractions: number;
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

interface GuildRole {
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
