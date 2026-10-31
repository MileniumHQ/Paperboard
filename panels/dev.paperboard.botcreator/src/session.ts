// One bot's live session: its discord.js client, connection truth, pending
// interactions, recent messages and slash-command sync. Every bot gets its
// own, so two bots share nothing but the code; the service owns the list
// and tells each session where its triggers go.
import {
    Client,
    GatewayIntentBits,
    ChannelType,
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ApplicationIntegrationType,
    type ApplicationCommandOptionData,
    type ChatInputApplicationCommandData,
    type ChatInputCommandInteraction,
    type RepliableInteraction,
} from "discord.js";
import {
    AUTO_ACK_DELAY_MS,
    autoAcknowledge,
    componentClickPayload,
    modalSubmitPayload,
} from "./discordOps";
import { CommandActivityRecorder } from "./commandActivity";
import {
    appendCapped,
    RECENT_MESSAGE_CAP,
    GLOBAL_SCOPE,
    INTERACTION_TTL_MS,
    PENDING_INTERACTION_CAP,
    MEMBER_SEARCH_LIMIT,
    commandTriggerId,
    findCommandForInteraction,
    errorToMessage,
    type SlashCommandDefinition,
    type SlashCommandOption,
    type DiscordChannelKind,
    type Health,
    type GuildSummary,
    type GuildDetail,
    type MemberSummary,
} from "./types";

// connection state is explicit, never inferred: a failed login nulls the
// client and records the typed error here (surfaced via get-bot-info and
// the on-connection-error trigger), so the UI can never show "online"
// for a bot that isn't running. The same rule applies mid-session:
// gateway disconnects invalidate the status (see attachListeners), and a
// successful reconnect marks it live again via clientReady/shardReady.
export interface ConnectionStatus {
    connected: boolean;
    error?: string;
}

export interface RecentMessage {
    content: string;
    author: string;
    authorId: string;
    channelId: string;
    guildId: string | null;
    messageId: string;
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

export interface BotWidgetStatus {
    /** a token is saved for this bot; false means it needs one */
    configured: boolean;
    connected: boolean;
    lastError: string | null;
    name: string;
    avatar: string;
    guildCount: number;
}

/** Where a session's events go: the service maps them to the bot's project. */
export interface SessionHost {
    /** fires one of this bot's triggers, by its id inside the bot's project */
    emit(trigger: string, output: unknown): void;
    /** the bot's identity or connection changed; the service republishes it */
    changed(): void;
}

interface PendingInteraction {
    interaction: RepliableInteraction;
    timer: ReturnType<typeof setTimeout>;
    ackTimer: ReturnType<typeof setTimeout>;
}

// Discord's 3-second window starts when it creates the interaction, not
// when the bot receives it; a late arrival cannot be answered in time
const LATE_INTERACTION_MS = 1_500;

// timers must not keep the host process alive on their own (Node/Bun
// timers expose unref; the browser double does not)
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    (timer as unknown as { unref?: () => void }).unref?.();
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

export class BotSession {
    client: Client | null = null;
    /** the application id known before login: saved, or read from the token */
    applicationId = "";
    /**
     * The live view of the bot's stored commands: the interaction handler
     * needs a synchronous lookup, and the trigger registry mirrors this list.
     */
    commands: SlashCommandDefinition[] = [];
    /**
     * Slash commands run, per hour, for the Command activity widget. Fixed
     * size, outlives reconnects so a gateway blip does not wipe the day's chart.
     */
    readonly activity = new CommandActivityRecorder();

    // sequence guard for concurrent connect attempts: only the newest
    // start() may write session state (client/connectionStatus) — a losing
    // attempt's outcome must never overwrite a winner's
    private connectSequence = 0;
    private connectionStatus: ConnectionStatus = { connected: false };
    // the newest start() is still logging in to Discord
    private loggingIn = false;
    // proof-of-loop evidence: the last messages the session received, capped
    // so a busy server can never grow this without bound. A new session
    // starts empty; disconnecting keeps the last evidence beside
    // connected:false. The cap lives in types.ts, shared with the UI's live
    // subscription of the same list.
    private recentMessages: RecentMessage[] = [];
    // A flow can take longer than Discord's 3-second acknowledgement window,
    // so the interaction object stays here for its whole 15-minute token
    // life: Respond, Follow Up, and a second Respond (an edit) all reach it.
    // Bounded: oldest entries are dropped at the cap, and every entry's TTL
    // and auto-acknowledge timers are cleared on removal or disconnect.
    private readonly pending = new Map<string, PendingInteraction>();
    // set on a successful login, cleared on stop: uptime must never survive
    // the session it describes
    private sessionStartedAt: number | null = null;
    private commandsReceived = 0;
    private commandSyncError: string | null = null;

