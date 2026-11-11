// How blocks look: each style is a PaperUI role colour and an icon. Blockly's
// own blocks name their styles (logic_blocks, loop_blocks...), so they take
// the same look as this panel's. Each panel gets a colour of its own, and its
// blocks show its icon, as the Actions panel's blocks do; a built-in block
// shows its own symbol, as Actions' built-ins did.
import * as Blockly from "blockly";
import { token } from "./tokens";
import { BUILTIN_SECTIONS } from "./blockDefs";
import { BUILTIN, parsePropertyBlockType, parseRegistryBlockType } from "./names";

/** A PaperUI role: --paper-<role> and --paper-<role>-deep. */
type Role = "primary" | "success" | "danger" | "warning" | "attention" | "extra-1" | "extra-2" | "extra-3";

interface Style {
    role: Role;
    /** the role's deep shade as the fill: a second section on one role */
    deep?: true;
    /** the Library section whose symbol the blocks show when they have none of their own; none for a panel's */
    section?: string;
}

const STYLES = {
    // "When Run is clicked"
    event_blocks: { role: "warning", section: "Flow" },
    loop_blocks: { role: "attention", section: "Flow" },
    logic_blocks: { role: "primary", section: "Logic" },
    math_blocks: { role: "success", section: "Math" },
    text_blocks: { role: "extra-3", section: "Text" },
    list_blocks: { role: "danger", section: "Lists" },
    time_blocks: { role: "success", deep: true, section: "Time" },
    web_blocks: { role: "primary", deep: true, section: "Web" },
    variable_blocks: { role: "extra-2", section: "Variables" },
    variable_dynamic_blocks: { role: "extra-2", section: "Variables" },
    procedure_blocks: { role: "extra-1", section: "Functions" },
} as const satisfies Record<string, Style>;

export type BlockStyleName = keyof typeof STYLES;

/** The colours a panel can be: every role, then every role's deep shade. */
const PANEL_ROLES: Role[] = ["extra-1", "primary", "attention", "extra-3", "success", "extra-2", "danger", "warning"];
const PANEL_SWATCHES: Style[] = [...PANEL_ROLES.map((role) => ({ role })), ...PANEL_ROLES.map((role) => ({ role, deep: true as const }))];
const PANEL_STYLE_PREFIX = "panel_";


/** A #rrggbb colour a share of the way to black: a block's edge, so it shows on its own fill. */
function edge(hex: string): string {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match) throw new Error(`${hex} isn't a #rrggbb colour, so blocks can't be drawn`);
    const n = parseInt(match[1]!, 16);
    const darker = (shift: number) => Math.round(((n >> shift) & 0xff) * 0.72);
    return `#${[16, 8, 0].map((s) => darker(s).toString(16).padStart(2, "0")).join("")}`;
}

function blocklyStyle(style: Style): Partial<Blockly.Theme.BlockStyle> {
    const base = token(`--paper-${style.role}`);
    const deep = token(`--paper-${style.role}-deep`);
    const fill = style.deep ? deep : base;
    return { colourPrimary: fill, colourSecondary: deep, colourTertiary: edge(fill) };
}

/** Blockly's block styles, in PaperUI's colours (Blockly takes colours, not variables). */
export function blockStyles(): Record<string, Partial<Blockly.Theme.BlockStyle>> {
    return {
        ...Object.fromEntries(Object.entries(STYLES).map(([name, style]: [string, Style]) => [name, blocklyStyle(style)])),
        ...Object.fromEntries(PANEL_SWATCHES.map((style, i) => [`${PANEL_STYLE_PREFIX}${i}`, blocklyStyle(style)])),
    };
}

const panelSwatch = new Map<string, number>();

function hash(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return h >>> 0;
}

/**
 * Gives each panel a colour: the one its id picks, or the next free one when
 * another panel has it. Sorted, so the same panels get the same colours each
 * time; a panel seen later takes the next free colour then.
 */
export function assignPanelStyles(panelIds: Iterable<string>): void {
    for (const id of [...new Set(panelIds)].sort()) {
        if (panelSwatch.has(id)) continue;
        const taken = new Set(panelSwatch.values());
        const start = hash(id) % PANEL_SWATCHES.length;
        let slot = start;
        // past every colour, panels share them
        for (let step = 0; step < PANEL_SWATCHES.length && taken.has(slot); step++) slot = (start + step + 1) % PANEL_SWATCHES.length;
        panelSwatch.set(id, slot);
    }
}

/** The style a panel's blocks wear. */
export function panelStyle(panelId: string): string {
    assignPanelStyles([panelId]);
    return `${PANEL_STYLE_PREFIX}${panelSwatch.get(panelId)!}`;
}

