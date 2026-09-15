import {
    Client,
    GatewayIntentBits,
    ChannelType,
    EmbedBuilder,
    PermissionsBitField,
    ActivityType,
    MessageFlags,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    type ApplicationCommandOptionData,
    type ChatInputApplicationCommandData,
    type ChatInputCommandInteraction,
    type ColorResolvable,
} from "discord.js";
import {
    definePanelService,
    defineAction,
    defineTrigger,
    defineType,
    config,
    secretsApi,
    actionsApi,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import { randomUUID } from "node:crypto";
import {
    extractApplicationIdFromToken,
    appendCapped,
    RECENT_MESSAGE_CAP,
    GLOBAL_SCOPE,
    MAX_COMMANDS_PER_SCOPE,
    MAX_COMMAND_OPTIONS,
    SNOWFLAKE_PATTERN,
    INTERACTION_TTL_MS,
    PENDING_INTERACTION_CAP,
    MEMBER_SEARCH_LIMIT,
    describeCommandProblem,
    describeCommandOptionProblem,
    normalizeCommandDefinitions,
    normalizeCommandName,
    commandTriggerId,
    findCommandForInteraction,
    errorToMessage,
    type SlashCommandDefinition,
    type SlashCommandOption,
    type CommandOptionType,
    type CommandMutationResult,
    type DiscordChannelKind,
    type Health,
    type GuildSummary,
    type GuildDetail,
    type MemberSummary,
} from "./types";

// pass PANEL_ID explicitly, ambient scope resolves to last-imported panel
const PANEL_ID = "dev.paperboard.botcreator";

// bot token lives in the daemon secret vault, never in panel config
const TOKEN_NAME = "bot-token";

export const discordChannelType = defineType({
    id: "discord-channel",
    name: "Discord Channel",
    description: "A Discord text channel reference",
    base: "string",
});

export const discordUserType = defineType({
    id: "discord-user",
    name: "Discord User",
    description: "A Discord user reference",
    base: "string",
});

export const discordMessageType = defineType({
    id: "discord-message",
    name: "Discord Message",
    description: "A Discord message reference",
    base: "string",
});

export const discordEmbedType = defineType({
    id: "discord-embed",
    name: "Discord Embed",
    description: "A rich Discord embed payload",
    base: "object",
});

export const discordInteractionType = defineType({
    id: "discord-interaction",
    name: "Discord Interaction",
    description: "A pending slash-command interaction reference",
    base: "string",
});

export const discordRoleType = defineType({
    id: "discord-role",
    name: "Discord Role",
    description: "A Discord role reference",
    base: "string",
});

export const urlType = defineType({
    id: "url",
    name: "URL",
    description: "A URL string",
    base: "string",
});

export const colorType = defineType({
    id: "color",
    name: "Color",
    description: "A hex or named color string",
    base: "string",
});

export const customTypes = [
    discordChannelType,
    discordUserType,
    discordMessageType,
    discordEmbedType,
    discordInteractionType,
    discordRoleType,
    urlType,
    colorType,
];

// declared once: actions and triggers name a category, this array supplies
// its icon and sort order for the Actions library
export const DISCORD_CATEGORIES = [
    { name: "Messages", icon: "chat", order: 1 },
    { name: "Users", icon: "person", order: 2 },
    { name: "Channels", icon: "tag", order: 3 },
    { name: "Reactions", icon: "add_reaction", order: 4 },
    { name: "Interactions", icon: "reply", order: 5 },
    { name: "Commands", icon: "terminal", order: 6 },
    { name: "Members", icon: "group", order: 7 },
    { name: "Bot", icon: "smart_toy", order: 8 },
];

function discordCategory(name: string): { name: string; icon: string; order: number } {
    const found = DISCORD_CATEGORIES.find((category) => category.name === name);
    return found ? { ...found } : { name, icon: "category", order: 999 };
}

export interface DiscordEmbedData {
    title?: string;
    description?: string;
    color?: string;
    url?: string;
    footer?: string;
    image?: string;
}

export function buildDiscordEmbed(data: DiscordEmbedData) {
    const embed = new EmbedBuilder();
    if (data.title) embed.setTitle(data.title);
    if (data.description) embed.setDescription(data.description);
    if (data.color) {
        try {
            embed.setColor(data.color as ColorResolvable);
        } catch (err) {
            console.error("[DiscordService] embed color rejected:", err);
        }
    }
    if (data.url) {
        try {
            embed.setURL(data.url);
        } catch (err) {
            console.error("[DiscordService] embed url rejected:", err);
        }
    }
    if (data.footer) embed.setFooter({ text: data.footer });
    if (data.image) {
        try {
            embed.setImage(data.image);
        } catch (err) {
            console.error("[DiscordService] embed image rejected:", err);
        }
    }
    return embed;
}

function normalizeEmbeds(input: unknown): DiscordEmbedData[] {
    if (!input) return [];
    if (Array.isArray(input)) {
        return input.filter(
            (e) => e && typeof e === "object",
        ) as DiscordEmbedData[];
    }
    if (typeof input === "object") return [input as DiscordEmbedData];
    if (typeof input === "string") {
        const trimmed = input.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            return normalizeEmbeds(parsed);
        } catch (err) {
            console.error("[DiscordService] embeds JSON unparseable, ignoring:", err);
            return [];
        }
    }
    return [];
}

let client: Client | null = null;
let savedAppId = "";

// sequence guard for concurrent connect attempts: only the newest
// startBot attempt may write shared state (client/connectionStatus) —
// a losing attempt's outcome must never overwrite a winner's
let connectSequence = 0;

// connection state is explicit, never inferred: a failed login nulls the
// client and records the typed error here (surfaced via get-bot-info and
// the on-connection-error trigger), so the UI can never show "online"
// for a bot that isn't running. The same rule applies mid-session:
// gateway disconnects invalidate the status (see attachListeners), and a
// successful reconnect marks it live again via ready/shardReady.
export interface ConnectionStatus {
    connected: boolean;
    error?: string;
}

let connectionStatus: ConnectionStatus = { connected: false };

export function getConnectionStatus(): ConnectionStatus {
    return { ...connectionStatus };
}

// proof-of-loop evidence: the last messages the bot session received,
// capped so a busy server can never grow this without bound. A new session
// starts empty (cleared in startBot); disconnecting keeps the last evidence
// beside connected:false. Exposed through get-bot-info. The cap lives in
// types.ts, shared with the UI's live subscription of the same list.
export { RECENT_MESSAGE_CAP };

export interface RecentMessage {
    content: string;
    author: string;
    authorId: string;
    channelId: string;
    guildId: string | null;
    messageId: string;
}

let recentMessages: RecentMessage[] = [];

