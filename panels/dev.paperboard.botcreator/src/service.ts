import {
    Client,
    GatewayIntentBits,
    ChannelType,
    EmbedBuilder,
    PermissionsBitField,
    ActivityType,
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
import { extractApplicationIdFromToken, appendCapped, RECENT_MESSAGE_CAP } from "./types";

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
    urlType,
    colorType,
];

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

function generateInvite(permissions: string[]): string {
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
    const appId = client?.user?.id || savedAppId;
    // scope=bot only: this bot has no slash commands yet, and an invite URL
    // that requests applications.commands promises a feature the panel does
    // not ship. The scope comes back when the commands do.
    return `https://discord.com/api/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${bitfield.bitfield.toString()}`;
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
}

function attachListeners(bot: Client, ctx: ServiceContext<any>) {
    bot.on("messageCreate", (msg) => {
        if (msg.author.bot) return;

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
        ctx.emitTrigger("on-member-join", {
            username: member.user.username,
            userId: member.user.id,
            guildId: member.guild.id,
            guildName: member.guild.name,
        });
    });

    bot.on("guildMemberRemove", (member) => {
        ctx.emitTrigger("on-member-leave", {
            username: member.user.username,
            userId: member.user.id,
            guildId: member.guild.id,
        });
    });

    bot.on("messageReactionAdd", (reaction, user) => {
        if (user.bot) return;
        ctx.emitTrigger("on-reaction-add", {
            emoji: reaction.emoji.name || reaction.emoji.id,
            userId: user.id,
            username: user.username,
            messageId: reaction.message.id,
            channelId: reaction.message.channelId,
        });
    });

    // gateway truth mid-session: a drop must invalidate connectionStatus
    // the same way a failed login does — otherwise the UI shows "online"
    // for a bot that is not running. A successful reconnect flips it back.
    const ownsSession = () => client === bot;

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

const actions = [
    defineAction({
        id: "get-channel",
        name: "Get Channel",
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
];

const triggers = [
    defineTrigger({
        id: "on-message",
        name: "When a message is received",
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
        description: "Fires with the typed login error when the bot fails to connect",
        template: "When the bot fails to connect",
        output: {
            type: "object",
            label: "Error Data",
        },
        icon: "error",
    }),
];

export const botService = definePanelService({
    id: "dev.paperboard.botcreator",
    actions,
    triggers,
    types: customTypes,
    async onInit(ctx: ServiceContext<any>) {
        actionsApi
            .register(
                "get-bot-info",
                () => buildBotInfo(),
                "dev.paperboard.botcreator",
            )
            .catch((err) => console.error("[DiscordService] action registration failed:", err));

        actionsApi
            .register(
                "get-invite-url",
                (perms: string[]) => generateInvite(perms || []),
                "dev.paperboard.botcreator",
            )
            .catch((err) => console.error("[DiscordService] action registration failed:", err));

        actionsApi
            .register(
                "connect-bot",
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
                "dev.paperboard.botcreator",
            )
            .catch((err) => console.error("[DiscordService] action registration failed:", err));

        actionsApi
            .register(
                "disconnect-bot",
                async () => {
                    await stopBot();
                    return true;
                },
                "dev.paperboard.botcreator",
            )
            .catch((err) => console.error("[DiscordService] action registration failed:", err));

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
