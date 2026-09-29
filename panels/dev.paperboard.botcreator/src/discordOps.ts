// One implementation for every "reach a channel, then operate on a message"
// and "answer a pending interaction" operation. The flow actions in
// service.ts stay thin: they parse inputs and call these classes — channel
// resolution, embed/component payload building, and the Discord
// not-text-based errors live here once, not per action.
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    MessageFlags,
    type ButtonInteraction,
    type ColorResolvable,
    type RepliableInteraction,
    type Guild,
    type GuildMember,
} from "discord.js";
import { errorToMessage } from "./types";

// ─── embeds ─────────────────────────────────────────────────────────────────

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

export function normalizeEmbeds(input: unknown): DiscordEmbedData[] {
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

// ─── button components ──────────────────────────────────────────────────────

// The payload the flow passes around is a plain object (the custom id the
// author chose travels inside it); send time turns it into a Discord button.
export interface DiscordComponentData {
    label?: string;
    style?: string;
    customId?: string;
    url?: string;
    emoji?: string;
    disabled?: boolean;
}

export const BUTTON_STYLES = [
    "primary",
    "secondary",
    "success",
    "danger",
    "link",
] as const;

export function buildButtonComponent(
    inputs: DiscordComponentData,
): DiscordComponentData {
    const style = (inputs.style || "primary").toLowerCase();
    if (!(BUTTON_STYLES as readonly string[]).includes(style)) {
        throw new Error(
            `Unknown button style "${inputs.style}"; use one of: ${BUTTON_STYLES.join(", ")}`,
        );
    }
    const label = (inputs.label || "").trim();
    if (!label || label.length > 80) {
        throw new Error("A button needs a label of up to 80 characters");
    }
    if (style === "link") {
        if (!inputs.url || !inputs.url.trim()) {
            throw new Error(
                `The link button "${label}" needs a URL instead of an interaction id`,
            );
        }
        return { ...inputs, label, style };
    }
    const customId = (inputs.customId || "").trim();
    if (!customId) {
        throw new Error(
            `The "${style}" button "${label}" needs an Interaction ID so flows can react to its clicks`,
        );
    }
    if (customId.length > 100) {
        throw new Error(
            `The interaction id "${customId}" exceeds Discord's 100-character limit`,
        );
    }
    return { ...inputs, label, style, customId };
}

// One hardcoded action row for v1: Discord caps a row at five buttons, so
// beyond that the send fails loudly instead of silently splitting rows.
export function normalizeComponents(input: unknown): DiscordComponentData[] {
    const raw = Array.isArray(input) ? input : input ? [input] : [];
    const components: DiscordComponentData[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") {
            throw new Error(
                "Components must be values created by the Create Button action",
            );
        }
        components.push(item as DiscordComponentData);
    }
    if (components.length > 5) {
        throw new Error(
            `A message holds at most 5 buttons in one row (got ${components.length})`,
        );
    }
    return components;
}

export function componentsToActionRow(components: DiscordComponentData[]) {
    if (components.length === 0) return null;
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const component of components) {
        const button = new ButtonBuilder().setLabel(component.label ?? "");
        if (component.disabled) button.setDisabled(true);
        if (component.emoji) {
            try {
                button.setEmoji(component.emoji);
            } catch (err) {
                throw new Error(
                    `Emoji "${component.emoji}" could not be used on button "${component.label}"`,
                );
            }
        }
        if (component.style === "link") {
            button.setStyle(ButtonStyle.Link).setURL(component.url ?? "");
        } else {
            const styleMap: Record<string, ButtonStyle> = {
                primary: ButtonStyle.Primary,
                secondary: ButtonStyle.Secondary,
                success: ButtonStyle.Success,
                danger: ButtonStyle.Danger,
            };
            button
                .setStyle(styleMap[component.style || "primary"])
                .setCustomId(component.customId ?? "");
        }
        row.addComponents(button);
    }
    return row;
}

// The one message-payload builder: send, reply, respond, and follow-up all
// route through here so content/embeds/components are normalized once.
export interface MessagePayloadInput {
    content?: string;
    embeds?: unknown;
    components?: unknown;
}

export function buildMessagePayload(input: MessagePayloadInput) {
    const row = componentsToActionRow(normalizeComponents(input.components));
    return {
        content: input.content ?? "",
        embeds: normalizeEmbeds(input.embeds).map((data) => buildDiscordEmbed(data)),
        ...(row ? { components: [row] } : {}),
    };
}

export interface ComponentClickData {
    customId: string;
    interactionId: string;
    userId: string;
    username: string;
    channelId: string;
    guildId: string;
    messageId: string;
}