export function getRecentMessages(): RecentMessage[] {
    return [...recentMessages];
}

export function clearRecentMessages(): void {
    recentMessages = [];
}

export function recordRecentMessage(msg: RecentMessage): void {
    recentMessages = appendCapped(recentMessages, msg, RECENT_MESSAGE_CAP);
}

export interface BotChannelInfo {
    id: string;
    name: string;
}

export interface BotGuildInfo {
    id: string;
    name: string;
    channels: BotChannelInfo[];
}

// guild list straight from the client cache (bounded slices: the cache is
// already finite, this keeps the wire shape finite too)
export function listGuilds(bot: Client | null = client): BotGuildInfo[] {
    if (!bot) return [];
    return [...bot.guilds.cache.values()].slice(0, 100).map((guild) => ({
        id: guild.id,
        name: guild.name,
        channels: [...guild.channels.cache.values()]
            .filter(
                (channel) =>
                    channel.type === ChannelType.GuildText ||
                    channel.type === ChannelType.GuildAnnouncement,
            )
            .slice(0, 100)
            .map((channel) => ({
                id: channel.id,
                name: (channel as { name?: string }).name ?? channel.id,
            })),
    }));
}

export function buildBotInfo(bot: Client | null = client) {
    return {
        name: bot?.user?.username || "Discord Bot",
        avatar: bot?.user?.displayAvatarURL() || "",
        tag: bot?.user?.tag || "",
        guildCount: bot?.guilds?.cache?.size || 0,
        guilds: listGuilds(bot),
        applicationId: bot?.user?.id || savedAppId,
        connected: bot !== null && connectionStatus.connected,
        lastError: connectionStatus.error ?? null,
        recentMessages: getRecentMessages(),
    };
}

// ---------------------------------------------------------------------------
// live health
// ---------------------------------------------------------------------------

// set on a successful login, cleared on stop: uptime must never survive the
// session it describes
let sessionStartedAt: number | null = null;
let commandsReceived = 0;
let commandSyncError: string | null = null;

export function buildHealth(bot: Client | null = client): Health {
    const memory = process.memoryUsage();
    return {
        connected: bot !== null && connectionStatus.connected,
        lastError: connectionStatus.error ?? null,
        uptimeMs: bot && sessionStartedAt ? Math.max(0, Date.now() - sessionStartedAt) : 0,
        wsPing: bot?.ws?.ping ?? -1,
        wsStatus: bot?.ws?.status ?? -1,
        guildCount: bot?.guilds?.cache?.size ?? 0,
        cachedUsers: bot?.users?.cache?.size ?? 0,
        cachedChannels: bot?.channels?.cache?.size ?? 0,
        memoryRss: memory.rss,
        memoryHeapUsed: memory.heapUsed,
        commandsReceived,
        pendingInteractions: pendingInteractions.size,
        commandSyncError,
    };
}

// ---------------------------------------------------------------------------
// pending slash-command interactions
// ---------------------------------------------------------------------------

// A flow can take longer than Discord's 3-second acknowledgement window, so
// the interaction object stays here until it is answered (or its 15-minute
// token expires). Bounded: oldest entries are dropped at the cap and every
// entry's timer is cleared on removal or disconnect.
interface PendingInteraction {
    interaction: ChatInputCommandInteraction;
    timer: ReturnType<typeof setTimeout>;
}

const pendingInteractions = new Map<string, PendingInteraction>();

export function pendingInteractionCount(): number {
    return pendingInteractions.size;
}

export function rememberInteraction(interaction: ChatInputCommandInteraction): void {
    const key = interaction.id;
    const existing = pendingInteractions.get(key);
    if (existing) clearTimeout(existing.timer);

    if (!existing && pendingInteractions.size >= PENDING_INTERACTION_CAP) {
        const oldestKey = pendingInteractions.keys().next().value;
        if (oldestKey !== undefined) {
            const oldest = pendingInteractions.get(oldestKey);
            if (oldest) {
                clearTimeout(oldest.timer);
                pendingInteractions.delete(oldestKey);
            }
        }
    }

    const timer = setTimeout(() => {
        pendingInteractions.delete(key);
    }, INTERACTION_TTL_MS);
    // timers must not keep the host process alive on their own (Node/Bun
    // timers expose unref; the browser double does not)
    (timer as unknown as { unref?: () => void }).unref?.();
    pendingInteractions.set(key, { interaction, timer });
}

export function takeInteraction(interactionId: string): ChatInputCommandInteraction {
    const entry = pendingInteractions.get(interactionId);
    if (!entry) {
        throw new Error(
            `Interaction ${interactionId} is not pending. It was never recorded or its 15-minute window expired.`,
        );
    }
    return entry.interaction;
}

export function clearPendingInteractions(): void {
    for (const entry of pendingInteractions.values()) clearTimeout(entry.timer);
    pendingInteractions.clear();
}

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

function getClient(): Client {
    if (!client) {
        throw new Error("Discord bot is not currently connected.");
    }
    return client;
}

export function buildInviteUrl(appId: string, permissions: string[]): string {
    if (!appId) {
        throw new Error("Cannot build an invite URL: no application ID is known.");
    }
    const bitfield = new PermissionsBitField();
    const unknown: string[] = [];
    for (const p of permissions) {
        if (p in PermissionsBitField.Flags) {
            bitfield.add(
                PermissionsBitField.Flags[
                    p as keyof typeof PermissionsBitField.Flags
                ],
            );
        } else {
            unknown.push(p);
        }
    }
    if (unknown.length > 0) {
        // typo'd permission names must fail loud, never silently vanish
        throw new Error(
            `Unknown Discord permission(s): ${unknown.join(", ")}`,
        );
    }
    // applications.commands is requested because the panel now registers
    // slash commands (see syncSlashCommands); an invite without it produces
    // a bot that registers commands it can never receive interactions for
    return `https://discord.com/api/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${bitfield.bitfield.toString()}`;
}

function generateInvite(permissions: string[]): string {
    return buildInviteUrl(client?.user?.id || savedAppId, permissions);
}

async function stopBot() {
    if (client) {
        try {
            await client.destroy();
        } catch (err) {
            console.error("[DiscordService] bot destroy failed:", err);
        }
        client = null;
    }
    // a stopped session has no answerable interactions, no uptime, no sync
    // state — anything else would let the health page describe a bot that
    // is not running
    clearPendingInteractions();
    sessionStartedAt = null;
    commandSyncError = null;
}

function serializeCommandOptions(
    interaction: ChatInputCommandInteraction,
): { name: string; type: number; value: string | number | boolean | null }[] {
    return interaction.options.data.map((option) => ({
        name: option.name,
        type: option.type,
        value:
            typeof option.value === "string" ||
            typeof option.value === "number" ||
            typeof option.value === "boolean"
                ? option.value
                : null,
    }));
}