    constructor(
        readonly id: string,
        private readonly host: SessionHost,
    ) {}

    status(): ConnectionStatus {
        return { ...this.connectionStatus };
    }

    /** Logging in to Discord, which a rate limit can stretch to minutes. */
    connecting(): boolean {
        return this.loggingIn;
    }

    connected(): boolean {
        return this.client !== null && this.connectionStatus.connected;
    }

    getRecentMessages(): RecentMessage[] {
        return [...this.recentMessages];
    }

    clearRecentMessages(): void {
        this.recentMessages = [];
    }

    recordRecentMessage(msg: RecentMessage): void {
        this.recentMessages = appendCapped(this.recentMessages, msg, RECENT_MESSAGE_CAP);
    }

    /** The live client, or why there is none. */
    requireClient(): Client {
        if (!this.client) {
            throw new Error("This bot is not connected. Turn it on in Bot Creator.");
        }
        return this.client;
    }

    // ---------------------------------------------------------------------
    // pending interactions
    // ---------------------------------------------------------------------

    pendingCount(): number {
        return this.pending.size;
    }

    private dropEntry(key: string): void {
        const entry = this.pending.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        clearTimeout(entry.ackTimer);
        this.pending.delete(key);
    }

    /**
     * Records a live interaction and arms its automatic acknowledgement: if no
     * flow answered after AUTO_ACK_DELAY_MS, the bot acknowledges so Discord
     * does not show "interaction failed". Flows never need a Defer step.
     */
    rememberInteraction(interaction: RepliableInteraction): void {
        const key = interaction.id;
        if (this.pending.has(key)) this.dropEntry(key);

        if (this.pending.size >= PENDING_INTERACTION_CAP) {
            const oldestKey = this.pending.keys().next().value;
            if (oldestKey !== undefined) this.dropEntry(oldestKey);
        }

        const lateByMs = Date.now() - interaction.createdTimestamp;
        if (lateByMs > LATE_INTERACTION_MS) {
            console.warn(
                `[DiscordService] interaction ${key} arrived ${lateByMs} ms after Discord created it; Discord expires it at 3000 ms`,
            );
        }
        const timer = setTimeout(() => this.dropEntry(key), INTERACTION_TTL_MS);
        const ackTimer = setTimeout(() => {
            autoAcknowledge(interaction).catch((err: unknown) =>
                console.error(
                    `[DiscordService] automatic acknowledgement failed ${Date.now() - interaction.createdTimestamp} ms after Discord created the interaction:`,
                    errorToMessage(err),
                ),
            );
        }, AUTO_ACK_DELAY_MS);
        unrefTimer(timer);
        unrefTimer(ackTimer);
        this.pending.set(key, { interaction, timer, ackTimer });
    }

    takeInteraction(interactionId: string): RepliableInteraction {
        const entry = this.pending.get(interactionId);
        if (!entry) {
            throw new Error(
                `Interaction ${interactionId} is not pending. It was never recorded or its 15-minute window expired.`,
            );
        }
        return entry.interaction;
    }

    clearPendingInteractions(): void {
        for (const key of [...this.pending.keys()]) this.dropEntry(key);
    }

    // ---------------------------------------------------------------------
    // reads
    // ---------------------------------------------------------------------