export function componentClickPayload(
    interaction: ButtonInteraction,
): ComponentClickData {
    return {
        customId: interaction.customId,
        interactionId: interaction.id,
        userId: interaction.user.id,
        username: interaction.user.username,
        channelId: interaction.channelId ?? "",
        guildId: interaction.guildId ?? "",
        messageId: interaction.message.id,
    };
}

// ─── servers and members ────────────────────────────────────────────────────

// Small bots usually serve one server; member actions then need no explicit
// Server ID. With several servers the id is required — never guess.
export async function resolveGuild(
    bot: Client,
    guildId?: string,
): Promise<Guild> {
    if (guildId && guildId.trim()) {
        return bot.guilds.fetch(guildId.trim());
    }
    const guilds = [...bot.guilds.cache.values()];
    if (guilds.length === 1) return guilds[0];
    throw new Error(
        "This bot is in more than one server; provide the Server ID",
    );
}

// Server-resolved member fetch: with a Server ID it is one call; without,
// the bot's servers are searched in a bounded loop (guild count).
export async function resolveMember(
    bot: Client,
    userId: string,
    guildId?: string,
): Promise<GuildMember> {
    if (guildId && guildId.trim()) {
        const guild = await resolveGuild(bot, guildId);
        return guild.members.fetch(userId.trim());
    }
    for (const guild of bot.guilds.cache.values()) {
        try {
            return await guild.members.fetch(userId.trim());
        } catch {
            // not a member of this server: bounded search continues
            continue;
        }
    }
    throw new Error(
        `User ${userId} is not a member of any server this bot is in`,
    );
}

// ─── message operations ─────────────────────────────────────────────────────

/**
 * The shared input vocabulary for flow blocks. Every action that writes a
 * Discord message (send, DM, respond, follow-up, edit) names the same body
 * fields through these specs — Content, Embeds, Components are defined once
 * — and every placeholder is a descriptor, never an example value.
 */
export const INPUTS = {
    channel: {
        type: "discord-channel",
        label: "Channel",
        placeholder: "Channel",
        typeName: "Channel",
        required: true,
    },
    message: {
        type: "discord-message",
        label: "Message",
        placeholder: "Message",
        typeName: "Message",
        required: true,
    },
    user: {
        type: "discord-user",
        label: "User",
        placeholder: "User",
        typeName: "User",
        required: true,
    },
    role: {
        type: "discord-role",
        label: "Role",
        placeholder: "Role",
        typeName: "Role",
        required: true,
    },
    interaction: {
        type: "discord-interaction",
        label: "Interaction",
        placeholder: "Interaction",
        typeName: "Interaction",
        required: true,
    },
    guildId: { type: "string", label: "Server ID", placeholder: "Server ID" },
    content: { type: "string", label: "Content", placeholder: "Content" },
    embeds: {
        type: "list<discord-embed>",
        label: "Embeds",
        placeholder: "Embed",
        typeName: "Embed",
    },
    components: {
        type: "list<discord-component>",
        label: "Components",
        placeholder: "Button",
        typeName: "Component",
    },
    ephemeral: { type: "boolean", label: "Only visible to the user", default: false },
    emoji: { type: "string", label: "Emoji", placeholder: "Emoji", required: true },
    reason: { type: "string", label: "Reason", placeholder: "Reason" },
    name: { type: "string", label: "Name", placeholder: "Name", required: true },
    color: { type: "color", label: "Color", placeholder: "Color" },
    count: { type: "number", label: "Count", placeholder: "Count" },
    minutes: { type: "number", label: "Minutes", placeholder: "Duration" },
    maxUses: { type: "number", label: "Max uses", placeholder: "Uses" },
    topic: { type: "string", label: "Topic", placeholder: "Topic" },
    slowmode: { type: "number", label: "Slowmode seconds", placeholder: "Seconds" },
    kind: {
        type: "string",
        label: "Kind",
        placeholder: "Channel kind",
        default: "text",
        options: [
            { label: "Text", value: "text" },
            { label: "Voice", value: "voice" },
            { label: "Announcement", value: "announcement" },
            { label: "Category", value: "category" },
        ],
    },
    deleteDays: {
        type: "number",
        label: "Delete message days",
        placeholder: "Days",
    },
};

// Every message action routes through this class instead of re-fetching the
// channel and message inline: one place owns the typed "not text-based"
// errors and the fetch order.
export class MessageOps {
    constructor(private readonly bot: Client) {}

    private async textChannel(channelId: string): Promise<any> {
        const channel = await this.bot.channels.fetch(channelId.trim());
        if (!channel || !("messages" in channel)) {
            throw new Error(`Channel ${channelId} not found or not text-based`);
        }
        return channel;
    }

    private async message(channelId: string, messageId: string): Promise<any> {
        const channel = await this.textChannel(channelId);
        return channel.messages.fetch(messageId.trim());
    }