function attachListeners(bot: Client, ctx: ServiceContext<any>) {
    // only the live session's events may touch shared state: a superseded
    // session's listeners are still registered on its bot object until
    // destroy completes, and its messages/reactions must not be reported
    // as if they came from the bot the user is running now
    const ownsSession = () => client === bot;

    bot.on("messageCreate", (msg) => {
        if (msg.author.bot) return;
        if (!ownsSession()) return;

        const payload = {
            content: msg.content,
            author: msg.author.username,
            authorId: msg.author.id,
            channelId: msg.channelId,
            guildId: msg.guildId,
            messageId: msg.id,
        };

        recordRecentMessage(payload);
        ctx.emitTrigger("on-message", payload);
    });

    bot.on("guildMemberAdd", (member) => {
        if (!ownsSession()) return;
        ctx.emitTrigger("on-member-join", {
            username: member.user.username,
            userId: member.user.id,
            guildId: member.guild.id,
            guildName: member.guild.name,
        });
    });

    bot.on("guildMemberRemove", (member) => {
        if (!ownsSession()) return;
        ctx.emitTrigger("on-member-leave", {
            username: member.user.username,
            userId: member.user.id,
            guildId: member.guild.id,
        });
    });

    bot.on("messageReactionAdd", (reaction, user) => {
        if (user.bot) return;
        if (!ownsSession()) return;
        ctx.emitTrigger("on-reaction-add", {
            emoji: reaction.emoji.name || reaction.emoji.id,
            userId: user.id,
            username: user.username,
            messageId: reaction.message.id,
            channelId: reaction.message.channelId,
        });
    });

    bot.on("interactionCreate", (interaction) => {
        if (!ownsSession()) return;
        if (!interaction.isChatInputCommand()) return;
        commandsReceived++;

        // Discord resolves a guild command over a same-named global one;
        // the trigger to fire must follow the same rule
        const command = findCommandForInteraction(
            knownCommands,
            interaction.commandName,
            interaction.guildId ?? null,
        );
        if (!command) {
            // an interaction for a command this panel does not manage: there
            // is no trigger to fire and no stored definition to answer with
            console.error(
                `[DiscordService] ignored interaction for unknown command /${interaction.commandName}; no trigger is registered for it`,
            );
            return;
        }

        rememberInteraction(interaction);
        const payload = {
            interactionId: interaction.id,
            commandName: command.name,
            commandId: command.id,
            scope: command.scope,
            userId: interaction.user.id,
            username: interaction.user.username,
            channelId: interaction.channelId,
            guildId: interaction.guildId,
            options: serializeCommandOptions(interaction),
            values: Object.fromEntries(
                interaction.options.data.map((option) => [option.name, option.value ?? null]),
            ),
        };
        try {
            ctx.emitTrigger(commandTriggerId(command), payload);
        } catch (err) {
            console.error(
                `[DiscordService] trigger emit failed for /${command.name}:`,
                err,
            );
        }
    });

    // gateway truth mid-session: a drop must invalidate connectionStatus
    // the same way a failed login does — otherwise the UI shows "online"
    // for a bot that is not running. A successful reconnect flips it back.

    const gatewayErrorMessage = (err: unknown): string => {
        if (err instanceof Error) return err.message;
        if (typeof err === "string") return err;
        if (err && typeof err === "object") {
            const obj = err as { code?: unknown; reason?: unknown; message?: unknown };
            if (obj.message) return String(obj.message);
            if (obj.code !== undefined) {
                return obj.reason ? `close ${obj.code}: ${obj.reason}` : `close code ${obj.code}`;
            }
            return "gateway closed";
        }
        return err === undefined || err === null ? "gateway closed" : String(err);
    };

    const markGatewayDown = (source: string, err?: unknown) => {
        if (!ownsSession()) return;
        const message = gatewayErrorMessage(err);
        console.error(`[DiscordService] gateway ${source}:`, message);
        connectionStatus = { connected: false, error: message };
        try {
            ctx.emitTrigger("on-connection-error", { error: message });
        } catch (emitErr) {
            console.error("[DiscordService] connection-error emit failed:", emitErr);
        }
    };

    // discord.js retries these internally; shardReady/ready below restores
    // the connected flag when the gateway actually comes back
    bot.on("disconnect", (err?) => markGatewayDown("disconnect", err));
    bot.on("shardDisconnect", (event) =>
        markGatewayDown("shardDisconnect", event),
    );

    // fatal: the token was reset/revoked — destroy immediately and record
    bot.on("invalidated", () => {
        if (!ownsSession()) return;
        console.error("[DiscordService] session invalidated (token reset or revoked)");
        connectionStatus = { connected: false, error: "Session invalidated: token was reset or revoked" };
        client = null;
        void bot
            .destroy()
            .catch((destroyErr: unknown) =>
                console.error("[DiscordService] bot destroy after invalidation failed:", destroyErr),
            );
        try {
            ctx.emitTrigger("on-connection-error", {
                error: "Session invalidated: token was reset or revoked",
            });
        } catch (emitErr) {
            console.error("[DiscordService] connection-error emit failed:", emitErr);
        }
    });

    // transient client/shard errors: log and surface as a trigger, but do
    // NOT claim disconnected — the gateway session may still be live
    bot.on("error", (err) => {
        if (!ownsSession()) return;
        console.error("[DiscordService] client error:", err instanceof Error ? err.message : String(err));
        try {
            ctx.emitTrigger("on-connection-error", { error: String(err) });
        } catch (emitErr) {
            console.error("[DiscordService] connection-error emit failed:", emitErr);
        }
    });
    bot.on("shardError", (err) => {
        if (!ownsSession()) return;
        console.error("[DiscordService] shard error:", err instanceof Error ? err.message : String(err));
        try {
            ctx.emitTrigger("on-connection-error", { error: String(err) });
        } catch (emitErr) {
            console.error("[DiscordService] connection-error emit failed:", emitErr);
        }
    });

    // reconnect success: back online
    bot.on("ready", () => {
        if (!ownsSession()) return;
        connectionStatus = { connected: true };
    });
    bot.on("shardReady", () => {
        if (!ownsSession()) return;
        connectionStatus = { connected: true };
    });
}

