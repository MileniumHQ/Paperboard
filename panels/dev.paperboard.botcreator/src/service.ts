import {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionsBitField,
    ActivityType,
    MessageFlags,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ApplicationIntegrationType,
    type ApplicationCommandOptionData,
    type ChatInputApplicationCommandData,
    type ChatInputCommandInteraction,
    type ColorResolvable,
    type ButtonInteraction,
    type RepliableInteraction,
} from "discord.js";
import {
    INPUTS,
    MessageOps,
    InteractionOps,
    buildDiscordEmbed,
    buildButtonComponent,
    componentClickPayload,
    resolveGuild,
    resolveMember,
    type DiscordEmbedData,
    type DiscordComponentData,
} from "./discordOps";
import {
    definePanelService,
    defineAction,
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

export const discordComponentType = defineType({
    id: "discord-component",
    name: "Component",
    description: "A Discord message component (a button) payload",
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
    discordComponentType,
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
    { name: "Roles", icon: "workspace_premium", order: 8 },
    { name: "Bot", icon: "smart_toy", order: 9 },
];

function discordCategory(name: string): { name: string; icon: string; order: number } {
    const found = DISCORD_CATEGORIES.find((category) => category.name === name);
    return found ? { ...found } : { name, icon: "category", order: 999 };
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
    interaction: RepliableInteraction;
    timer: ReturnType<typeof setTimeout>;
}

const pendingInteractions = new Map<string, PendingInteraction>();

export function pendingInteractionCount(): number {
    return pendingInteractions.size;
}

export function rememberInteraction(interaction: RepliableInteraction): void {
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

export function takeInteraction(interactionId: string): RepliableInteraction {
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

// A button click must be acknowledged within ~3 seconds or the user sees
// "interaction failed". The flow that handles the click may still be queued
// or running, so this panel acks on the bot's behalf: after the delay the
// interaction is deferred (an update ack, no visible spinner) unless it was
// already answered. Respond/Follow Up keep working afterwards via
// editReply/followUp. One fire-once timer per live click, never a
// persistent structure — the click rate bounds these naturally.
const COMPONENT_ACK_DELAY_MS = 2_500;

export function scheduleComponentAck(interaction: ButtonInteraction): void {
    const timer = setTimeout(() => {
        if (interaction.deferred || interaction.replied) return;
        interaction
            .deferUpdate()
            .catch((err: unknown) =>
                console.error(
                    "[DiscordService] component auto-ack failed:",
                    errorToMessage(err),
                ),
            );
    }, COMPONENT_ACK_DELAY_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
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

// User installs carry no bot permissions: the link authorizes
// applications.commands for the user's own account. It only works once
// User Install is enabled for the app in the Discord developer portal.
export function buildUserInstallUrl(appId: string): string {
    if (!appId) {
        throw new Error("Cannot build a user-install URL: no application ID is known.");
    }
    return `https://discord.com/api/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands`;
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

    bot.on("messageReactionRemove", (reaction, user) => {
        if (user.bot) return;
        if (!ownsSession()) return;
        ctx.emitTrigger("on-reaction-removed", {
            emoji: reaction.emoji.name || reaction.emoji.id,
            userId: user.id,
            username: user.username,
            messageId: reaction.message.id,
            channelId: reaction.message.channelId,
        });
    });

    bot.on("messageUpdate", (oldMsg, newMsg) => {
        if (!ownsSession()) return;
        const apply = async () => {
            const msg = newMsg.partial ? await newMsg.fetch().catch((err: unknown) => {
                console.error(
                    "[DiscordService] edited message fetch failed:",
                    errorToMessage(err),
                );
                return null;
            }) : newMsg;
            if (!msg || msg.author?.bot) return;
            ctx.emitTrigger("on-message-edited", {
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

    bot.on("messageDelete", (msg) => {
        if (!ownsSession()) return;
        ctx.emitTrigger("on-message-deleted", {
            messageId: msg.id,
            channelId: msg.channelId,
            guildId: msg.guildId ?? "",
        });
    });

    bot.on("guildBanAdd", (ban) => {
        if (!ownsSession()) return;
        ctx.emitTrigger("on-member-banned", {
            userId: ban.user.id,
            username: ban.user.username,
            reason: ban.reason ?? "",
            guildId: ban.guild.id,
        });
    });

    bot.on("guildMemberUpdate", (oldMember, newMember) => {
        if (!ownsSession()) return;
        const before = new Set((oldMember?.roles?.cache?.keys?.() ?? []) as Iterable<string>);
        for (const roleId of newMember.roles.cache.keys()) {
            if (!before.has(roleId)) {
                ctx.emitTrigger("on-role-added", {
                    userId: newMember.user.id,
                    username: newMember.user.username,
                    roleId,
                    guildId: newMember.guild.id,
                });
            }
        }
        for (const roleId of before) {
            if (!newMember.roles.cache.has(roleId)) {
                ctx.emitTrigger("on-role-removed", {
                    userId: newMember.user.id,
                    username: newMember.user.username,
                    roleId,
                    guildId: newMember.guild.id,
                });
            }
        }
    });

    bot.on("threadCreate", (thread) => {
        if (!ownsSession()) return;
        ctx.emitTrigger("on-thread-created", {
            threadId: thread.id,
            name: thread.name ?? "",
            channelId: thread.parentId ?? "",
            ownerId: thread.ownerId ?? "",
            guildId: thread.guildId,
        });
    });

    bot.on("voiceStateUpdate", (oldState, newState) => {
        if (!ownsSession()) return;
        ctx.emitTrigger("on-voice-state-change", {
            userId: newState.id,
            username: newState.member?.user?.username ?? "",
            channelId: newState.channelId ?? "",
            previousChannelId: oldState?.channelId ?? "",
            guildId: newState.guild.id,
        });
    });

    bot.on("interactionCreate", (interaction) => {
        if (!ownsSession()) return;
        // buttons first: clicks route through the parameterized
        // interaction-triggered event by custom id
        if (interaction.isMessageComponent() && interaction.isButton()) {
            rememberInteraction(interaction);
            scheduleComponentAck(interaction);
            ctx.emitTrigger("interaction-triggered", componentClickPayload(interaction));
            return;
        }
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

    return defineAction({
        id: commandTriggerId(command),
        name: `When /${command.name} is used`,
        category: discordCategory("Commands"),
        description:
            command.scope === GLOBAL_SCOPE
                ? command.userInstall
                    ? `Fires when /${command.name} is used anywhere it is installed — servers, DMs, and group chats`
                    : `Fires when /${command.name} is used in any server`
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

// one event action per command: registering is part of creating the command, so a
// command whose event action is missing is reported, never quietly half-created
async function registerCommandTrigger(command: SlashCommandDefinition): Promise<void> {
    try {
        await actionsApi.register(commandTriggerDefinition(command), undefined, PANEL_ID);
    } catch (err) {
        console.error(
            `[DiscordService] event action registration failed for /${command.name}:`,
            err,
        );
        throw new Error(
            `Could not register the trigger for /${command.name}: ${errorToMessage(err)}`,
        );
    }
}

async function unregisterCommandTrigger(command: SlashCommandDefinition): Promise<void> {
    try {
        await actionsApi.unregister(commandTriggerId(command), PANEL_ID);
    } catch (err) {
        console.error(
            `[DiscordService] event action removal failed for /${command.name}:`,
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
    // Always explicit: omitting integration types inherits the app's
    // configured contexts, which would silently promote a guild-only
    // command to user installs once the portal enables them. contexts is
    // left unset so a user-install command works on every surface.
    return {
        type: ApplicationCommandType.ChatInput,
        name: def.name,
        description: def.description,
        options: def.options.map(optionPayload),
        integrationTypes: def.userInstall
            ? [
                ApplicationIntegrationType.GuildInstall,
                ApplicationIntegrationType.UserInstall,
            ]
            : [ApplicationIntegrationType.GuildInstall],
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

export const actions = [
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
            channel: INPUTS.channel,
            content: { ...INPUTS.content, required: true },
            reply: { ...INPUTS.message, label: "Reply", required: false },
            embeds: INPUTS.embeds,
            components: INPUTS.components,
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
                components?: unknown;
            },
        ) => {
            const ops = new MessageOps(getClient());
            if (inputs.reply) {
                return ops.reply(inputs.channel, inputs.reply, inputs);
            }
            return ops.send(inputs.channel, inputs);
        },
    }),

    defineAction({
        id: "send-dm",
        name: "Send Direct Message",
        category: "Users",
        description: "Sends a private direct message to a Discord user",
        template: "Send DM {content} to {user}",
        inputs: {
            user: INPUTS.user,
            content: { ...INPUTS.content, required: true },
            embeds: INPUTS.embeds,
            components: INPUTS.components,
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "person",
        run: async (_ctx, inputs: { user: string; content: string }) => {
            const ops = new MessageOps(getClient());
            return ops.dm(inputs.user, inputs);
        },
    }),

    defineAction({
        id: "add-reaction",
        name: "Add Reaction",
        category: "Reactions",
        description: "Adds an emoji reaction to a Discord message",
        template: "Add reaction {emoji} to {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
            emoji: INPUTS.emoji,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "add_reaction",
        run: async (_ctx, inputs: { channel: string; message: string; emoji: string }) => {
            const ops = new MessageOps(getClient());
            await ops.react(inputs.channel, inputs.message, inputs.emoji);
            return true;
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
            interactionId: INPUTS.interaction,
            ephemeral: INPUTS.ephemeral,
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
            const ops = new InteractionOps(takeInteraction);
            await ops.defer(inputs.interactionId, inputs.ephemeral);
            return true;
        },
    }),

    defineAction({
        id: "respond-to-interaction",
        name: "Respond to Interaction",
        category: "Interactions",
        description:
            "Replies to a slash command; edits the reply when the interaction was deferred",
        template: "Respond to interaction {interactionId} with {content}",
        inputs: {
            interactionId: INPUTS.interaction,
            content: INPUTS.content,
            embeds: INPUTS.embeds,
            components: INPUTS.components,
            ephemeral: INPUTS.ephemeral,
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
                components?: unknown;
                ephemeral?: boolean;
            },
        ) => {
            const ops = new InteractionOps(takeInteraction);
            return ops.respond(inputs.interactionId, inputs);
        },
    }),

    defineAction({
        id: "follow-up-interaction",
        name: "Follow Up to Interaction",
        category: "Interactions",
        description: "Sends an additional message after a slash command reply",
        template: "Follow up to interaction {interactionId} with {content}",
        inputs: {
            interactionId: INPUTS.interaction,
            content: INPUTS.content,
            embeds: INPUTS.embeds,
            components: INPUTS.components,
            ephemeral: INPUTS.ephemeral,
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
                components?: unknown;
                ephemeral?: boolean;
            },
        ) => {
            const ops = new InteractionOps(takeInteraction);
            return ops.followUp(inputs.interactionId, inputs);
        },
    }),

    defineAction({
        id: "create-button",
        name: "Create Button",
        category: "Interactions",
        description: "Builds a button for a message's component row",
        template: "Create button {label}",
        inputs: {
            label: {
                type: "string",
                label: "Label",
                placeholder: "Label",
                required: true,
            },
            style: {
                type: "string",
                label: "Style",
                placeholder: "Button style",
                default: "primary",
                options: [
                    { label: "Primary", value: "primary" },
                    { label: "Secondary", value: "secondary" },
                    { label: "Success", value: "success" },
                    { label: "Danger", value: "danger" },
                    { label: "Link", value: "link" },
                ],
            },
            customId: {
                type: "string",
                label: "Interaction ID",
                placeholder: "Interaction ID",
            },
            url: {
                type: "url",
                label: "URL",
                placeholder: "URL",
            },
            emoji: {
                type: "string",
                label: "Emoji",
                placeholder: "Emoji",
            },
            disabled: {
                type: "boolean",
                label: "Disabled",
                default: false,
            },
        },
        output: {
            type: "discord-component",
            label: "Button",
        },
        icon: "smart_button",
        run: async (_ctx, inputs: DiscordComponentData) =>
            buildButtonComponent(inputs || {}),
    }),

    defineAction({
        id: "edit-message",
        name: "Edit Message",
        category: "Messages",
        description: "Edits a message the bot previously sent",
        template: "Edit message {message} to {content}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
            content: INPUTS.content,
            embeds: INPUTS.embeds,
            components: INPUTS.components,
        },
        output: {
            type: "discord-message",
            label: "Message",
        },
        icon: "edit",
        run: async (
            _ctx,
            inputs: {
                channel: string;
                message: string;
                content?: string;
                embeds?: unknown;
            },
        ) => {
            const ops = new MessageOps(getClient());
            return ops.edit(inputs.channel, inputs.message, inputs);
        },
    }),

    defineAction({
        id: "delete-message",
        name: "Delete Message",
        category: "Messages",
        description: "Deletes a message from a Discord channel",
        template: "Delete message {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "delete",
        run: async (
            _ctx,
            inputs: { channel: string; message: string },
        ) => {
            const ops = new MessageOps(getClient());
            await ops.delete(inputs.channel, inputs.message);
            return true;
        },
    }),

    defineAction({
        id: "purge-messages",
        name: "Purge Messages",
        category: "Messages",
        description: "Deletes the newest messages in a channel",
        template: "Purge {count} messages in {channel}",
        inputs: {
            channel: INPUTS.channel,
            count: INPUTS.count,
        },
        output: {
            type: "number",
            label: "Deleted",
        },
        icon: "delete_sweep",
        run: async (_ctx, inputs: { channel: string; count?: number }) => {
            const ops = new MessageOps(getClient());
            return ops.bulkDelete(inputs.channel, inputs.count);
        },
    }),

    defineAction({
        id: "pin-message",
        name: "Pin Message",
        category: "Messages",
        description: "Pins a message in its channel",
        template: "Pin message {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "push_pin",
        run: async (_ctx, inputs: { channel: string; message: string }) => {
            const ops = new MessageOps(getClient());
            await ops.pin(inputs.channel, inputs.message);
            return true;
        },
    }),

    defineAction({
        id: "unpin-message",
        name: "Unpin Message",
        category: "Messages",
        description: "Removes a message from the channel's pinned messages",
        template: "Unpin message {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "keep_off",
        run: async (_ctx, inputs: { channel: string; message: string }) => {
            const ops = new MessageOps(getClient());
            await ops.unpin(inputs.channel, inputs.message);
            return true;
        },
    }),

    defineAction({
        id: "crosspost-message",
        name: "Crosspost Message",
        category: "Messages",
        description: "Publishes a message in an announcement channel to all servers following it",
        template: "Crosspost message {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "podcasts",
        run: async (_ctx, inputs: { channel: string; message: string }) => {
            const ops = new MessageOps(getClient());
            await ops.crosspost(inputs.channel, inputs.message);
            return true;
        },
    }),

    defineAction({
        id: "remove-reaction",
        name: "Remove Reaction",
        category: "Reactions",
        description: "Removes an emoji reaction from a message, optionally only from one user",
        template: "Remove reaction {emoji} from {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
            emoji: INPUTS.emoji,
            user: { ...INPUTS.user, required: false },
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "heart_broken",
        run: async (
            _ctx,
            inputs: { channel: string; message: string; emoji: string; user?: string },
        ) => {
            const ops = new MessageOps(getClient());
            await ops.removeReaction(inputs.channel, inputs.message, inputs.emoji, inputs.user);
            return true;
        },
    }),

    defineAction({
        id: "add-role",
        name: "Add Role",
        category: "Roles",
        description: "Gives a role to a member",
        template: "Add role {role} to {user}",
        inputs: {
            user: INPUTS.user,
            role: INPUTS.role,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "how_to_reg",
        run: async (
            _ctx,
            inputs: { user: string; role: string; guildId?: string },
        ) => {
            const bot = getClient();
            const member = await resolveMember(bot, inputs.user, inputs.guildId);
            await member.roles.add(inputs.role.trim());
            return true;
        },
    }),

    defineAction({
        id: "remove-role",
        name: "Remove Role",
        category: "Roles",
        description: "Takes a role away from a member",
        template: "Remove role {role} from {user}",
        inputs: {
            user: INPUTS.user,
            role: INPUTS.role,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "do_not_disturb_on",
        run: async (
            _ctx,
            inputs: { user: string; role: string; guildId?: string },
        ) => {
            const bot = getClient();
            const member = await resolveMember(bot, inputs.user, inputs.guildId);
            await member.roles.remove(inputs.role.trim());
            return true;
        },
    }),

    defineAction({
        id: "create-role",
        name: "Create Role",
        category: "Roles",
        description: "Creates a server role and returns its id",
        template: "Create role {name}",
        inputs: {
            name: INPUTS.name,
            color: INPUTS.color,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "discord-role",
            label: "Role",
        },
        icon: "add_moderator",
        run: async (
            _ctx,
            inputs: { name: string; color?: string; guildId?: string },
        ) => {
            const bot = getClient();
            const guild = await resolveGuild(bot, inputs.guildId);
            const role = await guild.roles.create({
                name: inputs.name.trim(),
                ...(inputs.color ? { color: inputs.color as ColorResolvable } : {}),
            });
            return role.id;
        },
    }),

    defineAction({
        id: "delete-role",
        name: "Delete Role",
        category: "Roles",
        description: "Deletes a role from the server",
        template: "Delete role {role}",
        inputs: {
            role: INPUTS.role,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "remove_moderator",
        run: async (_ctx, inputs: { role: string; guildId?: string }) => {
            const bot = getClient();
            const guild = await resolveGuild(bot, inputs.guildId);
            const role = await guild.roles.fetch(inputs.role.trim());
            if (!role) {
                throw new Error(`Role ${inputs.role} not found`);
            }
            await role.delete();
            return true;
        },
    }),

    defineAction({
        id: "ban-member",
        name: "Ban Member",
        category: "Members",
        description: "Bans a user from the server",
        template: "Ban {user}",
        inputs: {
            user: INPUTS.user,
            deleteDays: INPUTS.deleteDays,
            reason: INPUTS.reason,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "block",
        run: async (
            _ctx,
            inputs: { user: string; deleteDays?: number; reason?: string; guildId?: string },
        ) => {
            const bot = getClient();
            const guild = await resolveGuild(bot, inputs.guildId);
            const days = Math.max(0, Math.min(7, Math.floor(Number(inputs.deleteDays ?? 0))));
            await guild.members.ban(inputs.user.trim(), {
                deleteMessageSeconds: days * 86_400,
                ...(inputs.reason ? { reason: inputs.reason } : {}),
            });
            return true;
        },
    }),

    defineAction({
        id: "unban-member",
        name: "Unban User",
        category: "Members",
        description: "Lifts a ban for a user",
        template: "Unban {user}",
        inputs: {
            user: INPUTS.user,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "person_remove",
        run: async (_ctx, inputs: { user: string; guildId?: string }) => {
            const bot = getClient();
            const guild = await resolveGuild(bot, inputs.guildId);
            await guild.members.unban(inputs.user.trim());
            return true;
        },
    }),

    defineAction({
        id: "kick-member",
        name: "Kick Member",
        category: "Members",
        description: "Removes a member from the server",
        template: "Kick {user}",
        inputs: {
            user: INPUTS.user,
            reason: INPUTS.reason,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "logout",
        run: async (
            _ctx,
            inputs: { user: string; reason?: string; guildId?: string },
        ) => {
            const bot = getClient();
            const member = await resolveMember(bot, inputs.user, inputs.guildId);
            await member.kick(inputs.reason ?? undefined);
            return true;
        },
    }),

    defineAction({
        id: "timeout-member",
        name: "Timeout Member",
        category: "Members",
        description: "Mutes a member for a set number of minutes",
        template: "Timeout {user} for {minutes} minutes",
        inputs: {
            user: INPUTS.user,
            minutes: INPUTS.minutes,
            reason: INPUTS.reason,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "timer",
        run: async (
            _ctx,
            inputs: { user: string; minutes?: number; reason?: string; guildId?: string },
        ) => {
            const bot = getClient();
            const member = await resolveMember(bot, inputs.user, inputs.guildId);
            const minutes = Math.max(1, Math.min(40_320, Math.floor(Number(inputs.minutes ?? 10))));
            await member.timeout(minutes * 60_000, inputs.reason ?? undefined);
            return true;
        },
    }),

    defineAction({
        id: "create-channel",
        name: "Create Channel",
        category: "Channels",
        description: "Creates a text, voice, announcement, or category channel",
        template: "Create channel {name}",
        inputs: {
            name: INPUTS.name,
            kind: INPUTS.kind,
            topic: INPUTS.topic,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "discord-channel",
            label: "Channel",
        },
        icon: "add_comment",
        run: async (
            _ctx,
            inputs: { name: string; kind?: string; topic?: string; guildId?: string },
        ) => {
            const bot = getClient();
            const guild = await resolveGuild(bot, inputs.guildId);
            const kindMap: Record<
                string,
                typeof ChannelType.GuildText | typeof ChannelType.GuildVoice | typeof ChannelType.GuildAnnouncement | typeof ChannelType.GuildCategory
            > = {
                text: ChannelType.GuildText,
                voice: ChannelType.GuildVoice,
                announcement: ChannelType.GuildAnnouncement,
                category: ChannelType.GuildCategory,
            };
            const kind = kindMap[(inputs.kind || "text").toLowerCase()];
            if (kind === undefined) {
                throw new Error(`Unknown channel kind "${inputs.kind}"`);
            }
            const channel = await guild.channels.create({
                name: inputs.name.trim(),
                type: kind,
                ...(inputs.topic && kind === ChannelType.GuildText
                    ? { topic: inputs.topic }
                    : {}),
            });
            return channel.id;
        },
    }),

    defineAction({
        id: "delete-channel",
        name: "Delete Channel",
        category: "Channels",
        description: "Deletes a channel",
        template: "Delete channel {channel}",
        inputs: {
            channel: INPUTS.channel,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "delete_forever",
        run: async (_ctx, inputs: { channel: string }) => {
            const ops = new MessageOps(getClient());
            const channel = await ops.fetchChannel(inputs.channel);
            await channel.delete();
            return true;
        },
    }),

    defineAction({
        id: "edit-channel",
        name: "Edit Channel",
        category: "Channels",
        description: "Renames a channel or changes its topic or slowmode",
        template: "Edit channel {channel}",
        inputs: {
            channel: INPUTS.channel,
            name: { ...INPUTS.name, required: false },
            topic: INPUTS.topic,
            slowmode: INPUTS.slowmode,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "tune",
        run: async (
            _ctx,
            inputs: { channel: string; name?: string; topic?: string; slowmode?: number },
        ) => {
            const ops = new MessageOps(getClient());
            const channel = await ops.fetchChannel(inputs.channel);
            if (
                inputs.name === undefined &&
                inputs.topic === undefined &&
                inputs.slowmode === undefined
            ) {
                throw new Error("Edit Channel needs a name, topic, or slowmode to change");
            }
            await (channel as any).edit({
                ...(inputs.name !== undefined ? { name: inputs.name } : {}),
                ...(inputs.topic !== undefined ? { topic: inputs.topic } : {}),
                ...(inputs.slowmode !== undefined
                    ? { rateLimitPerUser: Math.max(0, Math.min(21_600, Math.floor(Number(inputs.slowmode)))) }
                    : {}),
            });
            return true;
        },
    }),

    defineAction({
        id: "create-thread",
        name: "Create Thread",
        category: "Channels",
        description: "Starts a thread from a message",
        template: "Create thread {name} from {message}",
        inputs: {
            channel: INPUTS.channel,
            message: INPUTS.message,
            name: INPUTS.name,
        },
        output: {
            type: "discord-channel",
            label: "Thread",
        },
        icon: "forum",
        run: async (
            _ctx,
            inputs: { channel: string; message: string; name: string },
        ) => {
            const ops = new MessageOps(getClient());
            return ops.startThread(inputs.channel, inputs.message, inputs.name);
        },
    }),

    defineAction({
        id: "move-member",
        name: "Move Member",
        category: "Members",
        description: "Moves a connected member to another voice channel",
        template: "Move {user} to {channel}",
        inputs: {
            user: INPUTS.user,
            channel: INPUTS.channel,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "swap_horiz",
        run: async (
            _ctx,
            inputs: { user: string; channel: string; guildId?: string },
        ) => {
            const bot = getClient();
            const member = await resolveMember(bot, inputs.user, inputs.guildId);
            if (!member.voice.channel) {
                throw new Error(
                    `User ${inputs.user} is not connected to a voice channel`,
                );
            }
            await member.voice.setChannel(inputs.channel.trim());
            return true;
        },
    }),

    defineAction({
        id: "disconnect-member",
        name: "Disconnect Member",
        category: "Members",
        description: "Disconnects a member from voice",
        template: "Disconnect {user}",
        inputs: {
            user: INPUTS.user,
            guildId: INPUTS.guildId,
        },
        output: {
            type: "boolean",
            label: "Success",
        },
        icon: "voice_over_off",
        run: async (
            _ctx,
            inputs: { user: string; guildId?: string },
        ) => {
            const bot = getClient();
            const member = await resolveMember(bot, inputs.user, inputs.guildId);
            if (!member.voice.channel) {
                throw new Error(
                    `User ${inputs.user} is not connected to a voice channel`,
                );
            }
            await member.voice.disconnect();
            return true;
        },
    }),

    defineAction({
        id: "create-invite",
        name: "Create Invite",
        category: "Channels",
        description: "Creates an invite link for a channel",
        template: "Create invite for {channel}",
        inputs: {
            channel: INPUTS.channel,
            maxUses: INPUTS.maxUses,
        },
        output: {
            type: "url",
            label: "Invite",
        },
        icon: "link",
        run: async (_ctx, inputs: { channel: string; maxUses?: number }) => {
            const ops = new MessageOps(getClient());
            const channel = await ops.fetchChannel(inputs.channel);
            if (!("createInvite" in channel)) {
                throw new Error(`Channel ${inputs.channel} cannot have invites`);
            }
            const maxUses = Math.max(0, Math.min(100, Math.floor(Number(inputs.maxUses ?? 0))));
            const invite = await (channel as any).createInvite({
                maxUses,
                maxAge: 0,
                unique: true,
            });
            return invite.url;
        },
    }),
];

// Typed fields each static trigger offers. Keys mirror the payloads the
// emit sites in attachListeners send, so a variable inserted from the
// picker always resolves to a real value (labels are the picker's names).
// event actions fire as events and start flows; they are not callable
export const staticTriggers = [
    defineAction({
        id: "on-message",
        name: "When a message is received",
        category: "Messages",
        description: "Fires whenever a message is sent in Discord",
        template: "When a message is received in Discord",
        output: { type: "object", label: "Message Data" },
        outputFields: {
            content: { type: "string", label: "Message", typeName: "Text" },
            author: { type: "string", label: "Username", typeName: "Text" },
            authorId: { type: "discord-user", label: "User", typeName: "User" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            messageId: { type: "discord-message", label: "Message ID", typeName: "Message" },
        },
        icon: "chat",
    }),

    defineAction({
        id: "on-member-join",
        name: "When member joins server",
        category: "Members",
        description: "Fires when a new member joins a server",
        template: "When a new member joins",
        output: { type: "object", label: "Member Data" },
        outputFields: {
            username: { type: "string", label: "Username", typeName: "Text" },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            guildName: { type: "string", label: "Server Name", typeName: "Text" },
        },
        icon: "person_add",
    }),

    defineAction({
        id: "on-member-leave",
        name: "When member leaves server",
        category: "Members",
        description: "Fires when a member leaves a server",
        template: "When a member leaves",
        output: { type: "object", label: "Member Data" },
        outputFields: {
            username: { type: "string", label: "Username", typeName: "Text" },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "person_remove",
    }),

    defineAction({
        id: "on-reaction-add",
        name: "When a reaction is added",
        category: "Reactions",
        description: "Fires when an emoji reaction is added to a message",
        template: "When an emoji reaction is added",
        output: { type: "object", label: "Reaction Data" },
        outputFields: {
            emoji: { type: "string", label: "Emoji", typeName: "Text" },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            messageId: { type: "discord-message", label: "Message ID", typeName: "Message" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
        },
        icon: "add_reaction",
    }),

    defineAction({
        id: "on-connection-error",
        name: "When the bot connection fails",
        category: discordCategory("Bot"),
        description: "Fires with the typed login error when the bot fails to connect",
        template: "When the bot fails to connect",
        output: { type: "object", label: "Error Data" },
        outputFields: {
            error: { type: "string", label: "Error", typeName: "Text" },
        },
        icon: "error",
    }),

    // Buttons only in v1; other component kinds come later
    defineAction({
        id: "interaction-triggered",
        name: "When an Interaction is Triggered",
        category: discordCategory("Interactions"),
        description: "Fires when a user clicks a button this bot sent",
        template: "When interaction {customId} is triggered",
        inputs: {
            customId: {
                type: "string",
                label: "Interaction ID",
                placeholder: "Interaction ID",
                required: true,
            },
        },
        match: { field: "customId", input: "customId" },
        output: { type: "object", label: "Interaction Data" },
        outputFields: {
            customId: { type: "string", label: "Interaction ID", typeName: "Text" },
            interactionId: {
                type: "discord-interaction",
                label: "Interaction",
                typeName: "Interaction",
            },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            channelId: {
                type: "discord-channel",
                label: "Channel",
                typeName: "Channel",
            },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            messageId: {
                type: "discord-message",
                label: "Message",
                typeName: "Message",
            },
        },
        icon: "touch_app",
    }),

    defineAction({
        id: "on-message-edited",
        name: "When a message is edited",
        category: discordCategory("Messages"),
        description: "Fires when a message is edited in Discord",
        template: "When a message is edited",
        output: { type: "object", label: "Message Data" },
        outputFields: {
            content: { type: "string", label: "Message", typeName: "Text" },
            author: { type: "string", label: "Username", typeName: "Text" },
            authorId: { type: "discord-user", label: "User", typeName: "User" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
            messageId: { type: "discord-message", label: "Message ID", typeName: "Message" },
        },
        icon: "edit_note",
    }),

    defineAction({
        id: "on-message-deleted",
        name: "When a message is deleted",
        category: discordCategory("Messages"),
        description: "Fires when a message is deleted in Discord",
        template: "When a message is deleted",
        output: { type: "object", label: "Message Data" },
        outputFields: {
            messageId: { type: "discord-message", label: "Message ID", typeName: "Message" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "delete",
    }),

    defineAction({
        id: "on-reaction-removed",
        name: "When a reaction is removed",
        category: discordCategory("Reactions"),
        description: "Fires when a user's reaction is taken off a message",
        template: "When a reaction is removed",
        output: { type: "object", label: "Reaction Data" },
        outputFields: {
            emoji: { type: "string", label: "Emoji", typeName: "Text" },
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            messageId: { type: "discord-message", label: "Message ID", typeName: "Message" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
        },
        icon: "heart_broken",
    }),

    defineAction({
        id: "on-member-banned",
        name: "When a member is banned",
        category: discordCategory("Members"),
        description: "Fires when a user is banned from a server the bot is in",
        template: "When a member is banned",
        output: { type: "object", label: "Ban Data" },
        outputFields: {
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            reason: { type: "string", label: "Reason", typeName: "Text" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "block",
    }),

    defineAction({
        id: "on-role-added",
        name: "When a member gets a role",
        category: discordCategory("Roles"),
        description: "Fires when a role is granted to a member",
        template: "When a member gets a role",
        output: { type: "object", label: "Role Data" },
        outputFields: {
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            roleId: { type: "discord-role", label: "Role", typeName: "Role" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "how_to_reg",
    }),

    defineAction({
        id: "on-role-removed",
        name: "When a member loses a role",
        category: discordCategory("Roles"),
        description: "Fires when a role is taken away from a member",
        template: "When a member loses a role",
        output: { type: "object", label: "Role Data" },
        outputFields: {
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            roleId: { type: "discord-role", label: "Role", typeName: "Role" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "do_not_disturb_on",
    }),

    defineAction({
        id: "on-thread-created",
        name: "When a thread is created",
        category: discordCategory("Channels"),
        description: "Fires when a thread is started in a channel",
        template: "When a thread is created",
        output: { type: "object", label: "Thread Data" },
        outputFields: {
            threadId: { type: "discord-channel", label: "Thread", typeName: "Channel" },
            name: { type: "string", label: "Name", typeName: "Text" },
            channelId: { type: "discord-channel", label: "Parent Channel", typeName: "Channel" },
            ownerId: { type: "discord-user", label: "Owner", typeName: "User" },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "forum",
    }),

    defineAction({
        id: "on-voice-state-change",
        name: "When a voice state changes",
        category: discordCategory("Members"),
        description: "Fires when a member joins, moves, or leaves voice",
        template: "When a voice state changes",
        output: { type: "object", label: "Voice Data" },
        outputFields: {
            userId: { type: "discord-user", label: "User", typeName: "User" },
            username: { type: "string", label: "Username", typeName: "Text" },
            channelId: { type: "discord-channel", label: "Channel", typeName: "Channel" },
            previousChannelId: {
                type: "discord-channel",
                label: "Previous Channel",
                typeName: "Channel",
            },
            guildId: { type: "string", label: "Server ID", typeName: "Text" },
        },
        icon: "spatial_audio",
    }),

    defineAction({
        id: "on-bot-ready",
        name: "When the bot becomes ready",
        category: discordCategory("Bot"),
        description: "Fires when the bot's gateway session is live",
        template: "When the bot becomes ready",
        output: { type: "object", label: "Bot Data" },
        outputFields: {
            userId: { type: "discord-user", label: "Bot User", typeName: "User" },
            username: { type: "string", label: "Bot Name", typeName: "Text" },
        },
        icon: "verified",
    }),
];

// UI-only RPCs: internal actions stay callable through actionsApi.call for
// the panel's own controls, and the Actions library hides them by schema
// instead of by a name suffix
function internalAction(
    id: string,
    name: string,
    description: string,
    run: (inputs: any) => unknown | Promise<unknown>,
) {
    return defineAction({
        id,
        name,
        description,
        template: name,
        internal: true,
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
    actions: [...actions, ...staticTriggers],
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
            "get-user-install-url",
            "Get User Install URL",
            "Panel UI only: builds the account-install URL for user-app commands.",
            () => buildUserInstallUrl(client?.user?.id || savedAppId),
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
                userInstall?: unknown;
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
                const userInstall = Boolean(input?.userInstall);
                const problem = describeCommandProblem({ name, description });
                if (problem) throw new Error(problem);
                if (scope !== GLOBAL_SCOPE && !SNOWFLAKE_PATTERN.test(scope)) {
                    throw new Error(`Unknown command scope "${scope}".`);
                }
                if (userInstall && scope !== GLOBAL_SCOPE) {
                    throw new Error(
                        "User apps are only available for global commands: Discord ignores installation contexts on server-scoped commands.",
                    );
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
                    userInstall,
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
