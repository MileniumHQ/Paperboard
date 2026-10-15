// Widget declarations in a panel manifest. One implementation of the rule:
// the daemon's manifest validator and the packer both call it, so a manifest
// that packs is a manifest the daemon lists.
//
//   "widgets": [{ "id": "status", "name": "Server status", "sizes": ["2x1", "2x2"] }]
//
// Every widget of a panel is served from one document, dist/widget.html, on
// the panel's own origin; the shell tells it which widget to show.

/** The document every widget of a panel loads from, relative to the panel. */
export const WIDGET_ENTRY = "widget.html";
/** The widest a widget can be, in Home grid cells. */
export const WIDGET_MAX_WIDTH = 4;
export const WIDGET_MAX_HEIGHT = 4;
export const MAX_WIDGETS_PER_PANEL = 8;
export const MAX_SIZES_PER_WIDGET = 4;
export const MAX_OPTIONS_PER_WIDGET = 2;
/** The most choices one option's dropdown offers. */
export const MAX_WIDGET_CHOICES = 64;
export const MAX_WIDGET_OPTION_VALUE_LENGTH = 128;

const WIDGET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SIZE_PATTERN = /^([1-9])x([1-9])$/;

export interface WidgetSize {
    w: number;
    h: number;
}

/**
 * Something chosen when a widget is added to Home, from a list the panel's
 * service supplies (definePanelService's `widgetChoices`): which workflow a
 * Run button runs, which server a status card shows.
 */
export interface WidgetOptionDeclaration {
    id: string;
    /** What the gallery's dropdown is called. */
    label: string;
}

/** One entry of an option's dropdown: `value` is what the widget is given. */
export interface WidgetChoice {
    value: string;
    label: string;
}

/** What was chosen for one placed widget, by option id. */
export type WidgetOptionValues = Record<string, string>;

export interface WidgetDeclaration {
    id: string;
    name: string;
    description?: string;
    /** Shapes the widget is designed for, in grid cells; the first is the default. */
    sizes: string[];
    /** Choices made in the gallery before the widget is placed. */
    options?: WidgetOptionDeclaration[];
}

export function isWidgetId(value: unknown): value is string {
    return typeof value === "string" && WIDGET_ID_PATTERN.test(value);
}

/** "2x1" → { w: 2, h: 1 }; null for anything outside the grid's bounds. */
export function parseWidgetSize(value: unknown): WidgetSize | null {
    if (typeof value !== "string") return null;
    const match = SIZE_PATTERN.exec(value);
    if (!match) return null;
    const w = Number(match[1]);
    const h = Number(match[2]);
    if (w > WIDGET_MAX_WIDTH || h > WIDGET_MAX_HEIGHT) return null;
    return { w, h };
}

/**
 * Returns the declarations a panel manifest makes, or throws naming the
 * first one that breaks the rules. A missing field means no widgets.
 */
