import {
    Client,
    GatewayIntentBits,
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
    actionsApi,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import { extractApplicationIdFromToken } from "./types";

// pass PANEL_ID explicitly, ambient scope resolves to last-imported panel
const PANEL_ID = "dev.paperboard.botcreator";

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
        } catch {}
    }
    if (data.url) {
        try {
            embed.setURL(data.url);
        } catch {}
    }
    if (data.footer) embed.setFooter({ text: data.footer });
    if (data.image) {
        try {
            embed.setImage(data.image);
        } catch {}
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
        } catch {
            return [];
        }
    }
    return [];
}

let client: Client | null = null;
let savedAppId = "";

function getClient(): Client {
    if (!client) {
        throw new Error("Discord bot is not currently connected.");
    }
    return client;
}

function generateInvite(permissions: string[]): string {
    const bitfield = new PermissionsBitField();
    for (const p of permissions) {
        if (p in PermissionsBitField.Flags) {
            bitfield.add(
                PermissionsBitField.Flags[
                    p as keyof typeof PermissionsBitField.Flags
                ],
            );
        }
    }
    const appId = client?.user?.id || savedAppId;
    return `https://discord.com/api/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=${bitfield.bitfield.toString()}`;
}

async function stopBot() {
    if (client) {
        try {
            await client.destroy();
        } catch {}
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

        ctx.emitTrigger("on-message", payload);
        ctx.emitTrigger("on-message-keyword", payload);
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
}

async function startBot(token: string, ctx?: ServiceContext<any>) {
    if (!token) return;
    await stopBot();

    // privileged intents, without them content arrives empty
    const bot = new Client({
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

    if (ctx) {
        attachListeners(bot, ctx);
    }

    try {
        await bot.login(token);
    } catch (err: any) {
        console.error("[DiscordService] Login failed:", err.message);
    }
}

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
            bot.user?.setPresence({
                activities: [
                    { name: inputs.activity, type: ActivityType.Custom },
                ],
                status: (inputs.status as any) || "online",
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
        id: "on-message-keyword",
        name: "When message contains keyword",
        description: "Fires when a message contains a specific keyword",
        template: "When a message contains keyword",
        output: {
            type: "object",
            label: "Message Data",
        },
        icon: "search",
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
                () => ({
                    name: client?.user?.username || "Discord Bot",
                    avatar: client?.user?.displayAvatarURL() || "",
                    tag: client?.user?.tag || "",
                    guildCount: client?.guilds?.cache?.size || 0,
                    applicationId: client?.user?.id || savedAppId,
                }),
                "dev.paperboard.botcreator",
            )
            .catch(() => {});

        actionsApi
            .register(
                "get-invite-url",
                (perms: string[]) => generateInvite(perms || []),
                "dev.paperboard.botcreator",
            )
            .catch(() => {});

        actionsApi
            .register(
                "connect-bot",
                async (token: string) => {
                    savedAppId = extractApplicationIdFromToken(token) || "";
                    await startBot(token, ctx);
                    return true;
                },
                "dev.paperboard.botcreator",
            )
            .catch(() => {});

        actionsApi
            .register(
                "disconnect-bot",
                async () => {
                    await stopBot();
                    return true;
                },
                "dev.paperboard.botcreator",
            )
            .catch(() => {});

        try {
            const saved = await config.get<any>(PANEL_ID);
            if (saved?.configured && saved?.token) {
                savedAppId =
                    saved.applicationId ||
                    extractApplicationIdFromToken(saved.token) ||
                    "";
                await startBot(saved.token, ctx);
            }
        } catch (err) {
            console.error("[DiscordService] Init error:", err);
        }
    },
});

export default botService;