    // guild list straight from the client cache (bounded slices: the cache
    // is already finite, this keeps the wire shape finite too)
    listGuilds(): BotGuildInfo[] {
        const bot = this.client;
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

    guildSummaries(): GuildSummary[] {
        const bot = this.client;
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

    info() {
        const bot = this.client;
        return {
            name: bot?.user?.username || "Discord Bot",
            avatar: bot?.user?.displayAvatarURL() || "",
            tag: bot?.user?.tag || "",
            guildCount: bot?.guilds?.cache?.size || 0,
            guilds: this.listGuilds(),
            applicationId: bot?.user?.id || this.applicationId,
            connected: this.connected(),
            lastError: this.connectionStatus.error ?? null,
            recentMessages: this.getRecentMessages(),
        };
    }

    health(): Health {
        const bot = this.client;
        return {
            connected: this.connected(),
            lastError: this.connectionStatus.error ?? null,
            uptimeMs: bot && this.sessionStartedAt ? Math.max(0, Date.now() - this.sessionStartedAt) : 0,
            wsPing: bot?.ws?.ping ?? -1,
            wsStatus: bot?.ws?.status ?? -1,
            guildCount: bot?.guilds?.cache?.size ?? 0,
            cachedUsers: bot?.users?.cache?.size ?? 0,
            cachedChannels: bot?.channels?.cache?.size ?? 0,
            commandsReceived: this.commandsReceived,
            pendingInteractions: this.pending.size,
            commandSyncError: this.commandSyncError,
        };
    }

    // what the Bot status widget shows: the identity and server count of the
    // live session only. A bot that is not connected reports no servers
    // rather than a stale count from a session that ended
    widgetStatus(configured: boolean, saved: { name: string; avatar: string }): BotWidgetStatus {
        const bot = this.client;
        const connected = this.connected();
        return {
            configured,
            connected,
            lastError: this.connectionStatus.error ?? null,
            name: bot?.user?.username || saved.name,
            avatar: bot?.user?.displayAvatarURL() || saved.avatar,
            guildCount: connected ? bot?.guilds?.cache?.size ?? 0 : 0,
        };
    }

    // ---------------------------------------------------------------------
    // lifecycle
    // ---------------------------------------------------------------------

    async stop(): Promise<void> {
        // a stop supersedes any login still in flight
        this.connectSequence++;
        await this.release();
    }

    // Lets go of the client. Every write happens before the destroy is
    // awaited: a newer attempt may own the session by the time it returns.
    private async release(): Promise<void> {
        const bot = this.client;
        this.client = null;
        this.loggingIn = false;
        // a stopped session has no answerable interactions, no uptime, no
        // sync state — anything else would let the health page describe a
        // bot that is not running
        this.clearPendingInteractions();
        this.sessionStartedAt = null;
        this.commandSyncError = null;
        if (this.connectionStatus.connected) this.connectionStatus = { connected: false };
        this.host.changed();
        if (!bot) return;
        try {
            await bot.destroy();
        } catch (err) {
            console.error("[DiscordService] bot destroy failed:", err);
        }
    }

    /** Records why the bot can't run without trying to log in (no token). */
    fail(message: string): void {
        this.connectionStatus = { connected: false, error: message };
        this.host.changed();
    }

    async start(token: string, clientFactory?: () => Client): Promise<void> {
        if (!token) throw new Error("No bot token is stored for this bot.");
        const attempt = ++this.connectSequence;
        await this.release();
        // A newer attempt (or a stop) may have started while we awaited the
        // release: from here on every write to session state
        // (client/connectionStatus) is sequence-checked — a losing attempt
        // must not overwrite the winner.
        if (attempt !== this.connectSequence) {
            console.warn("[DiscordService] superseded connect attempt discarded before login");
            return;
        }
        this.clearRecentMessages();
        this.commandsReceived = 0;

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
        this.client = bot;
        this.connectionStatus = { connected: false };
        this.loggingIn = true;
        this.host.changed();
        this.attachListeners(bot);

        try {
            try {
                await bot.login(token);
            } finally {
                if (attempt === this.connectSequence) this.loggingIn = false;
            }
            // a newer start or a stop won the race: it already let go of our
            // client — destroy is idempotent-safe here, and session state
            // stays the winner's
            if (attempt !== this.connectSequence) {
                console.warn("[DiscordService] superseded connect attempt discarded");
                try {
                    await bot.destroy();
                } catch (destroyErr) {
                    console.error("[DiscordService] bot destroy after supersede failed:", destroyErr);
                }
                return;
            }
            this.connectionStatus = { connected: true };
            this.sessionStartedAt = Date.now();
            this.host.changed();
            // command registration must not fail the login: a connected bot
            // whose commands are not on Discord yet is a sync problem,
            // recorded in health rather than reported as a connection failure
            await this.syncAfterLogin(bot);
        } catch (err: any) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[DiscordService] Login failed:", message);
            try {
                await bot.destroy();
            } catch (destroyErr) {
                console.error("[DiscordService] bot destroy after failed login failed:", destroyErr);
            }
            // only clear our own attempt — a newer login may already own client
            if (this.client === bot) this.client = null;
            // only the newest attempt may write session status
            if (attempt === this.connectSequence) {
                this.connectionStatus = { connected: false, error: message };
            }
            this.host.changed();
            this.emit("on-connection-error", { error: message });
            throw new Error(`Discord login failed: ${message}`);
        }
    }

    private emit(trigger: string, output: unknown): void {
        try {
            this.host.emit(trigger, output);
        } catch (err) {
            console.error(`[DiscordService] trigger emit failed for ${trigger}:`, err);
        }
    }

    private attachListeners(bot: Client): void {
        // only the live session's events may touch session state: a
        // superseded client's listeners are still registered on it until
        // destroy completes, and its messages/reactions must not be reported
        // as if they came from the bot the user is running now
        const ownsSession = () => this.client === bot;
        const emit = (trigger: string, output: unknown) => this.emit(trigger, output);

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
            this.recordRecentMessage(payload);
            emit("on-message", payload);
        });

