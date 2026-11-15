// What a bot sends, built from a block's inputs: embeds, components and
// their rows, modals, polls and files. Each is checked here once, with the
// rule it breaks, before anything reaches Discord (discordOps.ts sends them).
import type { ButtonStyle, ColorResolvable } from "discord.js";
import { loadDiscord } from "./discord";
import { errorMessage } from "@mileniumhq/paperapi";

type Discord = Awaited<ReturnType<typeof loadDiscord>>;

// ─── embeds ─────────────────────────────────────────────────────────────────

// A flow passes either the flat inputs or the Embed block's output, which is
// Discord's own shape: footer {text}, image {url}, color as a number.
interface DiscordEmbedData {
    title?: string;
    description?: string;
    color?: string | number;
    url?: string;
    footer?: string | { text?: string };
    image?: string | { url?: string };
}

export async function buildDiscordEmbed(data: DiscordEmbedData) {
    return embedFrom(await loadDiscord(), data);
}

// The builders below take the loaded library and stay synchronous: each
// exported one waits for discord.js exactly once, so two answers built at the
// same moment still reach Discord in the order they were asked for.
export function embedFrom({ EmbedBuilder }: Discord, data: DiscordEmbedData) {
    const embed = new EmbedBuilder();
    // a field Discord would refuse stops the send and says which: the embed
    // never goes out without it
    const set = (field: string, apply: () => unknown) => {
        try {
            apply();
        } catch (err) {
            throw new Error(`Embed ${field}: ${errorMessage(err)}`);
        }
    };
    if (data.title) set("title", () => embed.setTitle(data.title!));
    if (data.description) set("description", () => embed.setDescription(data.description!));
    if (data.color) set("color", () => embed.setColor(data.color as ColorResolvable));
    if (data.url) set("link", () => embed.setURL(data.url!));
    const footer = typeof data.footer === "object" ? data.footer?.text : data.footer;
    if (footer) set("footer", () => embed.setFooter({ text: footer }));
    const image = typeof data.image === "object" ? data.image?.url : data.image;
    if (image) set("image", () => embed.setImage(image));
    return embed;
}

/** A flow's embeds: one, a list, or their JSON. Anything else is refused, never sent as no embed. */
export function normalizeEmbeds(input: unknown): DiscordEmbedData[] {
    if (input === undefined || input === null || (typeof input === "string" && !input.trim())) return [];
    if (typeof input === "string") {
        let parsed: unknown;
        try {
            parsed = JSON.parse(input);
        } catch (err) {
            throw new Error(`Embeds aren't valid JSON: ${errorMessage(err)}`);
        }
        return normalizeEmbeds(parsed);
    }
    const list = Array.isArray(input) ? input : [input];
    list.forEach((embed, index) => {
        if (!embed || typeof embed !== "object" || Array.isArray(embed)) throw new Error(`Embed ${index + 1} isn't an embed`);
    });
    return list as DiscordEmbedData[];
}

// ─── message components ─────────────────────────────────────────────────────

// The payloads the flow passes around are plain objects tagged by kind (the
// custom id the author chose travels inside them); send time lays them out
// into Discord action rows. A message holds at most five rows; a row holds
// up to five buttons or exactly one select menu.
interface DiscordButtonData {
    kind?: "button";
    label?: string;
    style?: string;
    customId?: string;
    url?: string;
    emoji?: string;
    disabled?: boolean;
}

const SELECT_MENU_KINDS = ["text", "user", "role", "channel"] as const;
type SelectMenuKind = (typeof SELECT_MENU_KINDS)[number];

interface DiscordSelectMenuData {
    kind: "select";
    menu: SelectMenuKind;
    customId: string;
    placeholder?: string;
    options?: string[];
    minValues?: number;
    maxValues?: number;
    disabled?: boolean;
}

interface DiscordComponentRowData {
    kind: "row";
    components: (DiscordButtonData | DiscordSelectMenuData)[];
}

type DiscordComponentData =
    | DiscordButtonData
    | DiscordSelectMenuData
    | DiscordComponentRowData;

const MAX_COMPONENT_ROWS = 5;
const MAX_BUTTONS_PER_ROW = 5;
export const MAX_SELECT_OPTIONS = 25;

const BUTTON_STYLES = [
    "primary",
    "secondary",
    "success",
    "danger",
    "link",
] as const;

// Discord's per-value limits (lengths, counts, item caps) are declared on
// the blocks' inputs and refused by the SDK before these builders run, and
// shown on the block before the flow does; the builders check what a single
// input can't say: presence, kinds, and how inputs relate.
function checkCustomId(customId: string, what: string, field = "Component ID"): string {
    const trimmed = customId.trim();
    if (!trimmed) {
        throw new Error(`${what} needs a ${field}, so a flow can react to it`);
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
                `The link button "${label}" needs a Link instead of a Component ID`,
            );
        }
        return { ...inputs, kind: "button", label, style };
    }
    const customId = checkCustomId(
        inputs.customId || "",
        `The ${style} button "${label}"`,
    );
    return { ...inputs, kind: "button", label, style, customId };
}

