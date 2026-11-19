// One bot's live session: its discord.js client, connection truth, pending
// interactions, recent messages and slash-command sync. Every bot gets its
// own, so two bots share nothing but the code; the service owns the list
// and tells each session where its triggers go.
export type { BotWidgetStatus, RecentMessage } from "./contract";
import type { BotWidgetStatus, RecentMessage } from "./contract";
import type { Client, ChatInputCommandInteraction, RepliableInteraction } from "discord.js";
import { discord, discordApiBase, discordCdnBase, loadDiscord, tokenRest } from "./discord";
import {
    AUTO_ACK_DELAY_MS,
    awaitsReply,
    autoAcknowledge,
    componentClickPayload,
    modalSubmitPayload,
} from "./discordOps";
import { CommandActivityRecorder, CommandUseCounter } from "./commandActivity";
import { relayEvents, type On } from "./relay";
import { clearSlashCommands, syncSlashCommands } from "./commandSync";
import {
    appendCapped,
    RECENT_MESSAGE_CAP,
    INTERACTION_TTL_MS,
    PENDING_INTERACTION_CAP,
    commandTriggerId,
    findCommandForInteraction,
    type SlashCommandDefinition,
    type Health,
    type GuildSummary,
} from "./types";
import { errorMessage } from "@mileniumhq/paperapi";

// connection state is explicit, never inferred: a failed login nulls the
// client and records the typed error here (surfaced via getBotInfo and
// the bot's When the Connection Fails event), so the UI can never show "online"
// for a bot that isn't running. The same rule applies mid-session:
// gateway disconnects invalidate the status (see watchGateway), and a
// successful reconnect marks it live again via clientReady/shardReady.
interface ConnectionStatus {
    connected: boolean;
    error?: string;
}

/** Where a session's events go: the service maps them to the bot's project. */
interface SessionHost {
    /** fires one of this bot's triggers, by its id inside the bot's project */
    emit(trigger: string, output: unknown): void;
    /** a message the bot heard, for its Overview */
    heard(message: RecentMessage): void;
    /** the bot's identity, connection or servers changed; the service republishes it */
    changed(): void;
    /** something went wrong with no button waiting to say it (a sentence about the bot); the service tells the person */
    problem(text: string): void;
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

// what a close that ends the session means for the person running the bot;
// these are the codes discord.js gives up on instead of reconnecting
// (a close code only ever comes from a client, so discord.js is loaded here)
function gatewayCloseReason(code: number): string | undefined {
    const { GatewayCloseCodes } = discord();
    const reasons: Partial<Record<number, string>> = {
        [GatewayCloseCodes.AuthenticationFailed]: "the bot token was rejected",
        [GatewayCloseCodes.InvalidShard]: "the shard was invalid",
        [GatewayCloseCodes.ShardingRequired]: "the bot is in too many servers to run without sharding",
        [GatewayCloseCodes.InvalidAPIVersion]: "the gateway version is not supported",
        [GatewayCloseCodes.InvalidIntents]: "the requested intents are invalid",
        [GatewayCloseCodes.DisallowedIntents]: "the bot asked for a privileged intent that is not enabled in the Discord Developer Portal",
    };
    return reasons[code];
}

const gatewayErrorMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
        const obj = err as { code?: unknown; message?: unknown };
        if (obj.message) return String(obj.message);
        // discord.js 14 fills a close event's reason with a deprecation
        // notice, never what Discord sent: the code is the only truth
        if (typeof obj.code === "number") {
            const why = gatewayCloseReason(obj.code);
            return why ? `Discord closed the gateway (${obj.code}): ${why}` : `Discord closed the gateway (${obj.code})`;
        }
        if (obj.code !== undefined) return `Discord closed the gateway (${String(obj.code)})`;
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
     * needs a synchronous lookup.
     */
    commands: SlashCommandDefinition[] = [];
    /**
     * Slash commands run, per hour, for the Command activity widget. Fixed
     * size, outlives reconnects so a gateway blip does not wipe the day's chart.
     */
    readonly activity = new CommandActivityRecorder();
    /** Each slash command's uses and last use, for Blocks; outlives reconnects like the activity. */
    readonly commandUses = new CommandUseCounter();

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