    async send(channelId: string, payload: MessagePayloadInput): Promise<string> {
        const channel = await this.textChannel(channelId);
        const sent = await channel.send(buildMessagePayload(payload));
        return sent.id;
    }

    async reply(
        channelId: string,
        replyTo: string,
        payload: MessagePayloadInput,
    ): Promise<string> {
        const channel = await this.textChannel(channelId);
        const target = await channel.messages.fetch(replyTo.trim());
        const sent = await target.reply(buildMessagePayload(payload));
        return sent.id;
    }

    async edit(
        channelId: string,
        messageId: string,
        payload: MessagePayloadInput,
    ): Promise<string> {
        if (
            payload.content === undefined &&
            payload.embeds === undefined &&
            payload.components === undefined
        ) {
            throw new Error("Edit Message needs new content, embeds, or components");
        }
        const message = await this.message(channelId, messageId);
        const embeds = normalizeEmbeds(payload.embeds);
        const components = payload.components === undefined
            ? message.components
            : componentsToActionRow(normalizeComponents(payload.components));
        await message.edit({
            content: payload.content ?? message.content,
            embeds: embeds.length > 0 ? embeds.map((data) => buildDiscordEmbed(data)) : message.embeds,
            ...(components ? { components: [components] } : {}),
        });
        return message.id;
    }

    async dm(userId: string, payload: MessagePayloadInput): Promise<string> {
        const user = await this.bot.users.fetch(userId.trim());
        const sent = await user.send(buildMessagePayload(payload));
        return sent.id;
    }

    async delete(channelId: string, messageId: string): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        await message.delete();
        return true;
    }

    async pin(channelId: string, messageId: string): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        await message.pin();
        return true;
    }

    async unpin(channelId: string, messageId: string): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        await message.unpin();
        return true;
    }

    async crosspost(channelId: string, messageId: string): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        await message.crosspost();
        return true;
    }

    async bulkDelete(channelId: string, count?: number): Promise<number> {
        const channel = await this.textChannel(channelId);
        if (!("bulkDelete" in channel)) {
            throw new Error(`Channel ${channelId} cannot bulk-delete messages`);
        }
        const capped = Math.max(1, Math.min(100, Math.floor(Number(count ?? 10))));
        const deleted = await channel.bulkDelete(capped);
        return deleted.size;
    }

    async react(
        channelId: string,
        messageId: string,
        emoji: string,
    ): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        await message.react(emoji);
        return true;
    }

    async removeReaction(
        channelId: string,
        messageId: string,
        emoji: string,
        user?: string,
    ): Promise<boolean> {
        const message = await this.message(channelId, messageId);
        const reaction =
            message.reactions.cache.get(emoji) ?? message.reactions.resolve(emoji);
        if (!reaction) {
            throw new Error(`Reaction ${emoji} not found on that message`);
        }
        if (user && user.trim()) {
            await reaction.users.remove(user.trim());
        } else {
            await reaction.remove();
        }
        return true;
    }

    async startThread(
        channelId: string,
        messageId: string,
        name: string,
    ): Promise<string> {
        const message = await this.message(channelId, messageId);
        const thread = await message.startThread({ name: name.trim() });
        return thread.id;
    }

    async fetchChannel(channelId: string): Promise<any> {
        const channel = await this.bot.channels.fetch(channelId.trim());
        if (!channel) {
            throw new Error(`Channel ${channelId} not found`);
        }
        return channel;
    }
}

// ─── interaction responses ──────────────────────────────────────────────────

// One class owns answering pending interactions: the reply-vs-editReply
// decision, ephemeral flags, and the pending-map lookup live here, not in
// every responder action.
export class InteractionOps {
    constructor(
        private readonly take: (interactionId: string) => RepliableInteraction,
    ) {}

    async respond(
        interactionId: string,
        payload: { content?: string; embeds?: unknown; components?: unknown; ephemeral?: boolean },
    ): Promise<string> {
        const interaction = this.take(interactionId.trim());
        const body = buildMessagePayload({
            content: payload.content,
            embeds: payload.embeds,
            components: payload.components,
        });
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(body);
        } else {
            await interaction.reply({
                ...body,
                flags: payload.ephemeral ? MessageFlags.Ephemeral : undefined,
            });
        }
        return interaction.id;
    }

    async defer(interactionId: string, ephemeral?: boolean): Promise<boolean> {
        const interaction = this.take(interactionId.trim());
        await interaction.deferReply({
            flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return true;
    }

    async followUp(
        interactionId: string,
        payload: { content?: string; embeds?: unknown; components?: unknown; ephemeral?: boolean },
    ): Promise<string> {
        const interaction = this.take(interactionId.trim());
        const body = buildMessagePayload({
            content: payload.content,
            embeds: payload.embeds,
            components: payload.components,
        });
        const sent = await interaction.followUp({
            ...body,
            flags: payload.ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return sent.id;
    }
}