/** What a block shows before its text. */
export type BlockIcon = { src: string } | { symbol: string };

/** What a panel that declares no icon shows, as in the app's sidebar. */
export const NO_PANEL_ICON = "dashboard";
/** What a project that has neither a picture nor a symbol shows. */
export const NO_PROJECT_ICON = "folder";

let panelIcon: ((panelId: string) => BlockIcon) | null = null;

/** A panel's icon; the page knows from the panel list. */
export function setPanelIcons(resolve: (panelId: string) => BlockIcon): void {
    panelIcon = resolve;
}

function panelOf(type: string): string {
    const registry = parseRegistryBlockType(type);
    if (registry) return registry.panelId;
    const property = parsePropertyBlockType(type);
    if (property) return property.typeRef.slice(0, property.typeRef.indexOf(":"));
    throw new Error(`${type} is styled as a panel's block but names no panel`);
}

/** Each built-in block's own symbol, the ones Actions' built-ins had where there's one to match. */
const BLOCK_SYMBOLS: Record<string, string> = {
    [BUILTIN.onRun]: "play_arrow",
    [BUILTIN.wait]: "timer",
    [BUILTIN.waitUntil]: "hourglass_empty",
    [BUILTIN.log]: "terminal",
    [BUILTIN.stop]: "stop_circle",
    [BUILTIN.fail]: "error",
    [BUILTIN.attempt]: "safety_check",
    [BUILTIN.errorMessage]: "error",
    controls_if: "alt_route",
    controls_repeat_ext: "repeat",
    controls_whileUntil: "repeat",
    controls_forEach: "repeat",
    controls_flow_statements: "logout",
    logic_compare: "rule",
    logic_operation: "join",
    logic_negate: "block",
    logic_boolean: "toggle_on",
    logic_ternary: "call_split",
    [BUILTIN.hasValue]: "check_circle",
    math_number: "numbers",
    math_arithmetic: "calculate",
    math_single: "functions",
    math_round: "exposure",
    math_modulo: "percent",
    math_constrain: "unfold_less",
    math_number_property: "rule",
    math_on_list: "functions",
    math_random_int: "casino",
    math_random_float: "casino",
    [BUILTIN.randomId]: "fingerprint",
    text: "notes",
    text_join: "join",
    text_length: "straighten",
    text_isEmpty: "check_box_outline_blank",
    [BUILTIN.textTest]: "search",
    text_indexOf: "search",
    text_charAt: "arrow_forward",
    text_getSubstring: "content_cut",
    text_changeCase: "text_fields",
    text_trim: "format_clear",
    text_replace: "find_replace",
    text_count: "numbers",
    text_reverse: "swap_horiz",
    [BUILTIN.toNumber]: "numbers",
    [BUILTIN.regexTest]: "regular_expression",
    [BUILTIN.regexFind]: "regular_expression",
    [BUILTIN.base64]: "lock",
    lists_create_empty: "format_list_bulleted",
    lists_create_with: "format_list_bulleted",
    lists_repeat: "repeat",
    lists_length: "straighten",
    lists_isEmpty: "check_box_outline_blank",
    lists_indexOf: "search",
    lists_getIndex: "arrow_forward",
    lists_setIndex: "edit",
    lists_getSublist: "content_cut",
    lists_split: "call_split",
    lists_sort: "sort",
    lists_reverse: "swap_vert",
    [BUILTIN.now]: "schedule",
    [BUILTIN.timeFormat]: "event",
    [BUILTIN.timePart]: "calendar_month",
    [BUILTIN.timeAdd]: "more_time",
    [BUILTIN.webGet]: "download",
    [BUILTIN.webPost]: "upload",
    [BUILTIN.jsonParse]: "data_object",
    [BUILTIN.jsonText]: "data_object",
    [BUILTIN.getKey]: "key",
    variables_get: "data_object",
    variables_set: "edit",
    math_change: "exposure",
    variables_get_dynamic: "data_object",
    variables_set_dynamic: "edit",
};

export function blockIcon(block: Blockly.Block): BlockIcon {
    const name = block.getStyleName();
    if (name.startsWith(PANEL_STYLE_PREFIX)) {
        if (!panelIcon) throw new Error("The panels' icons aren't known yet");
        return panelIcon(panelOf(block.type));
    }
    const style: Style | undefined = STYLES[name as BlockStyleName];
    if (!style) throw new Error(`${block.type} has the style "${name}", which Blocks doesn't draw`);
    const own = BLOCK_SYMBOLS[block.type];
    if (own) return { symbol: own };
    const section = BUILTIN_SECTIONS.find((s) => s.name === style.section);
    if (!section) throw new Error(`The style "${name}" names the section "${style.section}", which the Library doesn't have`);
    return { symbol: section.icon };
}
