// The builders that never reach Discord (embeds, buttons, menus, modal
// fields): the panel's own, shared by every bot.
import type { BlockChoice, BlockValueDefinition } from "@mileniumhq/paperapi";
import { MAX_SELECT_OPTIONS, MAX_MODAL_FIELDS, buildButtonComponent, buildComponentRow, buildDiscordEmbed, buildModalField, buildSelectMenuComponent } from "../discordOps";

// ─── the builders: every bot shares them ────────────────────────────────────

export const choice = (label: string, value: string | number | boolean): BlockChoice => ({ label, value });
export const VISIBILITY = [choice("for everyone", false), choice("only for them", true)];
const count = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => choice(String(from + i), from + i));
export const contentInputs = {
    embeds: { type: "list<embed>", name: "Embeds", optional: true },
    components: { type: "list<component>", name: "Components", optional: true },
} as const;
/** A length or count where 0 means "none": a number socket starts at 0. */
export const unlessZero = (n: number | undefined) => (n ? n : undefined);

/** Values built from their inputs and never reach Discord: the panel's own. */
export const builderValues: BlockValueDefinition[] = [
    {
        id: "create-embed",
        name: "Embed",
        category: "Embeds",
        icon: "article",
        description: "A rich box of text for Send, Reply, Respond or Follow Up",
        text: "Embed {title} saying {description} in {color}, linking {url}, with footer {footer} and image {image}",
        inputs: {
            title: { type: "text", name: "Title", maxLength: 256 },
            description: { type: "text", name: "Description", optional: true, maxLength: 4096 },
            color: { type: "color", name: "Color", optional: true },
            url: { type: "url", name: "Link", optional: true },
            footer: { type: "text", name: "Footer", optional: true, maxLength: 2048 },
            image: { type: "url", name: "Image", optional: true },
        },
        type: "embed",
        read: async (inputs: { title: string; description?: string; color?: string; url?: string; footer?: string; image?: string }) =>
            (await buildDiscordEmbed(inputs)).toJSON(),
    },
    {
        id: "create-button",
        name: "Button",
        category: "Buttons & Menus",
        icon: "smart_button",
        description: "A button for a message's Components. A click starts When a Button or Menu Is Used with its Component ID; a link button opens its link instead",
        text: "{style} button {label} with ID {component-id}, link {url} and emoji {emoji}, {disabled}",
        inputs: {
            style: {
                type: "text",
                name: "Style",
                choices: [choice("Primary", "primary"), choice("Secondary", "secondary"), choice("Success", "success"), choice("Danger", "danger"), choice("Link", "link")],
            },
            label: { type: "text", name: "Label", maxLength: 80 },
            "component-id": { type: "text", name: "Component ID", optional: true, maxLength: 100 },
            url: { type: "url", name: "Link", optional: true },
            emoji: { type: "text", name: "Emoji", optional: true },
            disabled: { type: "boolean", name: "Disabled", choices: [choice("enabled", false), choice("disabled", true)] },
        },
        type: "component",
        read: (inputs: { style: string; label: string; "component-id"?: string; url?: string; emoji?: string; disabled: boolean }) => {
            // the shared builder's own message says "Interaction ID"
            if (inputs.style !== "link" && !inputs["component-id"]?.trim()) {
                throw new Error(`The ${inputs.style} button "${inputs.label}" needs a Component ID, so a flow can react to it`);
            }
            return buildButtonComponent({
                style: inputs.style,
                label: inputs.label,
                ...(inputs["component-id"] ? { customId: inputs["component-id"] } : {}),
                ...(inputs.url ? { url: inputs.url } : {}),
                ...(inputs.emoji ? { emoji: inputs.emoji } : {}),
                disabled: inputs.disabled,
            });
        },
    },
    {
        id: "create-select-menu",
        name: "Select Menu",
        category: "Buttons & Menus",
        icon: "arrow_drop_down_circle",
        description: "A dropdown for a message's Components. It fills a row of its own; a pick starts When a Button or Menu Is Used with its Component ID. Options are only for a menu of options",
        text: "Menu of {menu} with ID {component-id}: {options}, {min-picks} to {max-picks} picks, hint {placeholder}",
        inputs: {
            menu: { type: "text", name: "Menu", choices: [choice("options", "text"), choice("users", "user"), choice("roles", "role"), choice("channels", "channel")] },
            "component-id": { type: "text", name: "Component ID", maxLength: 100 },
            options: { type: "list<text>", name: "Options", optional: true },
            "min-picks": { type: "number", name: "Fewest Picks", choices: [...count(1, MAX_SELECT_OPTIONS), choice("0", 0)] },
            "max-picks": { type: "number", name: "Most Picks", choices: count(1, MAX_SELECT_OPTIONS) },
            placeholder: { type: "text", name: "Hint", optional: true, maxLength: 150 },
        },
        type: "component",
        read: (inputs: { menu: string; "component-id": string; options?: string[]; "min-picks": number; "max-picks": number; placeholder?: string }) =>
            buildSelectMenuComponent({
                menu: inputs.menu,
                customId: inputs["component-id"],
                options: inputs.options,
                minValues: inputs["min-picks"],
                maxValues: inputs["max-picks"],
                placeholder: inputs.placeholder,
            }),
    },
    {
        id: "create-interaction-row",
        name: "Component Row",
        category: "Buttons & Menus",
        icon: "view_week",
        description: "Up to five buttons, or one select menu, on one row. Components before or after it go on their own rows",
        text: "Row of {components}",
        inputs: { components: { type: "list<component>", name: "Components" } },
        type: "component",
        read: (inputs: { components: unknown[] }) => buildComponentRow(inputs.components),
    },
    {
        id: "create-text-field",
        name: "Text Field",
        category: "Modals",
        icon: "text_fields",
        description: `A question for Show Modal. Answers arrive in order as Field 1 to Field ${MAX_MODAL_FIELDS} of When a Modal Is Submitted. A length of 0 is no limit`,
        text: "{style} text field {label}, hint {placeholder}, prefilled with {value}, {required}, {min-length} to {max-length} characters",
        inputs: {
            style: { type: "text", name: "Style", choices: [choice("One-line", "short"), choice("Paragraph", "paragraph")] },
            label: { type: "text", name: "Label", maxLength: 45 },
            placeholder: { type: "text", name: "Hint", optional: true, maxLength: 100 },
            value: { type: "text", name: "Answer", optional: true, maxLength: 4000 },
            required: { type: "boolean", name: "Required", choices: [choice("required", true), choice("optional", false)] },
            "min-length": { type: "number", name: "Shortest", optional: true, integer: true, min: 0, max: 4000 },
            "max-length": { type: "number", name: "Longest", optional: true, integer: true, min: 0, max: 4000 },
        },
        type: "text-field",
        read: (inputs: { style: string; label: string; placeholder?: string; value?: string; required: boolean; "min-length"?: number; "max-length"?: number }) =>
            buildModalField({
                style: inputs.style,
                label: inputs.label,
                placeholder: inputs.placeholder,
                value: inputs.value,
                required: inputs.required,
                minLength: unlessZero(inputs["min-length"]),
                maxLength: unlessZero(inputs["max-length"]),
            }),
    },
];