async function startBot(
    token: string,
    ctx?: ServiceContext<any>,
    clientFactory?: () => Client,
) {
    if (!token) return;
    const attempt = ++connectSequence;
    await stopBot();
    // A newer attempt may have started while we awaited stopBot: from
    // here on every write to shared state (client/connectionStatus) is
    // sequence-checked — a losing attempt must not overwrite the winner.
    if (attempt !== connectSequence) {
        console.warn("[DiscordService] superseded connect attempt discarded before login");
        return;
    }
    clearRecentMessages();
    commandsReceived = 0;

    // privileged intents, without them content arrives empty
    const bot = clientFactory
        ? clientFactory()
        : new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.DirectMessages,
            ],
        });
    client = bot;
    connectionStatus = { connected: false };

    if (ctx) {
        attachListeners(bot, ctx);
    }

    try {
        await bot.login(token);
        // a newer startBot won the race: its stopBot already destroyed our
        // client — destroy is idempotent-safe here, and shared state stays
        // the winner's
        if (attempt !== connectSequence) {
            console.warn("[DiscordService] superseded connect attempt discarded");
            try {
                await bot.destroy();
            } catch (destroyErr) {
                console.error("[DiscordService] bot destroy after supersede failed:", destroyErr);
            }
            return;
        }
        connectionStatus = { connected: true };
        sessionStartedAt = Date.now();
        // command registration must not fail the login: a connected bot
        // whose commands are not on Discord yet is a sync problem, recorded
        // in health rather than reported as a connection failure
        await syncSlashCommandsAfterLogin(bot);
    } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[DiscordService] Login failed:", message);
        try {
            await bot.destroy();
        } catch (destroyErr) {
            console.error("[DiscordService] bot destroy after failed login failed:", destroyErr);
        }
        // only clear our own attempt — a newer login may already own client
        if (client === bot) client = null;
        // only the newest attempt may write shared status
        if (attempt === connectSequence) {
            connectionStatus = { connected: false, error: message };
        }
        try {
            ctx?.emitTrigger("on-connection-error", { error: message });
        } catch (emitErr) {
            console.error("[DiscordService] connection-error emit failed:", emitErr);
        }
        throw new Error(`Discord login failed: ${message}`);
    }
}

// test seam: drives the real startBot with a fake transport so tests can
// assert the state machine after failure without touching the network
export const __botTest = { startBot };

// ---------------------------------------------------------------------------
// slash command storage and registration
// ---------------------------------------------------------------------------

interface StoredPanelConfig {
    configured?: boolean;
    applicationId?: string;
    commands?: unknown;
}

async function readStoredConfig(): Promise<StoredPanelConfig> {
    try {
        const saved = await config.get<StoredPanelConfig>(PANEL_ID);
        return saved && typeof saved === "object" ? saved : {};
    } catch (err) {
        console.error("[DiscordService] panel config read failed:", err);
        throw new Error(`Could not read saved commands: ${errorToMessage(err)}`);
    }
}

// writeStoredCommands preserves every other config field: a command save
// must never drop the application id or the configured flag
async function writeStoredCommands(commands: SlashCommandDefinition[]): Promise<void> {
    const saved = await readStoredConfig();
    try {
        await config.set(
            {
                ...saved,
                configured: true,
                commands,
            },
            PANEL_ID,
        );
    } catch (err) {
        console.error("[DiscordService] panel config write failed:", err);
        throw new Error(`Could not save commands: ${errorToMessage(err)}`);
    }
}

// the live view of stored commands: the interaction handler needs a
// synchronous lookup, and the trigger registry mirrors this list
let knownCommands: SlashCommandDefinition[] = [];

const OPTION_FIELD_TYPES: Record<
    CommandOptionType,
    { type: string; typeName: string }
> = {
    string: { type: "string", typeName: "Text" },
    integer: { type: "number", typeName: "Integer" },
    number: { type: "number", typeName: "Number" },
    boolean: { type: "boolean", typeName: "True / False" },
    user: { type: "discord-user", typeName: "User" },
    channel: { type: "discord-channel", typeName: "Channel" },
    role: { type: "discord-role", typeName: "Role" },
    mentionable: { type: "string", typeName: "User or Role" },
};

export function commandTriggerDefinition(command: SlashCommandDefinition) {
    // the command's own parameters become typed variables, so a flow reads
    // them directly instead of digging through one "Command Data" object
    const optionFields: Record<
        string,
        { type: string; label: string; typeName: string }
    > = {};
    for (const option of command.options) {
        const mapped = OPTION_FIELD_TYPES[option.type];
        optionFields[`values.${option.name}`] = {
            type: mapped.type,
            label: option.name,
            typeName: mapped.typeName,
        };
    }

    return defineTrigger({
        id: commandTriggerId(command),
        name: `When /${command.name} is used`,
        category: discordCategory("Commands"),
        description:
            command.scope === GLOBAL_SCOPE
                ? `Fires when /${command.name} is used in any server`
                : `Fires when /${command.name} is used in the server it is registered to`,
        template: `When /${command.name} is used`,
        output: { type: "object", label: "Command Data" },
        outputFields: {
            interactionId: {
                type: "discord-interaction",
                label: "Interaction",
                typeName: "Interaction",
            },
            commandName: { type: "string", label: "Command", typeName: "Text" },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            channelId: {
                type: "discord-channel",
                label: "Channel",
                typeName: "Channel",
            },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            ...optionFields,
        },
        icon: "terminal",
    });
}

// one trigger per command: registering is part of creating the command, so a
// command whose trigger is missing is reported, never quietly half-created
async function registerCommandTrigger(command: SlashCommandDefinition): Promise<void> {
    try {
        await actionsApi.registerTrigger(commandTriggerDefinition(command), PANEL_ID);
    } catch (err) {
        console.error(
            `[DiscordService] trigger registration failed for /${command.name}:`,
            err,
        );
        throw new Error(
            `Could not register the trigger for /${command.name}: ${errorToMessage(err)}`,
        );
    }
}

async function unregisterCommandTrigger(command: SlashCommandDefinition): Promise<void> {
    try {
        await actionsApi.unregisterTrigger(commandTriggerId(command), PANEL_ID);
    } catch (err) {
        console.error(
            `[DiscordService] trigger removal failed for /${command.name}:`,
            err,
        );
        throw new Error(
            `Could not remove the trigger for /${command.name}: ${errorToMessage(err)}`,
        );
    }
}

function optionPayload(option: SlashCommandOption): ApplicationCommandOptionData {
    const base = {
        name: option.name,
        description: option.description,
        required: option.required,
    };
    switch (option.type) {
        case "string":
            return { ...base, type: ApplicationCommandOptionType.String };
        case "integer":
            return { ...base, type: ApplicationCommandOptionType.Integer };
        case "number":
            return { ...base, type: ApplicationCommandOptionType.Number };
        case "boolean":
            return { ...base, type: ApplicationCommandOptionType.Boolean };
        case "user":
            return { ...base, type: ApplicationCommandOptionType.User };
        case "channel":
            return { ...base, type: ApplicationCommandOptionType.Channel };
        case "role":
            return { ...base, type: ApplicationCommandOptionType.Role };
        case "mentionable":
            return { ...base, type: ApplicationCommandOptionType.Mentionable };
    }
    // unreachable: CommandOptionType is exhausted above
    throw new Error(`Unsupported command option type: ${String(option.type)}`);
}

