// One implementation for every "reach a channel, then operate on a message"
// and "answer a pending interaction" operation. The flow actions in
// service.ts stay thin: they parse inputs and call these classes — channel
// resolution, embed/component payload building, and the Discord
// not-text-based errors live here once, not per action.
import {
    ButtonBuilder,
    ButtonStyle,
    Client,
    ComponentType,
    EmbedBuilder,
    MessageFlags,
    TextInputStyle,
    type MessageComponentInteraction,
    type ModalSubmitInteraction,
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

// ─── message components ─────────────────────────────────────────────────────

// The payloads the flow passes around are plain objects tagged by kind (the
// custom id the author chose travels inside them); send time lays them out
// into Discord action rows. A message holds at most five rows; a row holds
// up to five buttons or exactly one select menu.
export interface DiscordButtonData {
    kind?: "button";
    label?: string;
    style?: string;
    customId?: string;
    url?: string;
    emoji?: string;
    disabled?: boolean;
}

export const SELECT_MENU_KINDS = ["text", "user", "role", "channel"] as const;
export type SelectMenuKind = (typeof SELECT_MENU_KINDS)[number];

export interface DiscordSelectMenuData {
    kind: "select";
    menu: SelectMenuKind;
    customId: string;
    placeholder?: string;
    options?: string[];
    minValues?: number;
    maxValues?: number;
    disabled?: boolean;
}

export interface DiscordComponentRowData {
    kind: "row";
    components: (DiscordButtonData | DiscordSelectMenuData)[];
}

export type DiscordComponentData =
    | DiscordButtonData
    | DiscordSelectMenuData
    | DiscordComponentRowData;

export const MAX_COMPONENT_ROWS = 5;
export const MAX_BUTTONS_PER_ROW = 5;
export const MAX_SELECT_OPTIONS = 25;

export const BUTTON_STYLES = [
    "primary",
    "secondary",
    "success",
    "danger",
    "link",
] as const;

// Discord's per-value limits (lengths, counts, item caps) are declared on
// the actions' inputs and refused by the SDK before these builders run, and
// shown on the block before the flow does; the builders check what a single
// input can't say: presence, kinds, and how inputs relate.
function checkCustomId(customId: string, what: string): string {
    const trimmed = customId.trim();
    if (!trimmed) {
        throw new Error(`${what} needs an Interaction ID so flows can react to it`);
    }
    return trimmed;
}

export function buildButtonComponent(
    inputs: DiscordButtonData,
): DiscordButtonData {
    const style = (inputs.style || "primary").toLowerCase();
    if (!(BUTTON_STYLES as readonly string[]).includes(style)) {
        throw new Error(
            `Unknown button style "${inputs.style}"; use one of: ${BUTTON_STYLES.join(", ")}`,
        );
    }
    const label = (inputs.label || "").trim();
    if (!label) {
        throw new Error("A button needs a label");
    }
    if (style === "link") {
        if (!inputs.url || !inputs.url.trim()) {
            throw new Error(
                `The link button "${label}" needs a URL instead of an interaction id`,
            );
        }
        return { ...inputs, kind: "button", label, style };
    }
    const customId = checkCustomId(
        inputs.customId || "",
        `The "${style}" button "${label}"`,
    );
    return { ...inputs, kind: "button", label, style, customId };
}

// Text options arrive as a list (the Options field is edited item by item;
// a lone text value is one option); each option's label is also its value.
export function parseSelectOptions(input: unknown): string[] {
    const raw = Array.isArray(input)
        ? input.map((item) => String(item ?? ""))
        : typeof input === "string"
            ? [input]
            : [];
    return raw.map((option) => option.trim()).filter(Boolean);
}

function optionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    return Number(value);
}