export function validateWidgetDeclarations(raw: unknown): WidgetDeclaration[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error("manifest widgets must be an array");
    if (raw.length > MAX_WIDGETS_PER_PANEL) {
        throw new Error(`a panel declares at most ${MAX_WIDGETS_PER_PANEL} widgets`);
    }
    const seen = new Set<string>();
    return raw.map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`widget ${index} must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if (!isWidgetId(record.id)) {
            throw new Error(`widget ${index} needs an id of lowercase letters, digits and dashes`);
        }
        if (seen.has(record.id)) throw new Error(`widget id "${record.id}" is declared twice`);
        seen.add(record.id);
        if (typeof record.name !== "string" || !record.name.trim() || record.name.length > 64) {
            throw new Error(`widget "${record.id}" needs a name of at most 64 characters`);
        }
        if (!Array.isArray(record.sizes) || record.sizes.length === 0 || record.sizes.length > MAX_SIZES_PER_WIDGET) {
            throw new Error(`widget "${record.id}" needs 1 to ${MAX_SIZES_PER_WIDGET} sizes`);
        }
        const sizes = record.sizes.map((size) => {
            if (!parseWidgetSize(size)) {
                throw new Error(
                    `widget "${record.id}" size ${JSON.stringify(size)} must look like "2x1", at most ${WIDGET_MAX_WIDTH}x${WIDGET_MAX_HEIGHT}`,
                );
            }
            return size as string;
        });
        if (new Set(sizes).size !== sizes.length) {
            throw new Error(`widget "${record.id}" lists a size twice`);
        }
        const declaration: WidgetDeclaration = { id: record.id, name: record.name.trim(), sizes };
        if (record.description !== undefined) {
            if (typeof record.description !== "string" || record.description.length > 256) {
                throw new Error(`widget "${record.id}" description must be a string of at most 256 characters`);
            }
            declaration.description = record.description;
        }
        if (record.options !== undefined) {
            if (!Array.isArray(record.options) || record.options.length > MAX_OPTIONS_PER_WIDGET) {
                throw new Error(`widget "${record.id}" declares at most ${MAX_OPTIONS_PER_WIDGET} options`);
            }
            const optionIds = new Set<string>();
            const options = record.options.map((raw): WidgetOptionDeclaration => {
                const option = raw as Record<string, unknown> | null;
                if (!option || typeof option !== "object" || Array.isArray(option) || !isWidgetId(option.id)) {
                    throw new Error(`widget "${record.id}" options each need an id of lowercase letters, digits and dashes`);
                }
                if (optionIds.has(option.id)) throw new Error(`widget "${record.id}" declares option "${option.id}" twice`);
                optionIds.add(option.id);
                if (typeof option.label !== "string" || !option.label.trim() || option.label.length > 64) {
                    throw new Error(`widget "${record.id}" option "${option.id}" needs a label of at most 64 characters`);
                }
                return { id: option.id, label: option.label.trim() };
            });
            if (options.length > 0) declaration.options = options;
        }
        return declaration;
    });
}

/**
 * Reads what a panel's service offers for one option, or throws naming what
 * is wrong with it. The service checks its own answer with this before it
 * leaves, and Home checks it again as it arrives.
 */
export function parseWidgetChoices(raw: unknown): WidgetChoice[] {
    if (!Array.isArray(raw)) throw new Error("widget choices must be an array");
    if (raw.length > MAX_WIDGET_CHOICES) throw new Error(`a widget option offers at most ${MAX_WIDGET_CHOICES} choices`);
    const seen = new Set<string>();
    return raw.map((entry, index) => {
        const choice = entry as Record<string, unknown> | null;
        if (!choice || typeof choice !== "object" || Array.isArray(choice)) throw new Error(`widget choice ${index} must be an object`);
        if (typeof choice.value !== "string" || !choice.value || choice.value.length > MAX_WIDGET_OPTION_VALUE_LENGTH) {
            throw new Error(`widget choice ${index} needs a value of at most ${MAX_WIDGET_OPTION_VALUE_LENGTH} characters`);
        }
        if (seen.has(choice.value)) throw new Error(`widget choice "${choice.value}" is offered twice`);
        seen.add(choice.value);
        if (typeof choice.label !== "string" || !choice.label.trim() || choice.label.length > 64) {
            throw new Error(`widget choice "${choice.value}" needs a label of at most 64 characters`);
        }
        return { value: choice.value, label: choice.label.trim() };
    });
}

/** Reads a placed widget's chosen values; a missing field is none, null is malformed. */
export function parseWidgetOptionValues(raw: unknown): WidgetOptionValues | null {
    if (raw === undefined) return {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > MAX_OPTIONS_PER_WIDGET) return null;
    const values: WidgetOptionValues = {};
    for (const [id, value] of entries) {
        if (!isWidgetId(id) || typeof value !== "string" || !value || value.length > MAX_WIDGET_OPTION_VALUE_LENGTH) return null;
        values[id] = value;
    }
    return values;
}
