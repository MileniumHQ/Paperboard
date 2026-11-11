// How blocks look: each style is a PaperUI role colour and an icon. Blockly's
// own blocks name their styles (logic_blocks, loop_blocks...), so they take
// the same look as this panel's. A panel's blocks share one colour and show
// the panel's icon, as the Actions panel's blocks do; a built-in block shows
// the symbol of its Library section.
import * as Blockly from "blockly";
import { BUILTIN_SECTIONS } from "./blockDefs";
import { parsePropertyBlockType, parseRegistryBlockType } from "./names";

/** A PaperUI role: --paper-<role> and --paper-<role>-deep. */
type Role = "primary" | "success" | "danger" | "warning" | "attention" | "extra-1" | "extra-2" | "extra-3";

interface Style {
    role: Role;
    /** the role's deep shade as the fill: a second section on one role, or white text on a light role */
    deep?: true;
    /** the Library section whose symbol the blocks show; none for a panel's */
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
    panel_blocks: { role: "extra-1", deep: true },
} as const satisfies Record<string, Style>;

export type BlockStyleName = keyof typeof STYLES;

function token(name: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!value) throw new Error(`${name} isn't set, so blocks can't be drawn`);
    return value;
}

/** Blockly's block styles, in PaperUI's colours (Blockly takes colours, not variables). */
export function blockStyles(): Record<string, Partial<Blockly.Theme.BlockStyle>> {
    return Object.fromEntries(
        Object.entries(STYLES).map(([name, style]: [string, Style]) => {
            const base = token(`--paper-${style.role}`);
            const deep = token(`--paper-${style.role}-deep`);
            return [name, { colourPrimary: style.deep ? deep : base, colourSecondary: deep, colourTertiary: deep }];
        }),
    );
}

/** What a block shows before its text. */
export type BlockIcon = { src: string } | { symbol: string };

let panelIcon: ((panelId: string) => string) | null = null;

/** Where a panel's icon is; the page knows from the panel list. */
export function setPanelIcons(resolve: (panelId: string) => string): void {
    panelIcon = resolve;
}

function panelOf(type: string): string {
    const registry = parseRegistryBlockType(type);
    if (registry) return registry.panelId;
    const property = parsePropertyBlockType(type);
    if (property) return property.typeRef.slice(0, property.typeRef.indexOf(":"));
    throw new Error(`${type} is styled as a panel's block but names no panel`);
}

export function blockIcon(block: Blockly.Block): BlockIcon {
    const name = block.getStyleName();
    const style: Style | undefined = STYLES[name as BlockStyleName];
    if (!style) throw new Error(`${block.type} has the style "${name}", which Blocks doesn't draw`);
    if (!style.section) {
        if (!panelIcon) throw new Error("The panels' icons aren't known yet");
        return { src: panelIcon(panelOf(block.type)) };
    }
    const section = BUILTIN_SECTIONS.find((s) => s.name === style.section);
    if (!section) throw new Error(`The style "${name}" names the section "${style.section}", which the Library doesn't have`);
    return { symbol: section.icon };
}