export function buildSelectMenuComponent(inputs: {
    menu?: string;
    customId?: string;
    placeholder?: string;
    options?: unknown;
    minValues?: unknown;
    maxValues?: unknown;
    disabled?: boolean;
}): DiscordSelectMenuData {
    const menu = (inputs.menu || "text").toLowerCase();
    if (!(SELECT_MENU_KINDS as readonly string[]).includes(menu)) {
        throw new Error(
            `Unknown menu kind "${inputs.menu}"; use one of: ${SELECT_MENU_KINDS.join(", ")}`,
        );
    }
    const customId = checkCustomId(inputs.customId || "", "A select menu");
    const placeholder = (inputs.placeholder || "").trim();
    const minValues = optionalNumber(inputs.minValues);
    const maxValues = optionalNumber(inputs.maxValues);
    if (minValues !== undefined && maxValues !== undefined && minValues > maxValues) {
        throw new Error("Minimum picks cannot be more than maximum picks");
    }
    const data: DiscordSelectMenuData = {
        kind: "select",
        menu: menu as SelectMenuKind,
        customId,
        ...(placeholder ? { placeholder } : {}),
        ...(minValues !== undefined ? { minValues } : {}),
        ...(maxValues !== undefined ? { maxValues } : {}),
        ...(inputs.disabled ? { disabled: true } : {}),
    };
    if (menu !== "text") return data;

    const options = parseSelectOptions(inputs.options);
    if (options.length === 0) {
        throw new Error("A text select menu needs at least one option");
    }
    if (new Set(options).size !== options.length) {
        throw new Error("Select menu options must be unique");
    }
    if (maxValues !== undefined && maxValues > options.length) {
        throw new Error(
            `Maximum picks (${maxValues}) is more than the ${options.length} options`,
        );
    }
    return { ...data, options };
}

function componentItem(item: unknown): DiscordComponentData {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(
            "Components must be values created by the Create Button, Create Select Menu, or Create Interaction Row actions",
        );
    }
    return item as DiscordComponentData;
}

function isRow(item: DiscordComponentData): item is DiscordComponentRowData {
    return item.kind === "row";
}

function isSelect(item: DiscordComponentData): item is DiscordSelectMenuData {
    return item.kind === "select";
}

/**
 * The Interaction Row block: an explicit row the author arranged. It holds
 * one to five buttons or exactly one select menu, never another row.
 */
export function buildComponentRow(input: unknown): DiscordComponentRowData {
    const raw = Array.isArray(input) ? input : input ? [input] : [];
    const components = raw.map(componentItem);
    if (components.some(isRow)) {
        throw new Error("An Interaction Row cannot contain another Interaction Row");
    }
    const items = components as (DiscordButtonData | DiscordSelectMenuData)[];
    if (items.length === 0) {
        throw new Error("An Interaction Row needs at least one button or select menu");
    }
    const selects = items.filter(isSelect).length;
    if (selects > 0 && items.length > 1) {
        throw new Error(
            "A select menu fills its whole row; put buttons in a separate Interaction Row",
        );
    }
    if (items.length > MAX_BUTTONS_PER_ROW) {
        throw new Error(
            `An Interaction Row holds at most ${MAX_BUTTONS_PER_ROW} buttons (got ${items.length})`,
        );
    }
    return { kind: "row", components: items };
}

/**
 * Lays the Components field out into rows, in order: an Interaction Row
 * stays one row; loose buttons share a row until it holds five or a row or
 * select menu interrupts them; a loose select menu takes a row of its own.
 * Result: (button | select)[][] — one inner array per Discord action row.
 */
export function layoutComponentRows(
    input: unknown,
): (DiscordButtonData | DiscordSelectMenuData)[][] {
    const raw = Array.isArray(input) ? input : input ? [input] : [];
    const rows: (DiscordButtonData | DiscordSelectMenuData)[][] = [];
    let loose: DiscordButtonData[] = [];
    const flush = () => {
        if (loose.length > 0) rows.push(loose);
        loose = [];
    };
    for (const entry of raw) {
        const item = componentItem(entry);
        if (isRow(item)) {
            flush();
            // re-check: a row value may come from anywhere a variable can
            rows.push(buildComponentRow(item.components).components);
        } else if (isSelect(item)) {
            flush();
            rows.push([item]);
        } else {
            if (loose.length === MAX_BUTTONS_PER_ROW) flush();
            loose.push(item);
        }
    }
    flush();
    if (rows.length > MAX_COMPONENT_ROWS) {
        throw new Error(
            `A message holds at most ${MAX_COMPONENT_ROWS} rows of components (this one needs ${rows.length})`,
        );
    }
    const seen = new Set<string>();
    for (const row of rows) {
        for (const component of row) {
            const id = component.customId?.trim();
            if (!id || (component.kind !== "select" && component.style === "link")) continue;
            if (seen.has(id)) {
                throw new Error(
                    `Two components in one message share the Interaction ID "${id}"; Discord needs each to be unique`,
                );
            }
            seen.add(id);
        }
    }
    return rows;
}