        bot.on("guildMemberAdd", (member) => {
            if (!ownsSession()) return;
            emit("on-member-join", {
                username: member.user.username,
                userId: member.user.id,
                guildId: member.guild.id,
                guildName: member.guild.name,
            });
        });

        bot.on("guildMemberRemove", (member) => {
            if (!ownsSession()) return;
            emit("on-member-leave", {
                username: member.user.username,
                userId: member.user.id,
                guildId: member.guild.id,
            });
        });

        // the home screen shows how many servers each bot is in
        bot.on("guildCreate", () => {
            if (ownsSession()) this.host.changed();
        });
        bot.on("guildDelete", () => {
            if (ownsSession()) this.host.changed();
        });

        bot.on("messageReactionAdd", (reaction, user) => {
            if (user.bot) return;
            if (!ownsSession()) return;
            emit("on-reaction-add", {
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
            emit("on-reaction-removed", {
                emoji: reaction.emoji.name || reaction.emoji.id,
                userId: user.id,
                username: user.username,
                messageId: reaction.message.id,
                channelId: reaction.message.channelId,
            });
        });

        bot.on("messageUpdate", (_oldMsg, newMsg) => {
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
                emit("on-message-edited", {
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
            emit("on-message-deleted", {
                messageId: msg.id,
                channelId: msg.channelId,
                guildId: msg.guildId ?? "",
            });
        });

        bot.on("guildBanAdd", (ban) => {
            if (!ownsSession()) return;
            emit("on-member-banned", {
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
                    emit("on-role-added", {
                        userId: newMember.user.id,
                        username: newMember.user.username,
                        roleId,
                        guildId: newMember.guild.id,
                    });
                }
            }
            for (const roleId of before) {
                if (!newMember.roles.cache.has(roleId)) {
                    emit("on-role-removed", {
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
            emit("on-thread-created", {
                threadId: thread.id,
                name: thread.name ?? "",
                channelId: thread.parentId ?? "",
                ownerId: thread.ownerId ?? "",
                guildId: thread.guildId,
            });
        });

        bot.on("voiceStateUpdate", (oldState, newState) => {
            if (!ownsSession()) return;
            emit("on-voice-state-change", {
                userId: newState.id,
                username: newState.member?.user?.username ?? "",
                channelId: newState.channelId ?? "",
                previousChannelId: oldState?.channelId ?? "",
                guildId: newState.guild.id,
            });
        });

        bot.on("interactionCreate", (interaction) => {
            if (!ownsSession()) return;
            // button clicks and menu picks route through the parameterized
            // interaction-triggered event by custom id
            if (interaction.isButton() || interaction.isAnySelectMenu()) {
                this.rememberInteraction(interaction);
                emit("interaction-triggered", componentClickPayload(interaction));
                return;
            }
            // submitted modals route by modal id the same way
            if (interaction.isModalSubmit()) {
                this.rememberInteraction(interaction);
                emit("modal-submitted", modalSubmitPayload(interaction));
                return;
            }
            if (!interaction.isChatInputCommand()) return;
            this.commandsReceived++;
            this.activity.record();

            // Discord resolves a guild command over a same-named global one;
            // the trigger to fire must follow the same rule
            const command = findCommandForInteraction(
                this.commands,
                interaction.commandName,
                interaction.guildId ?? null,
            );
            if (!command) {
                // an interaction for a command this panel does not manage:
                // there is no trigger to fire and no stored definition to
                // answer with
                console.error(
                    `[DiscordService] ignored interaction for unknown command /${interaction.commandName}; no trigger is registered for it`,
                );
                return;
            }

            this.rememberInteraction(interaction);
            emit(commandTriggerId(command), {
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
            });
        });

        // gateway truth mid-session: a drop must invalidate connectionStatus
        // the same way a failed login does — otherwise the UI shows "online"
        // for a bot that is not running. A successful reconnect flips it back.
        const markGatewayDown = (source: string, err?: unknown) => {
            if (!ownsSession()) return;
            const message = gatewayErrorMessage(err);
            console.error(`[DiscordService] gateway ${source}:`, message);
            this.connectionStatus = { connected: false, error: message };
            this.host.changed();
            emit("on-connection-error", { error: message });
        };

        // discord.js retries these internally; shardReady/clientReady below
        // restores the connected flag when the gateway actually comes back
        bot.on("disconnect" as any, (err?: unknown) => markGatewayDown("disconnect", err));
        bot.on("shardDisconnect", (event) => markGatewayDown("shardDisconnect", event));
        // a resume replays what the dropped connection missed; interactions
        // in that replay are already past Discord's answer window
        bot.on("shardResume", (_shardId, replayed) => {
            if (replayed > 0) console.warn(`[DiscordService] gateway resumed and replayed ${replayed} missed events`);
        });

        // fatal: the token was reset/revoked — destroy immediately and record
        bot.on("invalidated", () => {
            if (!ownsSession()) return;
            const message = "Session invalidated: token was reset or revoked";
            console.error(`[DiscordService] ${message}`);
            this.connectionStatus = { connected: false, error: message };
            this.client = null;
            void bot
                .destroy()
                .catch((destroyErr: unknown) =>
                    console.error("[DiscordService] bot destroy after invalidation failed:", destroyErr),
                );
            this.host.changed();
            emit("on-connection-error", { error: message });
        });

        // transient client/shard errors: log and surface as a trigger, but do
        // NOT claim disconnected — the gateway session may still be live
        bot.on("error", (err) => {
            if (!ownsSession()) return;
            console.error("[DiscordService] client error:", err instanceof Error ? err.message : String(err));
            emit("on-connection-error", { error: String(err) });
        });
        bot.on("shardError", (err) => {
            if (!ownsSession()) return;
            console.error("[DiscordService] shard error:", err instanceof Error ? err.message : String(err));
            emit("on-connection-error", { error: String(err) });
        });

        // reconnect success: back online
        const markLive = () => {
            if (!ownsSession()) return;
            this.connectionStatus = { connected: true };
            this.host.changed();
        };
        bot.on("clientReady", () => {
            markLive();
            if (!ownsSession()) return;
            emit("on-bot-ready", { userId: bot.user?.id ?? "", username: bot.user?.username ?? "" });
        });
        bot.on("shardReady", markLive);
    }

    // ---------------------------------------------------------------------
    // slash commands
    // ---------------------------------------------------------------------

    private async syncAfterLogin(bot: Client): Promise<void> {
        try {
            const errors = await syncSlashCommands(bot, this.commands);
            // a newer session may own the state by now
            if (this.client !== bot) return;
            this.commandSyncError = errors.length > 0 ? errors.join(" ") : null;
            if (this.commandSyncError) {
                console.error("[DiscordService] command sync reported errors:", this.commandSyncError);
            }
        } catch (err) {
            if (this.client !== bot) return;
            this.commandSyncError = errorToMessage(err);
            console.error("[DiscordService] command sync failed:", err);
        }
    }

    // save-then-sync for UI mutations: offline is reported as "not
    // registered" rather than as an error, because the stored definition is
    // not a lie
    async syncAfterMutation(scopesToClear: string[] = []): Promise<{ registered: boolean; syncError: string | null }> {
        const bot = this.client;
        if (!bot || !this.connectionStatus.connected) {
            return { registered: false, syncError: null };
        }
        try {
            const errors = await syncSlashCommands(bot, this.commands, scopesToClear);
            this.commandSyncError = errors.length > 0 ? errors.join(" ") : null;
            if (this.commandSyncError) {
                console.error("[DiscordService] command sync reported errors:", this.commandSyncError);
            }
            return { registered: this.commandSyncError === null, syncError: this.commandSyncError };
        } catch (err) {
            this.commandSyncError = errorToMessage(err);
            console.error("[DiscordService] command sync failed:", err);
            return { registered: false, syncError: this.commandSyncError };
        }
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