export function commandPayload(
    def: SlashCommandDefinition,
): ChatInputApplicationCommandData {
    return {
        type: ApplicationCommandType.ChatInput,
        name: def.name,
        description: def.description,
        options: def.options.map(optionPayload),
    };
}

/**
 * Declarative registration: each scope is set to exactly the stored list, so
 * deleted commands disappear. `scopesToClear` carries scopes that no longer
 * have any command (an empty list cannot be inferred from the commands).
 * Returns human-readable errors instead of throwing so partial success is
 * reported truthfully.
 */
export async function syncSlashCommands(
    bot: Client,
    commands: SlashCommandDefinition[],
    scopesToClear: string[] = [],
): Promise<string[]> {
    const application = bot.application;
    if (!application) {
        throw new Error(
            "Discord application is not available on this client; commands were not registered.",
        );
    }

    const errors: string[] = [];
    const byScope = new Map<string, SlashCommandDefinition[]>();
    for (const command of commands) {
        const list = byScope.get(command.scope) ?? [];
        list.push(command);
        byScope.set(command.scope, list);
    }

    try {
        await application.commands.set(
            (byScope.get(GLOBAL_SCOPE) ?? []).map(commandPayload),
        );
    } catch (err) {
        errors.push(`Global commands: ${errorToMessage(err)}`);
    }

    for (const scope of new Set([...byScope.keys(), ...scopesToClear])) {
        if (scope === GLOBAL_SCOPE) continue;
        const definitions = byScope.get(scope) ?? [];
        const guild = bot.guilds.cache.get(scope);
        if (!guild) {
            errors.push(
                `Guild ${scope} is not in this bot's server list; its commands were not registered.`,
            );
            continue;
        }
        try {
            await guild.commands.set(definitions.map(commandPayload));
        } catch (err) {
            errors.push(`Guild ${guild.name}: ${errorToMessage(err)}`);
        }
    }

    return errors;
}

async function syncSlashCommandsAfterLogin(bot: Client): Promise<void> {
    try {
        const saved = await readStoredConfig();
        const commands = normalizeCommandDefinitions(saved.commands);
        // keep the interaction lookup honest even if the socket that
        // registered the triggers came from a previous config
        knownCommands = commands;
        const errors = await syncSlashCommands(bot, commands);
        // a newer session may own shared state by now
        if (client !== bot) return;
        commandSyncError = errors.length > 0 ? errors.join(" ") : null;
        if (commandSyncError) {
            console.error("[DiscordService] command sync reported errors:", commandSyncError);
        }
    } catch (err) {
        if (client !== bot) return;
        commandSyncError = errorToMessage(err);
        console.error("[DiscordService] command sync failed:", err);
    }
}

// save-then-sync for UI mutations: offline is reported as "not registered"
// rather than as an error, because the stored definition is not a lie
async function syncAfterMutation(
    commands: SlashCommandDefinition[],
    scopesToClear: string[] = [],
): Promise<{ registered: boolean; syncError: string | null }> {
    const bot = client;
    if (!bot || !connectionStatus.connected) {
        return { registered: false, syncError: null };
    }
    try {
        const errors = await syncSlashCommands(bot, commands, scopesToClear);
        commandSyncError = errors.length > 0 ? errors.join(" ") : null;
        if (commandSyncError) {
            console.error("[DiscordService] command sync reported errors:", commandSyncError);
        }
        return { registered: commandSyncError === null, syncError: commandSyncError };
    } catch (err) {
        commandSyncError = errorToMessage(err);
        console.error("[DiscordService] command sync failed:", err);
        return { registered: false, syncError: commandSyncError };
    }
}

// ---------------------------------------------------------------------------
// server explorer
// ---------------------------------------------------------------------------

const CHANNEL_KIND_BY_TYPE: Record<number, DiscordChannelKind> = {
    [ChannelType.GuildText]: "text",
    [ChannelType.GuildVoice]: "voice",
    [ChannelType.GuildCategory]: "category",
    [ChannelType.GuildAnnouncement]: "announcement",
    [ChannelType.GuildStageVoice]: "stage",
    [ChannelType.GuildForum]: "forum",
    [ChannelType.GuildMedia]: "media",
};

export function describeChannelKind(type: number): DiscordChannelKind {
    return CHANNEL_KIND_BY_TYPE[type] ?? "other";
}

export function listGuildSummaries(bot: Client | null = client): GuildSummary[] {
    if (!bot) return [];
    return [...bot.guilds.cache.values()].slice(0, 100).map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL() ?? "",
        memberCount: guild.memberCount,
        channelCount: guild.channels.cache.size,
        roleCount: guild.roles.cache.size,
        ownerId: guild.ownerId,
    }));
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