function buttonToApi(component: DiscordButtonData) {
    const button = new ButtonBuilder().setLabel(component.label ?? "");
    if (component.disabled) button.setDisabled(true);
    if (component.emoji) {
        try {
            button.setEmoji(component.emoji);
        } catch (err) {
            throw new Error(
                `Emoji "${component.emoji}" could not be used on button "${component.label}": ${errorToMessage(err)}`,
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
    return button.toJSON();
}

function selectToApi(component: DiscordSelectMenuData) {
    const base = {
        custom_id: component.customId,
        ...(component.placeholder ? { placeholder: component.placeholder } : {}),
        ...(component.minValues !== undefined ? { min_values: component.minValues } : {}),
        ...(component.maxValues !== undefined ? { max_values: component.maxValues } : {}),
        ...(component.disabled ? { disabled: true } : {}),
    };
    switch (component.menu) {
        case "user":
            return { ...base, type: ComponentType.UserSelect };
        case "role":
            return { ...base, type: ComponentType.RoleSelect };
        case "channel":
            return { ...base, type: ComponentType.ChannelSelect };
        default:
            return {
                ...base,
                type: ComponentType.StringSelect,
                options: (component.options ?? []).map((option) => ({
                    label: option,
                    value: option,
                })),
            };
    }
}

/** Discord API action rows for the Components field, or none when empty. */
export function componentsToActionRows(input: unknown) {
    return layoutComponentRows(input).map((row) => ({
        type: ComponentType.ActionRow,
        components: row.map((component) =>
            isSelect(component) ? selectToApi(component) : buttonToApi(component),
        ),
    }));
}

// The one message-payload builder: send, reply, respond, and follow-up all
// route through here so content/embeds/components are normalized once.
export interface MessagePayloadInput {
    content?: string;
    embeds?: unknown;
    components?: unknown;
}

export function buildMessagePayload(input: MessagePayloadInput) {
    const rows = componentsToActionRows(input.components);
    return {
        content: input.content ?? "",
        embeds: normalizeEmbeds(input.embeds).map((data) => buildDiscordEmbed(data)),
        ...(rows.length > 0 ? { components: rows } : {}),
    };
}

// ─── modals ─────────────────────────────────────────────────────────────────

export const MAX_MODAL_FIELDS = 5;

export interface DiscordModalFieldData {
    kind: "text-field";
    label: string;
    style: "short" | "paragraph";
    placeholder?: string;
    required: boolean;
    value?: string;
    minLength?: number;
    maxLength?: number;
}

export function buildModalField(inputs: {
    label?: string;
    style?: string;
    placeholder?: string;
    required?: boolean;
    value?: string;
    minLength?: unknown;
    maxLength?: unknown;
}): DiscordModalFieldData {
    const label = (inputs.label || "").trim();
    if (!label) {
        throw new Error("A text field needs a label");
    }
    const style = (inputs.style || "short").toLowerCase();
    if (style !== "short" && style !== "paragraph") {
        throw new Error(`Unknown text field style "${inputs.style}"; use short or paragraph`);
    }
    const placeholder = (inputs.placeholder || "").trim();
    const minLength = optionalNumber(inputs.minLength);
    const maxLength = optionalNumber(inputs.maxLength);
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
        throw new Error("Minimum length cannot be more than maximum length");
    }
    return {
        kind: "text-field",
        label,
        style,
        required: inputs.required !== false,
        ...(placeholder ? { placeholder } : {}),
        ...(inputs.value ? { value: inputs.value } : {}),
        ...(minLength !== undefined ? { minLength } : {}),
        ...(maxLength !== undefined ? { maxLength } : {}),
    };
}

/** A field's answer arrives under this id: Field 1 is "field1", and so on. */
export function modalFieldId(index: number): string {
    return `field${index + 1}`;
}

export function buildModalPayload(input: {
    modalId?: string;
    title?: string;
    fields?: unknown;
}) {
    const customId = checkCustomId(input.modalId || "", "A modal");
    const title = (input.title || "").trim();
    if (!title) {
        throw new Error("A modal needs a title");
    }
    const raw = Array.isArray(input.fields) ? input.fields : input.fields ? [input.fields] : [];
    if (raw.length === 0) {
        throw new Error("A modal needs at least one text field");
    }
    const fields = raw.map((item) => {
        if (!item || typeof item !== "object" || (item as { kind?: unknown }).kind !== "text-field") {
            throw new Error("Modal fields must be values created by the Create Text Field action");
        }
        return item as DiscordModalFieldData;
    });
    return {
        custom_id: customId,
        title,
        components: fields.map((field, index) => ({
            type: ComponentType.ActionRow,
            components: [
                {
                    type: ComponentType.TextInput,
                    custom_id: modalFieldId(index),
                    label: field.label,
                    style:
                        field.style === "paragraph"
                            ? TextInputStyle.Paragraph
                            : TextInputStyle.Short,
                    required: field.required,
                    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
                    ...(field.value ? { value: field.value } : {}),
                    ...(field.minLength !== undefined ? { min_length: field.minLength } : {}),
                    ...(field.maxLength !== undefined ? { max_length: field.maxLength } : {}),
                },
            ],
        })),
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
    /** what a select menu's user picked; empty for a button click */
    values: string[];
    /** the first pick, for single-choice menus; empty for a button click */
    value: string;
}

export function componentClickPayload(
    interaction: MessageComponentInteraction,
): ComponentClickData {
    const values = interaction.isAnySelectMenu() ? [...interaction.values] : [];
    return {
        customId: interaction.customId,
        interactionId: interaction.id,
        userId: interaction.user.id,
        username: interaction.user.username,
        channelId: interaction.channelId ?? "",
        guildId: interaction.guildId ?? "",
        messageId: interaction.message.id,
        values,
        value: values[0] ?? "",
    };
}

export interface ModalSubmitData {
    modalId: string;
    interactionId: string;
    userId: string;
    username: string;
    channelId: string;
    guildId: string;
    /** the message whose button opened the modal; empty for a slash command */
    messageId: string;
    field1: string;
    field2: string;
    field3: string;
    field4: string;
    field5: string;
}

export function modalSubmitPayload(interaction: ModalSubmitInteraction): ModalSubmitData {
    const answer = (index: number): string => {
        const field = interaction.fields.fields.get(modalFieldId(index)) as
            | { value?: unknown }
            | undefined;
        return typeof field?.value === "string" ? field.value : "";
    };
    return {
        modalId: interaction.customId,
        interactionId: interaction.id,
        userId: interaction.user.id,
        username: interaction.user.username,
        channelId: interaction.channelId ?? "",
        guildId: interaction.guildId ?? "",
        messageId: interaction.message?.id ?? "",
        field1: answer(0),
        field2: answer(1),
        field3: answer(2),
        field4: answer(3),
        field5: answer(4),
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
        placeholder: "Component",
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
            : componentsToActionRows(payload.components);
        await message.edit({
            content: payload.content ?? message.content,
            embeds: embeds.length > 0 ? embeds.map((data) => buildDiscordEmbed(data)) : message.embeds,
            ...(components.length > 0 ? { components } : {}),
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

// Discord fails an interaction nobody answers within 3 seconds, so the bot
// acknowledges on the flow's behalf when it has not answered by this delay.
// Flows never need a Defer step: a later Respond or Follow Up still lands.
export const AUTO_ACK_DELAY_MS = 2_500;

// Every operation on one interaction runs in order, so the automatic
// acknowledgement and a flow's answer can never both claim the first
// response. Keyed weakly: a finished interaction is collected with its chain.
const interactionQueues = new WeakMap<object, Promise<unknown>>();

function serialize<T>(interaction: object, op: () => Promise<T>): Promise<T> {
    const previous = interactionQueues.get(interaction) ?? Promise.resolve();
    const next = previous.then(op, op);
    // the chain only orders work; this op's failure reaches its own caller
    // through `next`, so the next op still runs after a failed one
    interactionQueues.set(
        interaction,
        next.then(
            () => undefined,
            () => undefined,
        ),
    );
    return next;
}

// Interactions whose first response is not an editable reply: a click acked
// with an invisible update, or a deferral replaced to change visibility.
// Their answers arrive as new messages.
const answersAsNewMessage = new WeakSet<object>();

function acknowledgesWithUpdate(interaction: RepliableInteraction): boolean {
    if (interaction.isMessageComponent?.()) return true;
    return Boolean(interaction.isModalSubmit?.() && interaction.isFromMessage());
}

/**
 * The automatic acknowledgement. A button or select click (or a modal opened
 * from one) gets an invisible update ack, so a flow that answers nothing
 * leaves no trace; a slash command or modal gets "thinking…" that the flow's
 * Respond replaces. A no-op once anything answered.
 */
export function autoAcknowledge(interaction: RepliableInteraction): Promise<void> {
    return serialize(interaction, async () => {
        if (interaction.deferred || interaction.replied) return;
        if (acknowledgesWithUpdate(interaction)) {
            await (interaction as MessageComponentInteraction).deferUpdate();
            answersAsNewMessage.add(interaction);
        } else {
            await interaction.deferReply();
        }
    });
}

type MessageBody = ReturnType<typeof buildMessagePayload>;

// One class owns answering pending interactions: the reply / edit / new
// message decision, ephemeral flags, and the pending-map lookup live here,
// not in every responder action.
export class InteractionOps {
    constructor(
        private readonly take: (interactionId: string) => RepliableInteraction,
    ) {}

    // Answers in the one way Discord allows for the interaction's state:
    // the first answer is a reply; after "thinking…" it fills that message
    // in (or replaces it when the visibility asked for differs, since
    // Discord fixes visibility at defer time); after an update ack, or when
    // a new message was asked for, it is a follow-up message.
    private async deliver(
        interaction: RepliableInteraction,
        body: MessageBody,
        ephemeral: boolean,
        asNewMessage: boolean,
    ): Promise<{ messageId: () => Promise<string> }> {
        const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ ...body, flags });
            return { messageId: async () => (await interaction.fetchReply()).id };
        }
        if (answersAsNewMessage.has(interaction) || (interaction.replied && asNewMessage)) {
            const sent = await interaction.followUp({ ...body, flags });
            return { messageId: async () => sent.id };
        }
        if (!interaction.replied && Boolean(interaction.ephemeral) !== ephemeral) {
            await interaction.deleteReply();
            answersAsNewMessage.add(interaction);
            const sent = await interaction.followUp({ ...body, flags });
            return { messageId: async () => sent.id };
        }
        const edited = await interaction.editReply(body);
        return { messageId: async () => edited.id };
    }

    /** The interaction's answer; responding again edits that answer. */
    async respond(
        interactionId: string,
        payload: { content?: string; embeds?: unknown; components?: unknown; ephemeral?: boolean },
    ): Promise<string> {
        const interaction = this.take(interactionId.trim());
        const body = buildMessagePayload(payload);
        return serialize(interaction, async () => {
            await this.deliver(interaction, body, Boolean(payload.ephemeral), false);
            return interaction.id;
        });
    }

    // TODO(remove after v0.2): Defer Interaction is redundant now that every
    // interaction is acknowledged automatically; it stays only so flows
    // saved with that step keep running for one release.
    async defer(interactionId: string, ephemeral?: boolean): Promise<boolean> {
        const interaction = this.take(interactionId.trim());
        return serialize(interaction, async () => {
            if (interaction.deferred || interaction.replied) return true;
            await interaction.deferReply({
                flags: ephemeral ? MessageFlags.Ephemeral : undefined,
            });
            return true;
        });
    }

    /** Another message after the answer (or the answer, if none was sent yet). */
    async followUp(
        interactionId: string,
        payload: { content?: string; embeds?: unknown; components?: unknown; ephemeral?: boolean },
    ): Promise<string> {
        const interaction = this.take(interactionId.trim());
        const body = buildMessagePayload(payload);
        return serialize(interaction, async () => {
            const sent = await this.deliver(interaction, body, Boolean(payload.ephemeral), true);
            return sent.messageId();
        });
    }

    /** Opens a modal; only possible as the very first answer. */
    async showModal(
        interactionId: string,
        modal: ReturnType<typeof buildModalPayload>,
    ): Promise<boolean> {
        const interaction = this.take(interactionId.trim()) as RepliableInteraction & {
            showModal?: (modal: unknown) => Promise<unknown>;
        };
        if (typeof interaction.showModal !== "function") {
            throw new Error(
                "A modal can only answer a slash command, a button, or a select menu — not another modal",
            );
        }
        return serialize(interaction, async () => {
            if (interaction.deferred || interaction.replied) {
                throw new Error(
                    "Show Modal must be the first answer to an interaction, within 2.5 seconds. Move it before any Respond or slow step.",
                );
            }
            await interaction.showModal!(modal);
            return true;
        });
    }
}