    /** A failure that no button waits for: logged, and told to the person as the bot's problem. */
    noteProblem(text: string): void {
        console.error(`[DiscordService] ${this.id}: ${text}`);
        this.host.problem(text);
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
                this.noteProblem(
                    `An interaction no flow answered couldn't be acknowledged ${Date.now() - interaction.createdTimestamp} ms after Discord sent it, so Discord showed it as failed: ${errorMessage(err)}`,
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

    // the servers it is in, from the client cache (bounded: the cache is
    // already finite, this keeps the wire shape finite too)
    guildSummaries(): GuildSummary[] {
        const bot = this.client;
        if (!bot) return [];
        return [...bot.guilds.cache.values()].slice(0, 100).map((guild) => ({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL() ?? "",
            // none until Discord sends the server (it is listed unavailable at login)
            memberCount: guild.memberCount ?? 0,
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
            // a dropped gateway is not online, however long ago the session began
            uptimeMs: this.connected() && this.sessionStartedAt ? Math.max(0, Date.now() - this.sessionStartedAt) : 0,
            wsPing: bot?.ws?.ping ?? -1,
            wsStatus: bot?.ws?.status ?? -1,
            guildCount: bot?.guilds?.cache?.size ?? 0,
            cachedUsers: bot?.users?.cache?.size ?? 0,
            cachedChannels: bot?.channels?.cache?.size ?? 0,
            commandsReceived: this.commandsReceived,
            pendingInteractions: [...this.pending.values()].filter((entry) => awaitsReply(entry.interaction)).length,
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

    // Lets go of the client, leaving `error` as why it isn't running. Every
    // write happens before the destroy is awaited: a newer attempt may own
    // the session by the time it returns.
    private async release(error?: string): Promise<void> {
        const bot = this.client;
        this.client = null;
        this.loggingIn = false;
        // a stopped session has no answerable interactions, no uptime, no
        // sync state — anything else would let the health page describe a
        // bot that is not running
        this.clearPendingInteractions();
        this.sessionStartedAt = null;
        this.commandSyncError = null;
        // a stop drops the last error with the session it was about
        this.connectionStatus = error ? { connected: false, error } : { connected: false };
        this.host.changed();
        if (bot) await this.destroy(bot);
    }

    // a client that won't shut down may still hold its gateway open
    private async destroy(bot: Client): Promise<void> {
        try {
            await bot.destroy();
        } catch (err) {
            this.noteProblem(`Its connection to Discord didn't close cleanly: ${errorMessage(err)}`);
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
        // discord.js arrives with the first bot that starts; a service whose
        // bots are all off never loads it. Loaded for a test's own client
        // too, since everything a session does afterwards counts on it.
        const { Client, GatewayIntentBits } = await this.loadLibrary(attempt);
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
        const api = discordApiBase();
        const bot = clientFactory
            ? clientFactory()
            : new Client({
                ...(api ? { rest: { api, cdn: discordCdnBase() } } : {}),
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMessages,
                    GatewayIntentBits.MessageContent,
                    GatewayIntentBits.GuildMembers,
                    GatewayIntentBits.GuildMessageReactions,
                    // bans and unbans, and who is in voice: without them
                    // Discord never sends those events
                    GatewayIntentBits.GuildModeration,
                    GatewayIntentBits.GuildVoiceStates,
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
                await this.destroy(bot);
                return;
            }
            this.connectionStatus = { connected: true };
            this.sessionStartedAt = Date.now();
            this.host.changed();
            // command registration must not fail the login: a connected bot
            // whose commands are not on Discord yet is a sync problem,
            // recorded in health rather than reported as a connection failure
            await this.syncCommands();
        } catch (err) {
            const message = errorMessage(err);
            await this.destroy(bot);
            // a newer start or a stop let go of this client, which is why its
            // login failed: the session is theirs, and nothing failed that the
            // person asked for
            if (attempt !== this.connectSequence) {
                console.warn("[DiscordService] superseded connect attempt ended:", message);
                return;
            }
            console.error("[DiscordService] Login failed:", message);
            this.client = null;
            this.connectionStatus = { connected: false, error: message };
            this.host.changed();
            this.emit("on-connection-error", { error: message });
            throw new Error(`Discord login failed: ${message}`);
        }
    }

    // a library that will not load is a failed connection like any other:
    // the bot's status says so, and start() throws it
    private async loadLibrary(attempt: number): Promise<Awaited<ReturnType<typeof loadDiscord>>> {
        try {
            return await loadDiscord();
        } catch (err) {
            const message = `discord.js could not be loaded: ${errorMessage(err)}`;
            console.error("[DiscordService]", message);
            if (attempt === this.connectSequence) {
                this.connectionStatus = { connected: false, error: message };
                this.host.changed();
            }
            throw new Error(message);
        }
    }

    private emit(trigger: string, output: unknown): void {
        try {
            this.host.emit(trigger, output);
        } catch (err) {
            // a Blocks trigger lost must not stop the Discord event it came from
            this.noteProblem(`Its ${trigger} event didn't reach Blocks: ${errorMessage(err)}`);
        }
    }

    // Only the live session's events count: a superseded client's listeners
    // stay registered on it until its destroy completes, and what it hears
    // must not be reported as if it came from the bot the person runs now.
    private attachListeners(bot: Client): void {
        const on: On = (event, listener) => {
            bot.on(event, (...args) => {
                if (this.client === bot) listener(...args);
            });
        };
        relayEvents(on, {
            emit: (trigger, output) => this.emit(trigger, output),
            changed: () => this.host.changed(),
            heard: (message) => {
                this.recordRecentMessage(message);
                this.host.heard(message);
            },
            noteProblem: (text) => this.noteProblem(text),
        });
        this.routeInteractions(on);
        this.watchGateway(bot, on);
    }

    /** Buttons, menus, modals and slash commands, each to the event its flows listen on. */
    private routeInteractions(on: On): void {
        on("interactionCreate", (interaction) => {
            // button clicks and menu picks become the bot's component-used
            // Blocks event, which flows tell apart by component id
            if (interaction.isButton() || interaction.isAnySelectMenu()) {
                this.rememberInteraction(interaction);
                this.emit("interaction-triggered", componentClickPayload(interaction));
                return;
            }
            // submitted modals route by modal id the same way
            if (interaction.isModalSubmit()) {
                this.rememberInteraction(interaction);
                this.emit("modal-submitted", modalSubmitPayload(interaction));
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
                this.noteProblem(`Someone used /${interaction.commandName}, which isn't one of this bot's commands, so no flow ran.`);
                return;
            }

            this.commandUses.record(command);
            this.rememberInteraction(interaction);
            this.emit(commandTriggerId(command), {
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
    }

    /** The gateway's health mid-session, as the bot's connection status. */
    private watchGateway(bot: Client, on: On): void {
        // a drop marks the bot offline the way a failed login does, or the
        // page would show "online" for a bot that isn't running. discord.js
        // reconnects a dropped shard itself; shardReady/clientReady below
        // restore the connected flag when the gateway comes back
        on("shardDisconnect", (event) => {
            const message = gatewayErrorMessage(event);
            console.error("[DiscordService] gateway shardDisconnect:", message);
            this.connectionStatus = { connected: false, error: message };
            this.host.changed();
            this.emit("on-connection-error", { error: message });
        });
        // a resume replays what the dropped connection missed; interactions
        // in that replay are already past Discord's answer window
        on("shardResume", (_shardId, replayed) => {
            if (replayed > 0) console.warn(`[DiscordService] gateway resumed and replayed ${replayed} missed events`);
        });

        // fatal: the token was reset/revoked. The session ends the way a
        // stop ends it (nothing left to answer, no uptime), with the reason
        on("invalidated", () => {
            const message = "Session invalidated: token was reset or revoked";
            console.error(`[DiscordService] ${message}`);
            void this.release(message);
            this.emit("on-connection-error", { error: message });
        });

        // transient client/shard errors: a problem and a trigger, but
        // NOT disconnected — the gateway session may still be live
        const transient = (err: Error) => {
            const message = errorMessage(err);
            this.noteProblem(`Its connection to Discord had an error: ${message}`);
            this.emit("on-connection-error", { error: message });
        };
        on("error", transient);
        on("shardError", transient);

        // reconnect success: back online
        const markLive = () => {
            this.connectionStatus = { connected: true };
            this.host.changed();
        };
        on("clientReady", () => {
            markLive();
            this.emit("on-bot-ready", { userId: bot.user?.id ?? "", username: bot.user?.username ?? "" });
        });
        on("shardReady", markLive);
    }

    // ---------------------------------------------------------------------
    // slash commands
    // ---------------------------------------------------------------------

    /** Why the bot's commands aren't all on Discord, as of the last sync; null when they are. */
    syncError(): string | null {
        return this.commandSyncError;
    }

    // a sync's outcome is announced like the connection: the Commands tab
    // says a command made anywhere isn't live on Discord yet
    private noteSync(error: string | null): void {
        if (error) console.error("[DiscordService] command sync reported errors:", error);
        if (error === this.commandSyncError) return;
        this.commandSyncError = error;
        this.host.changed();
    }

    /**
     * Sets each of `scopes` (by default every scope with a stored command) to
     * no commands on Discord with the bot's token alone, over REST with no
     * gateway login, so a bot that is off is cleared too; throws what
     * Discord refused.
     */
    async clearCommands(token: string, scopes = [...new Set(this.commands.map((c) => c.scope))]): Promise<void> {
        if (scopes.length === 0) return;
        // A live client's REST queues each route's requests in order, so a
        // sync still on its way lands before the clear. A bot that is off
        // gets one for these requests alone.
        const rest = this.client?.rest ?? (await tokenRest(token));
        const errors = await clearSlashCommands(rest, token, scopes, (scope) => this.client?.guilds.cache.get(scope)?.name ?? scope);
        if (errors.length > 0) throw new Error(errors.join(" "));
    }

    /**
     * Sets Discord to the stored commands, after login and after every
     * change. The client's REST sends each route's requests one at a time in
     * the order they were made, so a later sync lands after an earlier one. Offline is "not registered"
     * rather than an error, because the stored definition is not a lie.
     */
    async syncCommands(scopesToClear: string[] = []): Promise<{ registered: boolean; syncError: string | null }> {
        const bot = this.client;
        if (!bot || !this.connectionStatus.connected) return { registered: false, syncError: null };
        let error: string | null;
        try {
            const errors = await syncSlashCommands(bot, this.commands, scopesToClear);
            error = errors.length > 0 ? errors.join(" ") : null;
        } catch (err) {
            error = errorMessage(err);
        }
        // a newer session may own the state by now
        if (this.client === bot) this.noteSync(error);
        return { registered: error === null, syncError: error };
    }
}