const actions = [
    defineAction({
        id: "get-channel",
        name: "Get Channel",
        category: "Channels",
        description: "Resolves a raw channel ID into a reusable channel reference",
        template: "Get channel {channelId}",
        inputs: {
            channelId: {
                type: "string",
                label: "Channel ID",
                placeholder: "Channel ID",
                required: true,
            },
        },
        output: {
            type: "discord-channel",
            label: "Channel",
        },
        icon: "tag",
        run: async (_ctx, inputs: { channelId: string }) => {
            const bot = getClient();
            const channel = await bot.channels.fetch(inputs.channelId.trim());
            if (!channel) {
                throw new Error(`Channel ${inputs.channelId} not found`);
            }
            return inputs.channelId.trim();
        },
    }),

    defineAction({
        id: "get-user",
        name: "Get User",
        category: "Users",
        description: "Resolves a raw user ID into a reusable user reference",
        template: "Get user {userId}",
        inputs: {
            userId: {
                type: "string",
                label: "User ID",
                placeholder: "User ID",
                required: true,
            },
        },
        output: {
            type: "discord-user",
            label: "User",
        },
        icon: "person",
        run: async (_ctx, inputs: { userId: string }) => {
            const bot = getClient();
            const user = await bot.users.fetch(inputs.userId.trim());
            if (!user) {
                throw new Error(`User ${inputs.userId} not found`);
            }
            return inputs.userId.trim();
        },
    }),

    defineAction({
        id: "get-message",
        name: "Get Message",
        category: "Messages",
        description: "Fetches a message from a channel into a reusable message reference",
        template: "Get message {messageId} from {channel}",
        inputs: {
            channel: {
                type: "discord-channel",
                label: "Channel",
                placeholder: "Channel",
                required: true,
            },
            messageId: {
                type: "string",
                label: "Message ID",
                placeholder: "Message ID",
                required: true,
            },
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "chat",
        run: async (
            _ctx,
            inputs: { channel: string; messageId: string },
        ) => {
            const bot = getClient();
            const channel = await bot.channels.fetch(inputs.channel.trim());
            if (channel && "messages" in channel) {
                const msg = await (channel as any).messages.fetch(
                    inputs.messageId.trim(),
                );
                if (!msg) {
                    throw new Error(`Message ${inputs.messageId} not found`);
                }
                return msg.id;
            }
            throw new Error(`Channel ${inputs.channel} not found or not text-based`);
        },
    }),

    defineAction({
        id: "create-embed",
        name: "Create Embed",
        category: "Messages",
        description: "Builds a rich embed payload for use with Send Message",
        template: "Create embed {title}",
        inputs: {
            title: {
                type: "string",
                label: "Title",
                placeholder: "Title",
                required: true,
            },
            description: {
                type: "string",
                label: "Description",
                placeholder: "Description",
            },
            color: {
                type: "color",
                label: "Color",
                placeholder: "Color",
            },
            url: {
                type: "url",
                label: "URL",
                placeholder: "URL",
            },
            footer: {
                type: "string",
                label: "Footer",
                placeholder: "Footer",
            },
            image: {
                type: "string",
                label: "Image URL",
                placeholder: "Image URL",
            },
        },
        output: {
            type: "discord-embed",
            label: "Embed",
        },
        icon: "article",
        run: async (_ctx, inputs: DiscordEmbedData) => {
            const embed = buildDiscordEmbed(inputs || {});
            return embed.toJSON();
        },
    }),

    defineAction({
        id: "send-message",
        name: "Send Message",
        category: "Messages",
        description: "Sends a text message to a Discord channel",
        template: "Send message {content} to {channel}",
        inputs: {
            channel: {
                type: "discord-channel",
                label: "Channel",
                placeholder: "Channel",
                required: true,
            },
            content: {
                type: "string",
                label: "Content",
                placeholder: "Content",
                required: true,
            },
            reply: {
                type: "discord-message",
                label: "Reply",
                placeholder: "Message",
            },
            embeds: {
                type: "list<discord-embed>",
                label: "Embeds",
                placeholder: "Embed",
            },
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "send",
        run: async (
            _ctx,
            inputs: {
                channel: string;
                content: string;
                reply?: string;
                embeds?: unknown;
            },
        ) => {
            const bot = getClient();
            const channel = await bot.channels.fetch(inputs.channel);
            if (!channel) {
                throw new Error(`Channel ${inputs.channel} not found`);
            }
            const embedPayloads = normalizeEmbeds(inputs.embeds).map((data) =>
                buildDiscordEmbed(data),
            );
            if (inputs.reply && channel && "messages" in channel) {
                const target = await (channel as any).messages.fetch(
                    inputs.reply,
                );
                const reply = await target.reply({
                    content: inputs.content,
                    embeds: embedPayloads,
                });
                return reply.id;
            }
            if (channel && "send" in channel) {
                const sent = await (channel as any).send({
                    content: inputs.content,
                    embeds: embedPayloads,
                });
                return sent.id;
            }
            throw new Error(`Channel ${inputs.channel} not found or not text-based`);
        },
    }),

    defineAction({
        id: "send-dm",
        name: "Send Direct Message",
        category: "Users",
        description: "Sends a private direct message to a Discord user",
        template: "Send DM {content} to {user}",
        inputs: {
            user: {
                type: "discord-user",
                label: "User",
                placeholder: "User",
                required: true,
            },
            content: {
                type: "string",
                label: "Content",
                placeholder: "Content",
                required: true,
            },
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "person",
        run: async (_ctx, inputs: { user: string; content: string }) => {
            const bot = getClient();
            const user = await bot.users.fetch(inputs.user);
            const sent = await user.send(inputs.content);
            return sent.id;
        },
    }),

    defineAction({
        id: "add-reaction",
        name: "Add Reaction",
        category: "Reactions",
        description: "Adds an emoji reaction to a Discord message",
        template: "Add reaction {emoji} to {message}",
        inputs: {
            channel: {
                type: "discord-channel",
                label: "Channel",
                placeholder: "Channel",
                required: true,
            },
            message: {
                type: "discord-message",
                label: "Message",
                placeholder: "Message",
                required: true,
            },
            emoji: {
                type: "string",
                label: "Emoji",
                placeholder: "Emoji",
                required: true,
            },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "add_reaction",
        run: async (
            _ctx,
            inputs: {
                channel: string;
                message: string;
                emoji: string;
            },
        ) => {
            const bot = getClient();
            const channel = await bot.channels.fetch(inputs.channel);
            if (channel && "messages" in channel) {
                const target = await (channel as any).messages.fetch(
                    inputs.message,
                );
                await target.react(inputs.emoji);
                return true;
            }
            throw new Error(`Channel ${inputs.channel} not found`);
        },
    }),

    defineAction({
        id: "set-status",
        name: "Set Bot Activity",
        category: "Bot",
        description: "Updates the bot presence and activity",
        template: "Set bot activity to {activity}",
        inputs: {
            activity: {
                type: "string",
                label: "Activity",
                placeholder: "Activity",
                required: true,
            },
            status: {
                type: "string",
                label: "Status",
                placeholder: "Status",
                default: "online",
                options: PRESENCE_STATUSES.map((status) => ({
                    label: status === "dnd" ? "Do Not Disturb" : status.charAt(0).toUpperCase() + status.slice(1),
                    value: status,
                })),
            },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "tune",
        run: async (_ctx, inputs: { activity: string; status?: string }) => {
            const bot = getClient();
            const status = validatePresenceStatus(inputs.status || "online");
            bot.user?.setPresence({
                activities: [
                    { name: inputs.activity, type: ActivityType.Custom },
                ],
                status,
            });
            return true;
        },
    }),

    defineAction({
        id: "defer-interaction",
        name: "Defer Interaction",
        category: "Interactions",
        description:
            "Acknowledges a slash command so the bot can answer later without hitting Discord's 3-second timeout",
        template: "Defer interaction {interactionId}",
        inputs: {
            interactionId: {
                type: "discord-interaction",
                label: "Interaction",
                placeholder: "Interaction",
                required: true,
            },
            ephemeral: {
                type: "boolean",
                label: "Only visible to the user",
                default: false,
            },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "hourglass_top",
        run: async (
            _ctx,
            inputs: { interactionId: string; ephemeral?: boolean },
        ) => {
            const interaction = takeInteraction(inputs.interactionId.trim());
            await interaction.deferReply({
                flags: inputs.ephemeral ? MessageFlags.Ephemeral : undefined,
            });
            return true;
        },
    }),

    defineAction({
        id: "respond-to-interaction",
        name: "Respond to Interaction",
        category: "Interactions",
        description:
            "Replies to a slash command; edits the reply when the interaction was deferred",
        template: "Respond to interaction {interactionId}",
        inputs: {
            interactionId: {
                type: "discord-interaction",
                label: "Interaction",
                placeholder: "Interaction",
                required: true,
            },
            content: {
                type: "string",
                label: "Content",
                placeholder: "Content",
            },
            embeds: {
                type: "list<discord-embed>",
                label: "Embeds",
                placeholder: "Embed",
            },
            ephemeral: {
                type: "boolean",
                label: "Only visible to the user",
                default: false,
            },
        },
        output: {
            type: "discord-interaction",
            label: "Interaction",
        },
        icon: "reply",
        run: async (
            _ctx,
            inputs: {
                interactionId: string;
                content?: string;
                embeds?: unknown;
                ephemeral?: boolean;
            },
        ) => {
            const interaction = takeInteraction(inputs.interactionId.trim());
            const embedPayloads = normalizeEmbeds(inputs.embeds).map((data) =>
                buildDiscordEmbed(data),
            );
            const payload = {
                content: inputs.content ?? "",
                embeds: embedPayloads,
            };
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(payload);
            } else {
                await interaction.reply({
                    ...payload,
                    flags: inputs.ephemeral ? MessageFlags.Ephemeral : undefined,
                });
            }
            return interaction.id;
        },
    }),

    defineAction({
        id: "follow-up-interaction",
        name: "Follow Up to Interaction",
        category: "Interactions",
        description: "Sends an additional message after a slash command reply",
        template: "Follow up to interaction {interactionId}",
        inputs: {
            interactionId: {
                type: "discord-interaction",
                label: "Interaction",
                placeholder: "Interaction",
                required: true,
            },
            content: {
                type: "string",
                label: "Content",
                placeholder: "Content",
            },
            embeds: {
                type: "list<discord-embed>",
                label: "Embeds",
                placeholder: "Embed",
            },
            ephemeral: {
                type: "boolean",
                label: "Only visible to the user",
                default: false,
            },
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "forward",
        run: async (
            _ctx,
            inputs: {
                interactionId: string;
                content?: string;
                embeds?: unknown;
                ephemeral?: boolean;
            },
        ) => {
            const interaction = takeInteraction(inputs.interactionId.trim());
            const embedPayloads = normalizeEmbeds(inputs.embeds).map((data) =>
                buildDiscordEmbed(data),
            );
            const sent = await interaction.followUp({
                content: inputs.content ?? "",
                embeds: embedPayloads,
                flags: inputs.ephemeral ? MessageFlags.Ephemeral : undefined,
            });
            return sent.id;
        },
    }),
];

const triggers = [
    defineTrigger({
        id: "on-message",
        name: "When a message is received",
        category: "Messages",
        description: "Fires whenever a message is sent in Discord",
        template: "When a message is received in Discord",
        output: {
            type: "object",
            label: "Message Data",
        },
        icon: "chat",
    }),

    defineTrigger({
        id: "on-member-join",
        name: "When member joins server",
        category: "Members",
        description: "Fires when a new member joins a server",
        template: "When a new member joins",
        output: {
            type: "object",
            label: "Member Data",
        },
        icon: "person_add",
    }),

    defineTrigger({
        id: "on-member-leave",
        name: "When member leaves server",
        category: "Members",
        description: "Fires when a member leaves a server",
        template: "When a member leaves",
        output: {
            type: "object",
            label: "Member Data",
        },
        icon: "person_remove",
    }),

    defineTrigger({
        id: "on-reaction-add",
        name: "When a reaction is added",
        category: "Reactions",
        description: "Fires when an emoji reaction is added to a message",
        template: "When an emoji reaction is added",
        output: {
            type: "object",
            label: "Reaction Data",
        },
        icon: "add_reaction",
    }),

    defineTrigger({
        id: "on-connection-error",
        name: "When the bot connection fails",
        category: discordCategory("Bot"),
        description: "Fires with the typed login error when the bot fails to connect",
        template: "When the bot fails to connect",
        output: {
            type: "object",
            label: "Error Data",
        },
        icon: "error",
    }),
];

// UI-only RPCs are registered with a schema whose name ends in "(Internal)":
// the Actions library skips those, so a parameterless control call can never
// be dragged into a flow as a block that does not describe itself
function internalAction(
    id: string,
    name: string,
    description: string,
    run: (inputs: any) => unknown | Promise<unknown>,
) {
    return defineAction({
        id,
        name: `${name} (Internal)`,
        description,
        template: `${name} (internal)`,
        inputs: {},
        output: { type: "any", label: "Result" },
        run: async (_ctx, inputs) => run(inputs),
    });
}

function parseCommandOptions(raw: unknown): SlashCommandOption[] {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_COMMAND_OPTIONS) {
        throw new Error(
            `Discord allows at most ${MAX_COMMAND_OPTIONS} parameters per command.`,
        );
    }
    const candidates = list.map((option: any) => ({
        id:
            typeof option?.id === "string" && option.id
                ? option.id
                : randomUUID(),
        name:
            typeof option?.name === "string"
                ? normalizeCommandName(option.name)
                : "",
        description:
            typeof option?.description === "string"
                ? option.description.trim()
                : "",
        type: typeof option?.type === "string" ? option.type : "",
        required: Boolean(option?.required),
    }));
    for (let index = 0; index < candidates.length; index++) {
        const problem = describeCommandOptionProblem(
            candidates[index],
            candidates,
            index,
        );
        if (problem) {
            throw new Error(`Parameter ${index + 1}: ${problem}`);
        }
    }
    return candidates.map((candidate) => ({
        ...candidate,
        type: candidate.type as CommandOptionType,
    }));
}

export const botService = definePanelService({
    id: "dev.paperboard.botcreator",
    actions,
    triggers,
    types: customTypes,
    categories: [...DISCORD_CATEGORIES],
    async onInit(ctx: ServiceContext<any>) {
        const panelId = "dev.paperboard.botcreator";
        const registerInternal = (
            id: string,
            name: string,
            description: string,
            run: (inputs: any) => unknown | Promise<unknown>,
        ) =>
            actionsApi
                .register(internalAction(id, name, description, run), undefined, panelId)
                .catch((err) =>
                    console.error(
                        `[DiscordService] internal action "${id}" registration failed:`,
                        err,
                    ),
                );

        registerInternal(
            "get-bot-info",
            "Get Bot Info",
            "Panel UI only: identity and recent-message read.",
            () => buildBotInfo(),
        );

        registerInternal(
            "get-invite-url",
            "Get Invite URL",
            "Panel UI only: builds the invite URL for the selected permissions.",
            (perms: string[]) => generateInvite(perms || []),
        );

        registerInternal(
            "connect-bot",
            "Connect Bot",
            "Panel UI only: connects the vault token. Never accepts a token over the wire.",
            async () => {
                // vault-only by design: no token arguments over the
                // actions channel, matching the 1.1.0 changelog
                const stored = await secretsApi.get(TOKEN_NAME, PANEL_ID);
                if (!stored.found || !stored.value) {
                    throw new Error("No bot token stored");
                }
                savedAppId = extractApplicationIdFromToken(stored.value) || "";
                await startBot(stored.value, ctx);
                return true;
            },
        );

        registerInternal(
            "disconnect-bot",
            "Disconnect Bot",
            "Panel UI only: stops the bot session.",
            async () => {
                await stopBot();
                return true;
            },
        );

        registerInternal(
            "get-health",
            "Get Health",
            "Panel UI only: gateway, cache and memory health read.",
            () => buildHealth(),
        );

        registerInternal(
            "list-guilds",
            "List Guilds",
            "Panel UI only: server summaries from the client cache.",
            () => listGuildSummaries(),
        );

        registerInternal(
            "get-guild-detail",
            "Get Guild Detail",
            "Panel UI only: channels and roles for the server explorer.",
            (guildId: string) => {
                const id = typeof guildId === "string" ? guildId.trim() : "";
                if (!id) throw new Error("A guild id is required.");
                const bot = getClient();
                const guild = bot.guilds.cache.get(id);
                if (!guild) {
                    throw new Error(`Guild ${id} is not available to this bot.`);
                }
                return buildGuildDetail(guild);
            },
        );

        registerInternal(
            "search-guild-members",
            "Search Guild Members",
            "Panel UI only: one bounded member-search page.",
            async (input: { guildId?: string; query?: string }) => {
                const id =
                    typeof input?.guildId === "string" ? input.guildId.trim() : "";
                if (!id) throw new Error("A guild id is required.");
                const query =
                    typeof input?.query === "string" ? input.query.trim() : "";
                const bot = getClient();
                const guild = bot.guilds.cache.get(id);
                if (!guild) {
                    throw new Error(`Guild ${id} is not available to this bot.`);
                }
                // one bounded page; member search is a gateway request,
                // never a full member download
                const members = await guild.members.fetch({
                    query: query || undefined,
                    limit: MEMBER_SEARCH_LIMIT,
                });
                return buildMemberSummaries(members.values());
            },
        );

        registerInternal(
            "create-command",
            "Create Slash Command",
            "Panel UI only: stores a command and registers its trigger and Discord definition.",
            async (input: {
                name?: string;
                description?: string;
                scope?: string;
                options?: unknown;
            }): Promise<CommandMutationResult> => {
                const name =
                    typeof input?.name === "string"
                        ? normalizeCommandName(input.name)
                        : "";
                const description =
                    typeof input?.description === "string"
                        ? input.description.trim()
                        : "";
                const scope =
                    typeof input?.scope === "string" && input.scope
                        ? input.scope
                        : GLOBAL_SCOPE;
                const problem = describeCommandProblem({ name, description });
                if (problem) throw new Error(problem);
                if (scope !== GLOBAL_SCOPE && !SNOWFLAKE_PATTERN.test(scope)) {
                    throw new Error(`Unknown command scope "${scope}".`);
                }
                const options = parseCommandOptions(input?.options);

                const saved = await readStoredConfig();
                const commands = normalizeCommandDefinitions(saved.commands);
                if (commands.some((c) => c.scope === scope && c.name === name)) {
                    throw new Error(`A command named /${name} already exists in this scope.`);
                }
                if (commands.filter((c) => c.scope === scope).length >= MAX_COMMANDS_PER_SCOPE) {
                    throw new Error(
                        `Discord allows at most ${MAX_COMMANDS_PER_SCOPE} commands per scope.`,
                    );
                }

                const definition: SlashCommandDefinition = {
                    id: randomUUID(),
                    name,
                    description,
                    scope,
                    options,
                };
                const next = [...commands, definition];
                await writeStoredCommands(next);
                knownCommands = next;

                let triggerError: string | null = null;
                try {
                    await registerCommandTrigger(definition);
                } catch (err) {
                    triggerError = errorToMessage(err);
                }

                const sync = await syncAfterMutation(next);
                return { command: definition, ...sync, triggerError };
            },
        );

        registerInternal(
            "delete-command",
            "Delete Slash Command",
            "Panel UI only: removes a stored command, its trigger, and its Discord definition.",
            async (input: { id?: string }): Promise<CommandMutationResult> => {
                const id = typeof input?.id === "string" ? input.id.trim() : "";
                if (!id) throw new Error("A command id is required.");
                const saved = await readStoredConfig();
                const commands = normalizeCommandDefinitions(saved.commands);
                const target = commands.find((c) => c.id === id);
                if (!target) {
                    throw new Error(`No command with id ${id} is stored.`);
                }
                const next = commands.filter((c) => c.id !== id);
                // a scope with no commands left cannot be inferred from
                // the list, so it is explicitly cleared on Discord
                const scopesToClear = next.some((c) => c.scope === target.scope)
                    ? []
                    : [target.scope];
                await writeStoredCommands(next);
                knownCommands = next;

                let triggerError: string | null = null;
                try {
                    await unregisterCommandTrigger(target);
                } catch (err) {
                    triggerError = errorToMessage(err);
                }

                const sync = await syncAfterMutation(next, scopesToClear);
                return { command: target, ...sync, triggerError };
            },
        );

        // commands created before this session's socket existed still need
        // triggers; a failure here must not block the auto-connect below
        try {
            const saved = await config.get<any>(PANEL_ID);
            knownCommands = normalizeCommandDefinitions(saved?.commands);
            for (const command of knownCommands) {
                await registerCommandTrigger(command);
            }
        } catch (err) {
            console.error("[DiscordService] command trigger registration failed:", err);
        }

        try {
            const saved = await config.get<any>(PANEL_ID);
            // auto-connect from the vault; missing token = needs re-setup,
            // never a silent no-op
            if (saved?.configured) {
                const stored = await secretsApi.get(TOKEN_NAME, PANEL_ID);
                if (stored.found && stored.value) {
                    savedAppId =
                        saved.applicationId ||
                        extractApplicationIdFromToken(stored.value) ||
                        "";
                    await startBot(stored.value, ctx);
                } else {
                    console.error("[DiscordService] marked configured but no vault token; re-setup required");
                }
            }
        } catch (err) {
            console.error("[DiscordService] Init error:", err);
        }
    },
});

export default botService;