// Text options arrive as a list (the Options field is edited item by item;
// a lone text value is one option); each option's label is also its value.
function parseSelectOptions(input: unknown): string[] {
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
            "Components must come from the Button, Select Menu or Component Row blocks",
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
 * The Component Row block: an explicit row the author arranged. It holds
 * one to five buttons or exactly one select menu, never another row.
 */
export function buildComponentRow(input: unknown): DiscordComponentRowData {
    const raw = Array.isArray(input) ? input : input ? [input] : [];
    const components = raw.map(componentItem);
    if (components.some(isRow)) {
        throw new Error("A Component Row cannot hold another Component Row");
    }
    const items = components as (DiscordButtonData | DiscordSelectMenuData)[];
    if (items.length === 0) {
        throw new Error("A Component Row needs at least one button or select menu");
    }
    const selects = items.filter(isSelect).length;
    if (selects > 0 && items.length > 1) {
        throw new Error(
            "A select menu fills its whole row; put buttons in a separate Component Row",
        );
    }
    if (items.length > MAX_BUTTONS_PER_ROW) {
        throw new Error(
            `A Component Row holds at most ${MAX_BUTTONS_PER_ROW} buttons (got ${items.length})`,
        );
    }
    return { kind: "row", components: items };
}

/**
 * Lays the Components field out into rows, in order: a Component Row
 * stays one row; loose buttons share a row until it holds five or a row or
 * select menu interrupts them; a loose select menu takes a row of its own.
 * Result: (button | select)[][] — one inner array per Discord action row.
 */
function layoutComponentRows(
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
                    `Two components in one message share the Component ID "${id}"; Discord needs each to be unique`,
                );
            }
            seen.add(id);
        }
    }
    return rows;
}

function buttonToApi({ ButtonBuilder, ButtonStyle }: Discord, component: DiscordButtonData) {
    const button = new ButtonBuilder().setLabel(component.label ?? "");
    if (component.disabled) button.setDisabled(true);
    if (component.emoji) {
        try {
            button.setEmoji(component.emoji);
        } catch (err) {
            throw new Error(
                `Emoji "${component.emoji}" could not be used on button "${component.label}": ${errorMessage(err)}`,
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

function selectToApi({ ComponentType }: Discord, component: DiscordSelectMenuData) {
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

export function actionRows(lib: Discord, input: unknown) {
    return layoutComponentRows(input).map((row) => ({
        type: lib.ComponentType.ActionRow,
        components: row.map((component) =>
            isSelect(component) ? selectToApi(lib, component) : buttonToApi(lib, component),
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

export async function buildMessagePayload(input: MessagePayloadInput) {
    return messagePayload(await loadDiscord(), input);
}

function messagePayload(lib: Discord, input: MessagePayloadInput) {
    const rows = actionRows(lib, input.components);
    return {
        content: input.content ?? "",
        embeds: normalizeEmbeds(input.embeds).map((data) => embedFrom(lib, data)),
        ...(rows.length > 0 ? { components: rows } : {}),
    };
}

// ─── modals ─────────────────────────────────────────────────────────────────

export const MAX_MODAL_FIELDS = 5;

interface DiscordModalFieldData {
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

export async function buildModalPayload(input: {
    modalId?: string;
    title?: string;
    fields?: unknown;
}) {
    const customId = checkCustomId(input.modalId || "", "A modal", "Modal ID");
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
            throw new Error("A modal's Text Fields must come from the Text Field block");
        }
        return item as DiscordModalFieldData;
    });
    const { ComponentType, TextInputStyle } = await loadDiscord();
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

// ─── polls and files ────────────────────────────────────────────────────────

/**
 * A list input as a flow or an agent writes it: a real list, or text with
 * one item per line (and, when `commas`, separated by commas too).
 */
export function listInput(value: unknown, commas = false): string[] {
    if (value === undefined || value === null || value === "") return [];
    const raw = Array.isArray(value) ? value.map(String) : String(value).split(commas ? /[\n,]/ : /\n/);
    return raw.map((item) => item.trim()).filter(Boolean);
}

const MAX_POLL_ANSWERS = 10;
export const MAX_POLL_HOURS = 768;

/** A Discord poll from a question and its answers, refused with the rule it breaks. */
export function buildPoll(inputs: { question?: unknown; answers?: unknown; hours?: unknown; multiple?: unknown }) {
    const question = typeof inputs.question === "string" ? inputs.question.trim() : "";
    if (!question) throw new Error("A poll needs a question");
    if (question.length > 300) throw new Error("A poll's question is at most 300 characters");
    const answers = listInput(inputs.answers);
    if (answers.length < 1) throw new Error("A poll needs at least one answer, one per line");
    if (answers.length > MAX_POLL_ANSWERS) throw new Error(`A poll has at most ${MAX_POLL_ANSWERS} answers`);
    const long = answers.find((a) => a.length > 55);
    if (long) throw new Error(`"${long.slice(0, 20)}…" is longer than the 55 characters a poll answer can be`);
    const hours = inputs.hours === undefined || inputs.hours === "" ? 24 : Number(inputs.hours);
    if (!Number.isFinite(hours) || hours < 1 || hours > MAX_POLL_HOURS) throw new Error(`A poll runs from 1 to ${MAX_POLL_HOURS} hours`);
    return {
        question: { text: question },
        answers: answers.map((text) => ({ text })),
        duration: Math.floor(hours),
        allowMultiselect: inputs.multiple === true,
    };
}
